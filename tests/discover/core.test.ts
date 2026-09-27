import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The web-search source uses the agent's DuckDuckGo search, not the injected
// fetch — keep tests offline
vi.mock('@/lib/webTools', () => ({ webSearch: vi.fn(async () => { throw new Error('offline'); }) }));

import { validateSettings, parseGithubRemote, loadSettings, saveSettings, DEFAULT_SETTINGS } from '@/lib/discover/config';
import { scoreRelevance, sortItems } from '@/lib/discover/relevance';
import { getDiscoverFeed, clearDiscoverCache, dedupeItems, SOURCES } from '@/lib/discover';
import { buildDigest, pickHighlights, localDate, listDigests, readDigest } from '@/lib/discover/digest';
import { cleanText, plainText, safeUrl, httpError, type DiscoverItem } from '@/lib/discover/types';

const item = (over: Partial<DiscoverItem>): DiscoverItem => ({
  id: 'x:1', category: 'research', source: 'x', sourceLabel: 'X', title: 'T', url: 'https://example.com', tags: [], goal: 'g', ...over,
});

describe('settings', () => {
  it('accepts valid settings and de-duplicates', () => {
    const s = validateSettings({ keywords: ['agents', 'agents', ' tool use '], newsKeywords: ['LLM'], watchedRepos: ['ollama/ollama'], topics: ['mcp-server'], repo: 'VC-OF/Ai-Code-Platform-', digestHour: 7 });
    expect(s).toEqual({ keywords: ['agents', 'tool use'], newsKeywords: ['LLM'], watchedRepos: ['ollama/ollama'], topics: ['mcp-server'], repo: 'VC-OF/Ai-Code-Platform-', digestHour: 7 });
  });

  it('rejects values that could reach URLs or paths unsafely', () => {
    expect(() => validateSettings({ watchedRepos: ['../../etc/passwd'] })).toThrow(/Invalid repository/);
    expect(() => validateSettings({ watchedRepos: ['owner/name?x=1'] })).toThrow(/Invalid repository/);
    expect(() => validateSettings({ watchedRepos: ['owner/..'] })).toThrow(/Invalid repository/);
    expect(() => validateSettings({ topics: ['MCP Server'] })).toThrow(/Invalid topic/);
    expect(() => validateSettings({ repo: 'not a repo' })).toThrow(/Invalid repository/);
    expect(() => validateSettings({ keywords: ['a\nb'] })).toThrow(/Invalid keyword/);
    expect(() => validateSettings({ keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) })).toThrow(/At most 10/);
    expect(() => validateSettings({ newsKeywords: ['a', 'b', 'c', 'd', 'e'] })).toThrow(/At most 4/);
    // The new-repos adapter queries at most 3 topics — the limit matches it
    expect(() => validateSettings({ topics: ['a', 'b', 'c', 'd'] })).toThrow(/At most 3/);
    expect(() => validateSettings({ keywords: 'agents' })).toThrow(/must be a list/);
    for (const h of [-1, 24, 7.5, 'x']) expect(() => validateSettings({ digestHour: h })).toThrow(/digestHour/);
  });

  it('allows commas inside keywords', () => {
    expect(validateSettings({ keywords: ['agents, tools and memory'] }).keywords).toEqual(['agents, tools and memory']);
  });

  it('falls back to defaults for missing fields, and an empty repo means auto-detect', () => {
    expect(validateSettings({ repo: '' })).toEqual({ ...DEFAULT_SETTINGS, repo: null });
  });

  it('round-trips through .platform/discover.json and ignores a corrupt file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-discover-'));
    try {
      expect(loadSettings(root)).toEqual(DEFAULT_SETTINGS);
      saveSettings(root, { ...DEFAULT_SETTINGS, keywords: ['agents'] });
      expect(loadSettings(root).keywords).toEqual(['agents']);
      fs.writeFileSync(path.join(root, '.platform', 'discover.json'), '{not json');
      expect(loadSettings(root)).toEqual(DEFAULT_SETTINGS);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('parses GitHub remotes and rejects look-alikes', () => {
    expect(parseGithubRemote('https://github.com/VC-OF/Ai-Code-Platform-.git')).toBe('VC-OF/Ai-Code-Platform-');
    expect(parseGithubRemote('git@github.com:VC-OF/Ai-Code-Platform-.git\n')).toBe('VC-OF/Ai-Code-Platform-');
    expect(parseGithubRemote('https://github.com/owner/repo')).toBe('owner/repo');
    expect(parseGithubRemote('ssh://git@ssh.github.com:443/owner/repo.git')).toBe('owner/repo');
    expect(parseGithubRemote('https://GitHub.com:443/Owner/Repo/')).toBe('Owner/Repo');
    expect(parseGithubRemote('https://gitlab.com/owner/repo.git')).toBeNull();
    expect(parseGithubRemote('https://github.com.evil.io/o/r')).toBeNull();
    expect(parseGithubRemote('https://evilgithub.com/o/r')).toBeNull();
    expect(parseGithubRemote('https://github.com/o/r/tree/main')).toBeNull();
    expect(parseGithubRemote('C:/some/local/path')).toBeNull();
  });
});

describe('relevance', () => {
  it('tags the OpenCode areas an item touches, title counting more', () => {
    const r = scoreRelevance(item({ title: 'Tool calling for coding agents via MCP', summary: 'A benchmark of long-context agents' }), ['coding agent']);
    expect(r.areas).toEqual(expect.arrayContaining(['Agent loop', 'Tools & MCP', 'Code generation', 'Evaluation', 'Context & memory']));
    expect(r.score).toBeGreaterThan(scoreRelevance(item({ title: 'Unrelated gardening tips' })).score);
    expect(scoreRelevance(item({ title: 'Unrelated gardening tips' }))).toEqual({ score: 0, areas: [] });
  });

  it('does not match everyday meanings of AI words', () => {
    for (const title of ['Changing your browser user agent string', 'Foreign agents act passed', 'DDR5 memory prices fall', 'Type inference in TypeScript 6']) {
      expect(scoreRelevance(item({ title })).areas, title).toEqual([]);
    }
    expect(scoreRelevance(item({ title: 'New LLM beats GPT-6 on reasoning' })).areas).toEqual(expect.arrayContaining(['Models & providers', 'Agent loop']));
  });

  it('ignores search-keyword tags when scoring', () => {
    expect(scoreRelevance(item({ title: 'Umbrella insurance launch', tags: ['tool use', 'llm agents'] })).areas).toEqual([]);
  });

  it('sorts by relevance, recency or popularity', () => {
    const a = item({ id: 'a', date: '2026-09-01T00:00:00Z', score: 5, relevance: { score: 9, areas: [] } });
    const b = item({ id: 'b', date: '2026-09-20T00:00:00Z', score: 50, relevance: { score: 1, areas: [] } });
    const c = item({ id: 'c', date: '2026-09-10T00:00:00Z', score: 500 });
    expect(sortItems([b, c, a], 'relevant').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(sortItems([a, b, c], 'newest').map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(sortItems([a, b, c], 'popular').map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('shared helpers', () => {
  it('cleanText strips tags, decodes entities once, and clips by character', () => {
    expect(cleanText('<p>Hello&nbsp;&amp; <b>world</b></p>\n\n  ok')).toBe('Hello & world ok');
    expect(cleanText('It&#8217;s &#x2014; fine &#39;q&#39; &#0;')).toBe('It’s — fine \'q\'');
    expect(cleanText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;'); // one pass, not two
    expect(cleanText('x'.repeat(500), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(cleanText('😀😀😀😀😀', 3)).toBe('😀😀…'); // no split surrogate pairs
    expect(cleanText(undefined)).toBe('');
  });

  it('plainText keeps angle brackets that are not tags', () => {
    expect(plainText('Array<string> and n < 10 &amp; m > 3')).toBe('Array<string> and n < 10 & m > 3');
    expect(cleanText('Array<string> x')).toBe('Array x'); // why plain-text fields need plainText
  });

  it('explains GitHub rate limiting and how to fix it', () => {
    const limited = new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790520000' } });
    expect(httpError('https://api.github.com/repos/a/b/issues', limited).message).toMatch(/^GitHub API rate limit reached until \d\d:\d\d\. Set GITHUB_TOKEN/);
    expect(httpError('https://api.github.com/repos/a/b', new Response('{}', { status: 403 })).message).toBe('api.github.com returned 403');
    expect(httpError('https://export.arxiv.org/api/query', new Response('', { status: 503 })).message).toBe('export.arxiv.org returned 503');
  });

  it('safeUrl allows only absolute http(s)', () => {
    expect(safeUrl('https://arxiv.org/abs/1')).toBe('https://arxiv.org/abs/1');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('/relative')).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});

describe('dedupeItems', () => {
  it('keeps one item per canonicalId (higher score), merging tags', () => {
    const arxiv = item({ id: 'arxiv:1', source: 'arxiv', sourceLabel: 'arXiv', canonicalId: 'arxiv:2609.1', score: 0, tags: ['cs.se'] });
    const hf = item({ id: 'hf-papers:2609.1', source: 'hf-papers', sourceLabel: 'Hugging Face papers', canonicalId: 'arxiv:2609.1', score: 12, tags: ['paper'] });
    const other = item({ id: 'arxiv:2', canonicalId: 'arxiv:2609.2' });
    const out = dedupeItems([arxiv, other, hf, hf]);
    expect(out.map((i) => i.id)).toEqual(['hf-papers:2609.1', 'arxiv:2']);
    expect(out[0].tags).toEqual(expect.arrayContaining(['paper', 'cs.se', 'also on arXiv']));
  });
});

describe('feed aggregation', () => {
  let root: string;
  let now: number;
  // The web-search source pauses seconds between queries by design; stub it here
  const webSearchSource = SOURCES.find((s) => s.id === 'web-search')!;
  const realWebSearchFetch = webSearchSource.fetch;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-discover-feed-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
    clearDiscoverCache(root);
    now = Date.parse('2026-09-27T12:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    webSearchSource.fetch = async () => { throw new Error('offline'); };
  });
  afterEach(() => {
    webSearchSource.fetch = realWebSearchFetch;
    vi.restoreAllMocks();
    clearDiscoverCache(root);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const failing = () => {
    const state = { calls: 0 };
    const impl = (async () => { state.calls++; throw new Error('offline'); }) as unknown as typeof fetch;
    return { state, impl };
  };

  it('registers every adapter source once', () => {
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['ai-news', 'web-search', 'hackernews', 'github-releases', 'hf-papers', 'arxiv', 'github-new-repos', 'mcp-registry', 'npm-updates', 'github-issues', 'github-ci']));
  });

  it('reports failing sources without failing the feed, and backs off instead of refetching on every request', async () => {
    const { state, impl } = failing();
    const first = await getDiscoverFeed(root, { fetchImpl: impl });
    expect(first.sources).toHaveLength(SOURCES.length);
    const errored = first.sources.filter((s) => s.error);
    expect(errored.length).toBeGreaterThan(0);
    expect(first.items).toEqual([]);
    // Nothing to fall back to, so nothing is marked stale
    expect(first.sources.some((s) => s.stale)).toBe(false);
    const afterFirst = state.calls;

    // Plain requests right after a failure do not refetch…
    for (let i = 0; i < 3; i++) { now += 1_000; await getDiscoverFeed(root, { fetchImpl: impl }); }
    expect(state.calls).toBe(afterFirst);
    // …nor does a forced refresh inside the minimum interval
    await getDiscoverFeed(root, { fetchImpl: impl, refresh: true });
    expect(state.calls).toBe(afterFirst);

    // After the error retry interval (5 min), a plain request retries
    now += 5 * 60_000 + 1;
    await getDiscoverFeed(root, { fetchImpl: impl });
    expect(state.calls).toBeGreaterThan(afterFirst);
  });

  it('discards results of fetches that were in flight when the settings changed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    const slow = (async () => { calls++; await gate; throw new Error('old settings'); }) as unknown as typeof fetch;
    const running = getDiscoverFeed(root, { fetchImpl: slow, deadlineMs: 60_000 });
    await new Promise((r) => setTimeout(r, 20));
    clearDiscoverCache(root);
    release();
    await running;
    // Nothing from the old run was cached: the next request fetches again
    const before = calls;
    const { impl, state } = failing();
    await getDiscoverFeed(root, { fetchImpl: impl });
    expect(state.calls).toBeGreaterThan(0);
    expect(calls).toBe(before);
  });

  it('answers by the deadline while slow sources keep loading', async () => {
    const never = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const started = performance.now();
    const feed = await getDiscoverFeed(root, { fetchImpl: never, deadlineMs: 50 });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(feed.sources.some((s) => s.error === 'Still loading — refresh in a moment.')).toBe(true);
  });
});

describe('daily digest', () => {
  const news = (id: string, org: string, date: string) => item({ id, category: 'news', source: 'ai-news', sourceLabel: org, date });

  it('highlights one item per organisation before any second one', () => {
    const items = [
      news('a1', 'OpenAI', '2026-09-27T10:00:00Z'), news('a2', 'OpenAI', '2026-09-27T09:00:00Z'),
      news('g1', 'Google DeepMind', '2026-09-26T10:00:00Z'), news('m1', 'Microsoft Research', '2026-09-25T10:00:00Z'),
      item({ id: 'r1', category: 'research' }),
    ];
    expect(pickHighlights(items).map((i) => i.id)).toEqual(['a1', 'g1', 'm1', 'a2']);
  });

  it('puts the labs before the press and web results', () => {
    const press = { ...news('p1', 'TechCrunch', '2026-09-27T11:00:00Z'), tags: ['press'] };
    const lab = { ...news('l1', 'OpenAI', '2026-09-26T09:00:00Z'), tags: ['lab'] };
    const web = { ...news('w1', 'Web search', '2026-09-27T11:30:00Z'), tags: ['web'] };
    expect(pickHighlights([press, web, lab]).map((i) => i.id)).toEqual(['l1', 'p1', 'w1']);
  });

  it('builds sections and marks what is new since the previous digest', () => {
    const today = [news('a1', 'OpenAI', '2026-09-27T10:00:00Z'), news('g1', 'Google DeepMind', '2026-09-26T10:00:00Z'), item({ id: 'r1', category: 'research' })];
    const previous = buildDigest('2026-09-26', [today[1]], [], null, 0);
    const d = buildDigest('2026-09-27', today, [{ source: 'arXiv', error: 'down' }], previous, 1);
    expect(d.sections.map((s) => s.category)).toEqual(['news', 'research']);
    expect(d.newIds.sort()).toEqual(['a1', 'r1']);
    expect(d.counts).toEqual({ news: 2, research: 1 });
    expect(d.errors).toEqual([{ source: 'arXiv', error: 'down' }]);
    // The first digest has no "previous", so nothing is flagged new
    expect(previous.newIds).toEqual([]);
  });

  it('stores digests by date and reads them back safely', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-digest-'));
    try {
      const dir = path.join(root, '.platform', 'discover-digests');
      fs.mkdirSync(dir, { recursive: true });
      for (const date of ['2026-09-25', '2026-09-27']) fs.writeFileSync(path.join(dir, `${date}.json`), JSON.stringify(buildDigest(date, [], [], null, 0)));
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
      fs.writeFileSync(path.join(dir, '2026-09-26.json'), '{broken');
      expect(listDigests(root).filter((d) => d !== '2026-09-26')).toEqual(['2026-09-27', '2026-09-25']);
      expect(readDigest(root, '2026-09-27')?.date).toBe('2026-09-27');
      expect(readDigest(root, '2026-09-26')).toBeNull();
      expect(readDigest(root, '../../etc/passwd')).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses server-local dates', () => {
    const t = new Date(2026, 8, 27, 23, 30).getTime();
    expect(localDate(t)).toBe('2026-09-27');
  });
});
