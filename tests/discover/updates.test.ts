import { describe, it, expect, vi } from 'vitest';
import type { DiscoverConfig, DiscoverItem, FetchLike } from '@/lib/discover/types';
import { USER_AGENT } from '@/lib/discover/types';
import {
  hackerNewsSource,
  hackerNewsSearchUrl,
  mergeHackerNews,
  parseHackerNews,
  pickKeywords,
  titleMentions,
} from '@/lib/discover/sources/hackernews';
import {
  githubReleasesSource,
  isMainPackage,
  isWatchableRepo,
  markdownToText,
  parseGithubReleases,
  pickRepoReleases,
  pickRepos,
  splitTag,
} from '@/lib/discover/sources/githubReleases';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const DAY = 24 * 3600_000;
const HOUR = 3600_000;

function cfg(over: Partial<DiscoverConfig> = {}): DiscoverConfig {
  return { keywords: [], watchedRepos: [], topics: [], repo: null, root: '/repo', now: () => NOW, ...over };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Call = { url: string; init?: RequestInit };
function fakeFetch(handler: (url: string) => Response): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url);
  });
  return { fetchImpl, calls };
}

const headersOf = (c: Call) => (c.init?.headers ?? {}) as Record<string, string>;

// Plain-text goals: no Markdown the goal box would show literally
const MARKDOWN = /[*`#]|\]\(/;

// ─── Hacker News ─────────────────────────────────────────────────────────────

// Trimmed from https://hn.algolia.com/api/v1/search?tags=story&query=coding%20agent&...
const HN_PAYLOAD = {
  hits: [
    {
      objectID: '49857729',
      title: 'Drawgent: Coding agent on a live Excalidraw canvas',
      url: 'https://tangled.org/yanndegat.tngl.sh/drawgent',
      author: 'parasitid',
      points: 157,
      num_comments: 42,
      created_at: '2026-09-26T15:56:34Z',
      created_at_i: 1790438194,
      _tags: ['story', 'author_parasitid', 'story_49857729', 'front_page'],
    },
    {
      objectID: '49858000',
      title: 'Ask HN: How do you coordinate   parallel coding agents?',
      story_text: 'We run several <em>coding</em> agents on one repo using worktrees.<p>What works &amp; what fails?',
      points: 64,
      num_comments: 30,
      created_at: '2026-09-25T10:00:00Z',
      created_at_i: 1790330400,
    },
    {
      objectID: '49859999',
      title: 'Totally legit agent',
      url: 'javascript:alert(1)',
      points: 900,
      created_at: '2026-09-25T10:00:00Z',
    },
  ],
  nbHits: 3,
  page: 0,
  hitsPerPage: 20,
};

type Hit = { objectID: string; title: string; url?: string; points?: number; created_at?: string };
const hit = (objectID: string, title: string, points: number, extra: Partial<Hit> = {}): Hit => ({
  objectID,
  title,
  url: `https://example.com/${objectID}`,
  points,
  created_at: '2026-09-26T00:00:00Z',
  ...extra,
});
const hn = (keyword: string, hits: Hit[]) => parseHackerNews({ hits }, keyword);
const ids = (items: DiscoverItem[]) => items.map((i) => i.id);

describe('parseHackerNews', () => {
  it('maps hits to items with stable ids, points as score and the keyword tag', () => {
    const items = parseHackerNews(HN_PAYLOAD, 'Coding Agent');
    expect(ids(items)).toEqual(['hackernews:49857729', 'hackernews:49858000']);
    const [first] = items;
    expect(first).toMatchObject({
      category: 'updates',
      source: 'hackernews',
      sourceLabel: 'Hacker News',
      title: 'Drawgent: Coding agent on a live Excalidraw canvas',
      url: 'https://tangled.org/yanndegat.tngl.sh/drawgent',
      score: 157,
      date: '2026-09-26T15:56:34.000Z',
      tags: ['news', 'coding agent'],
    });
    expect(first.summary).toBeUndefined();
  });

  it('links text posts to the discussion page and cleans story_text into the summary', () => {
    const ask = parseHackerNews(HN_PAYLOAD, 'coding agent')[1];
    expect(ask.url).toBe('https://news.ycombinator.com/item?id=49858000');
    expect(ask.title).toBe('Ask HN: How do you coordinate parallel coding agents?');
    expect(ask.summary).toBe('We run several coding agents on one repo using worktrees. What works & what fails?');
  });

  it('keeps titles as plain text: angle brackets survive, entities decode once', () => {
    const [item] = hn('mcp', [hit('6', 'Show HN: Typed Array<string> MCP tool calls &amp; <b>more</b> &amp;lt;3', 40)]);
    expect(item.title).toBe('Show HN: Typed Array<string> MCP tool calls & <b>more</b> &lt;3');
    expect(item.goal).toContain(item.title);
  });

  it('drops unsafe links, bad ids and untitled hits', () => {
    const items = parseHackerNews({
      hits: [
        { objectID: '1', title: 'unsafe', url: 'javascript:alert(1)', points: 50 },
        { objectID: '2', title: 'data', url: 'data:text/html,hi', points: 50 },
        { objectID: '../x', title: 'bad id', points: 50 },
        { objectID: '3', title: '', url: 'https://example.com', points: 50 },
        { objectID: '5', title: '   ', url: 'https://example.com', points: 50 },
        null,
        { objectID: '4', title: 'ok', url: 'https://example.com/ok', points: 50 },
      ],
    });
    expect(ids(items)).toEqual(['hackernews:4']);
    expect(items[0].tags).toEqual(['news']);
  });

  it('returns [] for payloads without hits', () => {
    expect(parseHackerNews(null)).toEqual([]);
    expect(parseHackerNews({ message: 'error' })).toEqual([]);
  });

  it('writes a plain-text goal naming the story, its URL and the OpenCode area it touches', () => {
    for (const item of parseHackerNews(HN_PAYLOAD, 'coding agent')) {
      expect(item.goal).toContain(`"${item.title}"`);
      expect(item.goal).toContain(item.url);
      expect(item.goal).toMatch(/OpenCode's .*src\/lib\//);
      expect(item.goal).not.toMatch(MARKDOWN);
    }
    const [drawgent, ask] = parseHackerNews(HN_PAYLOAD, 'coding agent');
    expect(drawgent.goal).toContain('agent loop (src/lib/agentLoop.ts)');
    expect(ask.goal).toContain('sub-agents (src/lib/subagents.ts)');
    expect(hn('mcp', [hit('5', 'An MCP server for Postgres', 40)])[0].goal).toContain('MCP client (src/lib/mcpClient.ts');
    expect(hn('tool use', [hit('6', 'Tool use at scale', 40)])[0].goal).toContain('src/lib/tools.ts');
  });

  it('gives stories that touch no OpenCode area a neutral read-and-decide goal', () => {
    // The search keyword ('mcp') must not lend the story an area it does not have
    const [item] = hn('mcp', [hit('8', 'Show HN: A faster JSON parser', 300)]);
    expect(item.goal).toMatch(/^Read the Hacker News story "Show HN: A faster JSON parser" \(https:\/\/example\.com\/8\) and decide whether it matters for OpenCode/);
    expect(item.goal).not.toMatch(/evaluate whether|MCP client \(/);
    expect(item.goal).not.toMatch(MARKDOWN);
  });

  it('keeps ids stable across refreshes', () => {
    expect(ids(parseHackerNews(HN_PAYLOAD, 'a'))).toEqual(ids(parseHackerNews(structuredClone(HN_PAYLOAD), 'b')));
  });
});

describe('titleMentions', () => {
  it('matches every keyword word as a whole word, plurals allowed', () => {
    expect(titleMentions('How to keep enjoying programming in a world of LLMs', 'LLM')).toBe(true);
    expect(titleMentions('The new CC, an AI agent built for families', 'AI agent')).toBe(true);
    expect(titleMentions('Cloud agents are inevitable AI prisons', 'AI agent')).toBe(true);
    expect(titleMentions("AI's next step", 'ai')).toBe(true);
    expect(titleMentions('Coding-agent tips', 'coding agent')).toBe(true);
  });

  it('does not match prefixes, partial phrases or empty keywords', () => {
    expect(titleMentions('Airbnb raises its fees', 'AI')).toBe(false);
    expect(titleMentions('LLMOps is a job title now', 'LLM')).toBe(false);
    expect(titleMentions('An AI for chess', 'AI agent')).toBe(false);
    expect(titleMentions('Anything', ' -- ')).toBe(false);
  });
});

describe('mergeHackerNews', () => {
  it('dedupes by story, unions keyword tags and ranks by OpenCode relevance, then points', () => {
    const a = parseHackerNews(HN_PAYLOAD, 'coding agent');
    const b = hn('tool use', [HN_PAYLOAD.hits[0] as Hit, hit('7', 'Tool use at scale', 500)]);
    const merged = mergeHackerNews([a, b]);
    // Both HN_PAYLOAD stories touch more areas (agents, coding) than the 500-point one
    expect(ids(merged)).toEqual(['hackernews:49857729', 'hackernews:49858000', 'hackernews:7']);
    expect(merged[0].tags).toEqual(['news', 'coding agent', 'tool use']);
    expect(a[0].tags).toEqual(['news', 'coding agent']); // inputs untouched
  });

  it('ranks equally relevant stories by points, then date', () => {
    const merged = mergeHackerNews([
      hn('coding agent', [
        hit('1', 'Coding agent one', 50, { created_at: '2026-09-20T00:00:00Z' }),
        hit('2', 'Coding agent two', 80),
        hit('3', 'Coding agent three', 50, { created_at: '2026-09-26T00:00:00Z' }),
      ]),
    ]);
    expect(ids(merged)).toEqual(['hackernews:2', 'hackernews:3', 'hackernews:1']);
  });

  it('drops stories whose title neither touches an OpenCode area nor names a keyword', () => {
    const merged = mergeHackerNews([
      hn('ai', [
        hit('1', 'Airbnb raises its fees', 900), // Algolia prefix match on 'ai'
        hit('2', 'AI is eating the world', 120), // names the keyword: kept, neutral goal
        hit('3', 'Coding agent for spreadsheets', 40), // touches an area: kept
      ]),
      parseHackerNews({ hits: [hit('4', 'Show HN: A faster JSON parser', 700)] }), // no keyword, no area
    ]);
    expect(ids(merged)).toEqual(['hackernews:3', 'hackernews:2']);
    expect(merged[1].goal).toMatch(/decide whether it matters for OpenCode/);
  });

  it('takes stories round-robin by keyword so a broad keyword cannot fill the feed', () => {
    const broad = hn('coding agent', Array.from({ length: 20 }, (_, n) => hit(`1${n}`, `Coding agent story ${n}`, 1000 + n)));
    const narrow = hn('mcp', [hit('21', 'MCP server for Postgres', 35), hit('22', 'MCP gateway', 31), hit('23', 'MCP auth', 30)]);
    const merged = mergeHackerNews([broad, narrow]);
    expect(merged).toHaveLength(15);
    expect(ids(merged)).toEqual(expect.arrayContaining(['hackernews:21', 'hackernews:22', 'hackernews:23']));
    // Within its quota the broad keyword keeps its best stories
    expect(merged.filter((i) => i.tags.includes('coding agent')).map((i) => i.score)).toEqual(
      Array.from({ length: 12 }, (_, n) => 1019 - n),
    );
  });

  it('gives each keyword an equal share when all have plenty', () => {
    const lists = ['llm', 'coding agent', 'mcp'].map((kw, k) =>
      hn(kw, Array.from({ length: 20 }, (_, n) => hit(`${k + 1}0${n}`, `${kw} story ${n}`, 100 * (3 - k) + n))),
    );
    const merged = mergeHackerNews(lists);
    expect(merged).toHaveLength(15);
    for (const kw of ['llm', 'coding agent', 'mcp']) expect(merged.filter((i) => i.tags.includes(kw))).toHaveLength(5);
  });

  it('counts a story found by two keywords once and gives the next pick to the other keyword', () => {
    const shared = hit('9', 'MCP coding agent', 500);
    const merged = mergeHackerNews(
      [hn('coding agent', [shared, hit('1', 'Coding agent A', 90)]), hn('mcp', [shared, hit('2', 'MCP server B', 80)])],
      3,
    );
    expect(ids(merged).sort()).toEqual(['hackernews:1', 'hackernews:2', 'hackernews:9']);
    expect(merged.find((i) => i.id === 'hackernews:9')!.tags).toEqual(['news', 'coding agent', 'mcp']);
  });

  it('caps the feed at 15 items', () => {
    const hits = Array.from({ length: 25 }, (_, n) => hit(String(n + 1), `Coding agent story ${n + 1}`, n));
    const merged = mergeHackerNews([parseHackerNews({ hits })]);
    expect(merged).toHaveLength(15);
    expect(merged[0].score).toBe(24);
  });
});

describe('pickKeywords / hackerNewsSearchUrl', () => {
  it('takes up to 4 distinct non-empty keywords', () => {
    expect(pickKeywords(['a', ' ', 'A', 'b', 7, 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd']);
    expect(pickKeywords(undefined)).toEqual([]);
  });

  it('encodes the query and the filters and searches titles only', () => {
    const url = hackerNewsSearchUrl('tool use&tags=comment', 1_790_000_000);
    expect(url).toBe(
      'https://hn.algolia.com/api/v1/search?tags=story&query=tool%20use%26tags%3Dcomment' +
        '&numericFilters=created_at_i%3E1790000000%2Cpoints%3E%3D30&hitsPerPage=20&typoTolerance=false&restrictSearchableAttributes=title',
    );
    const params = new URL(url).searchParams;
    expect(params.getAll('tags')).toEqual(['story']);
    expect(params.get('restrictSearchableAttributes')).toBe('title');
  });
});

describe('hackerNewsSource.fetch', () => {
  it('queries each keyword with a 7-day window, merges and ranks', async () => {
    const { fetchImpl, calls } = fakeFetch((url) =>
      new URL(url).searchParams.get('query') === 'tool use'
        ? json({ hits: [{ objectID: '7', title: 'Tool use at scale', url: 'https://top.dev', points: 500 }] })
        : json(HN_PAYLOAD),
    );
    const items = await hackerNewsSource.fetch(fetchImpl, cfg({ keywords: ['coding agent', 'tool use', 'coding agent', 'x', 'y', 'z'] }));
    expect(calls.map((c) => new URL(c.url).searchParams.get('query'))).toEqual(['coding agent', 'tool use', 'x', 'y']);
    const since = Math.floor(NOW / 1000) - 7 * 24 * 3600;
    for (const c of calls) {
      const params = new URL(c.url).searchParams;
      expect(params.get('numericFilters')).toBe(`created_at_i>${since},points>=30`);
      expect(params.get('restrictSearchableAttributes')).toBe('title');
      expect(headersOf(c)['User-Agent']).toBe(USER_AGENT);
      expect(c.init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(ids(items)).toEqual(['hackernews:49857729', 'hackernews:49858000', 'hackernews:7']);
    expect(items[0].tags).toEqual(['news', 'coding agent', 'x', 'y']);
  });

  it('prefers newsKeywords over research keywords', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ hits: [] }));
    await hackerNewsSource.fetch(fetchImpl, cfg({ keywords: ['program synthesis'], newsKeywords: ['LLM'] }));
    expect(calls.map((c) => new URL(c.url).searchParams.get('query'))).toEqual(['LLM']);
  });

  it('makes no request without keywords', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(HN_PAYLOAD));
    expect(await hackerNewsSource.fetch(fetchImpl, cfg({ keywords: ['  '] }))).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('tolerates one failing keyword', async () => {
    const { fetchImpl } = fakeFetch((url) => (new URL(url).searchParams.get('query') === 'bad' ? json({}, 503) : json(HN_PAYLOAD)));
    const items = await hackerNewsSource.fetch(fetchImpl, cfg({ keywords: ['bad', 'coding agent'] }));
    expect(items).toHaveLength(2);
  });

  it('throws a clear error when every request fails', async () => {
    const { fetchImpl } = fakeFetch(() => json({ message: 'down' }, 500));
    await expect(hackerNewsSource.fetch(fetchImpl, cfg({ keywords: ['coding agent'] }))).rejects.toThrow(
      'Hacker News search failed: hn.algolia.com returned 500',
    );
  });
});

// ─── GitHub releases ─────────────────────────────────────────────────────────

// Trimmed from https://api.github.com/repos/anthropics/anthropic-sdk-typescript/releases?per_page=3
const GH_PAYLOAD = [
  {
    id: 393930874,
    html_url: 'https://github.com/anthropics/anthropic-sdk-typescript/releases/tag/sdk-v0.128.0',
    tag_name: 'sdk-v0.128.0',
    name: 'sdk: v0.128.0',
    draft: false,
    prerelease: false,
    created_at: '2026-09-22T16:27:00Z',
    published_at: '2026-09-22T16:27:55Z',
    body:
      '## 0.128.0 (2026-09-22)\n\nFull Changelog: [sdk-v0.127.0...sdk-v0.128.0](https://github.com/anthropics/anthropic-sdk-typescript/compare/sdk-v0.127.0...sdk-v0.128.0)\n\n' +
      '### Features\n\n* **api:** add inline tool definitions ([eff2748](https://github.com/anthropics/anthropic-sdk-typescript/commit/eff2748))',
    reactions: { total_count: 12, '+1': 10, heart: 2 },
  },
  {
    id: 393930999,
    html_url: 'https://github.com/anthropics/anthropic-sdk-typescript/releases/tag/sdk-v1.0.0-beta.1',
    tag_name: 'sdk-v1.0.0-beta.1',
    name: 'Agents beta',
    draft: false,
    prerelease: true,
    published_at: '2026-09-25T09:00:00Z',
    body: 'Try the new `agents` API.\r\n- one\r\n- two',
  },
  {
    id: 393930100,
    html_url: 'https://github.com/anthropics/anthropic-sdk-typescript/releases/tag/sdk-v0.100.0',
    tag_name: 'sdk-v0.100.0',
    name: 'sdk: v0.100.0',
    draft: false,
    prerelease: false,
    published_at: '2026-06-01T00:00:00Z',
    body: 'old',
  },
];
const REPO = 'anthropics/anthropic-sdk-typescript';

type Rel = { tag_name: string; name?: string; prerelease?: boolean; html_url: string; published_at: string };
/** A release of `repo` published `ago` ms before NOW. */
const rel = (repo: string, tag_name: string, ago: number, prerelease = false): Rel => ({
  tag_name,
  prerelease,
  html_url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag_name)}`,
  published_at: new Date(NOW - ago).toISOString(),
});
const titles = (items: DiscoverItem[]) => items.map((i) => i.title);

/** Serves each repo's releases newest-created first, honouring per_page like the real API. */
function releasesFetch(byRepo: Record<string, unknown[]>, fallback: unknown[] = []) {
  return fakeFetch((url) => {
    const u = new URL(url);
    const repo = u.pathname.replace(/^\/repos\//, '').replace(/\/releases$/, '');
    const perPage = Number(u.searchParams.get('per_page') ?? 30);
    return json((byRepo[repo] ?? fallback).slice(0, perPage));
  });
}

describe('parseGithubReleases', () => {
  it('keeps recent non-draft releases with titles, tags and reactions as score', () => {
    const items = parseGithubReleases(GH_PAYLOAD, REPO, NOW);
    expect(ids(items)).toEqual([
      'github-releases:anthropics/anthropic-sdk-typescript:sdk-v0.128.0',
      'github-releases:anthropics/anthropic-sdk-typescript:sdk-v1.0.0-beta.1',
    ]);
    expect(items[0]).toMatchObject({
      category: 'updates',
      source: 'github-releases',
      sourceLabel: 'GitHub releases',
      title: 'anthropics/anthropic-sdk-typescript sdk-v0.128.0',
      url: 'https://github.com/anthropics/anthropic-sdk-typescript/releases/tag/sdk-v0.128.0',
      date: '2026-09-22T16:27:55.000Z',
      score: 12,
      tags: ['release'],
      summary: '0.128.0 (2026-09-22) Features api: add inline tool definitions (eff2748)',
    });
    expect(items[1]).toMatchObject({
      title: 'anthropics/anthropic-sdk-typescript sdk-v1.0.0-beta.1 — Agents beta',
      tags: ['prerelease', 'major'],
      summary: 'Try the new agents API. one two',
    });
    expect(items[1].score).toBeUndefined();
  });

  it('drops drafts, unsafe or missing URLs, missing tags and bad dates', () => {
    const base = GH_PAYLOAD[0];
    const items = parseGithubReleases(
      [
        { ...base, draft: true },
        { ...base, html_url: 'javascript:alert(1)' },
        { ...base, html_url: undefined },
        { ...base, tag_name: '' },
        { ...base, published_at: null },
        { ...base, published_at: 'not a date' },
        'junk',
        { ...base, tag_name: 'v2.0.0', name: 'v2.0.0' },
      ],
      'openai/openai-node',
      NOW,
    );
    expect(titles(items)).toEqual(['openai/openai-node v2.0.0']);
    expect(items[0].tags).toEqual(['release', 'major']);
    expect(parseGithubReleases({ message: 'Not Found' }, REPO, NOW)).toEqual([]);
  });

  it('applies the 45-day window from the injected clock', () => {
    const at = (d: number) => [{ ...GH_PAYLOAD[0], published_at: new Date(NOW - d * DAY).toISOString() }];
    expect(parseGithubReleases(at(44), REPO, NOW)).toHaveLength(1);
    expect(parseGithubReleases(at(46), REPO, NOW)).toHaveLength(0);
  });

  it('adds the release name only when it says more than the tag', () => {
    const title = (tag_name: string, name: unknown) => parseGithubReleases([{ ...GH_PAYLOAD[0], tag_name, name }], 'o/r', NOW)[0].title;
    expect(title('sdk-v0.128.0', 'x'.repeat(80))).toBe('o/r sdk-v0.128.0');
    expect(title('v0.40.0-rc0', 'v0.40.0')).toBe('o/r v0.40.0-rc0');
    expect(title('v2.0.0', 'v2.0.0: Agents')).toBe('o/r v2.0.0 — Agents');
    expect(title('v2.0.0', 'Agents')).toBe('o/r v2.0.0 — Agents');
    expect(title('v2.0.0', null)).toBe('o/r v2.0.0');
  });

  it('keeps tags and names as plain text: angle brackets survive, entities decode once', () => {
    const title = (tag_name: string, name: unknown) => parseGithubReleases([{ ...GH_PAYLOAD[0], tag_name, name }], 'o/r', NOW)[0].title;
    expect(title('v2.1.0', 'Typed Array<string> params')).toBe('o/r v2.1.0 — Typed Array<string> params');
    expect(title('v2.1.0', 'Fixes &amp; &amp;lt;tweaks&amp;gt;')).toBe('o/r v2.1.0 — Fixes & &lt;tweaks&gt;');
    expect(title('v2.1.0', '  Multi\n  line  ')).toBe('o/r v2.1.0 — Multi line');
  });

  it('writes a plain-text goal naming the release, its URL and the OpenCode area', () => {
    const [stable, pre] = parseGithubReleases(GH_PAYLOAD, REPO, NOW);
    for (const item of [stable, pre]) {
      expect(item.goal).toContain(item.title);
      expect(item.goal).toContain(item.url);
      expect(item.goal).toContain('src/lib/llmClient.ts');
      expect(item.goal).not.toMatch(MARKDOWN);
    }
    expect(stable.goal).not.toMatch(/prerelease/);
    expect(pre.goal).toMatch(/prerelease/);
    const [mcp] = parseGithubReleases([GH_PAYLOAD[0]], 'modelcontextprotocol/typescript-sdk', NOW);
    expect(mcp.goal).toContain('MCP client');
    const [other] = parseGithubReleases([GH_PAYLOAD[0]], 'org/unknown', NOW);
    expect(other.goal).toMatch(/src\/lib\/agentLoop\.ts.*src\/lib\/tools\.ts.*src\/lib\/mcpClient\.ts/);
  });

  it('asks stable-release goals to adapt the code compatibly and leaves the version bump to a person', () => {
    const [stable] = parseGithubReleases(GH_PAYLOAD, REPO, NOW);
    expect(stable.goal).toMatch(/Adapt OpenCode's code to the new capabilities/);
    expect(stable.goal).toMatch(/keep working with the version installed now/);
    expect(stable.goal).toMatch(/version bump itself is applied manually/);
    expect(stable.goal).not.toMatch(/\bbump (it|the (package|dependency))\b|package\.json|npm (i|install|update)\b|upgrade the package/i);
  });

  it('asks prerelease goals to assess and record findings, not ship', () => {
    const [item] = parseGithubReleases([rel('org/x', 'v2.0.0-rc.1', DAY, true)], 'org/x', NOW);
    expect(item.goal).toMatch(/prerelease: assess what it would let OpenCode do and what it would break/);
    expect(item.goal).toMatch(/record the findings without shipping code that depends on it/);
    expect(item.goal).not.toMatch(/\bbump\b|package\.json/i);
    expect(item.goal.split(/(?<=\.)\s+(?=[A-Z])/)).toHaveLength(2);
  });

  it('keeps ids stable across refreshes and repo casing', () => {
    expect(ids(parseGithubReleases(GH_PAYLOAD, 'Anthropics/Anthropic-SDK-TypeScript', NOW))).toEqual(ids(parseGithubReleases(GH_PAYLOAD, REPO, NOW)));
  });
});

describe('splitTag / isMainPackage', () => {
  it('splits monorepo tags into package and version', () => {
    expect(splitTag('ai@7.0.1')).toEqual({ pkg: 'ai', version: '7.0.1' });
    expect(splitTag('@ai-sdk/gateway@4.0.96')).toEqual({ pkg: '@ai-sdk/gateway', version: '4.0.96' });
    expect(splitTag('@modelcontextprotocol/server@2.0.0-beta.5')).toEqual({ pkg: '@modelcontextprotocol/server', version: '2.0.0-beta.5' });
    expect(splitTag('sdk-v0.128.0')).toEqual({ pkg: 'sdk', version: '0.128.0' });
    expect(splitTag('vertex-sdk-v0.19.11')).toEqual({ pkg: 'vertex-sdk', version: '0.19.11' });
    expect(splitTag('google-cloud-sdk-v0.0.14')).toEqual({ pkg: 'google-cloud-sdk', version: '0.0.14' });
  });

  it('leaves plain version tags, suffixes included, without a package', () => {
    expect(splitTag('v16.4.0-canary.50')).toEqual({ pkg: '', version: '16.4.0-canary.50' });
    expect(splitTag('1.30.1')).toEqual({ pkg: '', version: '1.30.1' });
    expect(splitTag('v1.0.0-beta-2')).toEqual({ pkg: '', version: '1.0.0-beta-2' });
    expect(splitTag('b6543')).toEqual({ pkg: '', version: 'b6543' });
  });

  it('treats unprefixed tags and packages named after the repo as the main package', () => {
    expect(isMainPackage('', 'vercel/next.js')).toBe(true);
    expect(isMainPackage('ai', 'vercel/ai')).toBe(true);
    expect(isMainPackage('sdk', 'anthropics/anthropic-sdk-typescript')).toBe(true);
    expect(isMainPackage('@anthropic-ai/sdk', 'anthropics/anthropic-sdk-typescript')).toBe(true);
    expect(isMainPackage('@ai-sdk/gateway', 'vercel/ai')).toBe(false);
    expect(isMainPackage('vertex-sdk', 'anthropics/anthropic-sdk-typescript')).toBe(false);
    expect(isMainPackage('@modelcontextprotocol/client', 'modelcontextprotocol/typescript-sdk')).toBe(false);
  });
});

describe('pickRepoReleases', () => {
  it('prefers the main package over newer sub-package releases (vercel/ai)', () => {
    const r = (tag: string, ago: number, pre = false) => rel('vercel/ai', tag, ago, pre);
    const payload = [
      r('@ai-sdk/workflow@2.0.49', 1 * HOUR),
      r('@ai-sdk/vue@4.0.118', 2 * HOUR),
      r('@ai-sdk/gateway@4.0.96', 3 * HOUR),
      r('ai@7.0.118', 6 * HOUR),
      r('ai@8.0.0-beta.1', 7 * HOUR, true),
      r('ai@7.0.117', 9 * HOUR),
      r('ai@7.0.116', 20 * HOUR),
    ];
    expect(titles(pickRepoReleases(payload, 'vercel/ai', NOW))).toEqual(['vercel/ai ai@7.0.118', 'vercel/ai ai@7.0.117']);
  });

  it('prefers the main SDK over sibling SDKs released alongside (anthropic monorepo)', () => {
    const r = (tag: string, ago: number) => rel(REPO, tag, ago);
    const payload = [
      r('vertex-sdk-v0.19.11', 5 * DAY - 6 * 60_000),
      r('sdk-v0.128.0', 5 * DAY),
      r('google-cloud-sdk-v0.0.14', 5 * DAY - 30 * 60_000),
      r('bedrock-sdk-v0.33.8', 5 * DAY - 12 * 60_000),
      r('vertex-sdk-v0.19.10', 9 * DAY - 6 * 60_000),
      r('sdk-v0.127.0', 9 * DAY),
    ];
    expect(titles(pickRepoReleases(payload, REPO, NOW))).toEqual([`${REPO} sdk-v0.128.0`, `${REPO} sdk-v0.127.0`]);
  });

  it('fills the remaining slot with sub-packages, stable first, when the main package has too few', () => {
    const r = (tag: string, ago: number, pre = false) => rel('modelcontextprotocol/typescript-sdk', tag, ago, pre);
    const payload = [
      r('1.30.1', 4 * DAY),
      r('@modelcontextprotocol/server@2.2.0-beta.1', 1 * DAY, true),
      r('@modelcontextprotocol/client@2.1.0', 4 * DAY + HOUR),
      r('@modelcontextprotocol/server@2.1.0', 4 * DAY + 2 * HOUR),
      r('1.30.0', 60 * DAY), // outside the window
    ];
    expect(titles(pickRepoReleases(payload, 'modelcontextprotocol/typescript-sdk', NOW))).toEqual([
      'modelcontextprotocol/typescript-sdk 1.30.1',
      'modelcontextprotocol/typescript-sdk @modelcontextprotocol/client@2.1.0',
    ]);
  });

  it('shows sub-packages when a repo only has sub-package tags', () => {
    const payload = [rel('org/tools', 'rust-v0.2.0-alpha.1', HOUR, true), rel('org/tools', 'rust-v0.1.9', DAY), rel('org/tools', 'python-v1.4.0', 2 * DAY)];
    expect(titles(pickRepoReleases(payload, 'org/tools', NOW))).toEqual(['org/tools rust-v0.1.9', 'org/tools python-v1.4.0']);
  });

  it('puts stable before prerelease and the newest major before backports (next.js canaries)', () => {
    const r = (tag: string, ago: number, pre = false) => rel('vercel/next.js', tag, ago, pre);
    const payload = [
      r('v16.4.0-canary.50', 1 * HOUR, true),
      r('v16.4.0-canary.49', 3 * HOUR, true),
      r('v15.5.26', 5 * DAY - 60_000), // backport to the previous major
      r('v16.3.6', 5 * DAY),
      r('v16.3.5', 16 * DAY),
    ];
    expect(titles(pickRepoReleases(payload, 'vercel/next.js', NOW))).toEqual(['vercel/next.js v16.3.6', 'vercel/next.js v16.3.5']);
    // With only one current stable, the backport still beats the canaries
    expect(titles(pickRepoReleases(payload.slice(0, 4), 'vercel/next.js', NOW))).toEqual(['vercel/next.js v16.3.6', 'vercel/next.js v15.5.26']);
    // A canary of the next major does not make the current stable a backport
    expect(titles(pickRepoReleases([r('v17.0.0-canary.1', HOUR, true), r('v16.3.6', DAY)], 'vercel/next.js', NOW, 1))).toEqual(['vercel/next.js v16.3.6']);
  });

  it('falls back to prereleases, newest first, when a repo has no stable release', () => {
    const payload = [1, 2, 3].map((k) => rel('org/busy', `v2.0.0-canary.${k}`, (4 - k) * HOUR, true));
    expect(titles(pickRepoReleases(payload, 'org/busy', NOW))).toEqual(['org/busy v2.0.0-canary.3', 'org/busy v2.0.0-canary.2']);
  });
});

describe('markdownToText / repo validation', () => {
  it('strips Markdown syntax and changelog links', () => {
    expect(markdownToText('### Fix\n* **core:** [#12](https://x/12) `a` ![img](https://i)\nFull Changelog: https://x/compare')).toBe(
      'Fix\ncore: #12 a \n',
    );
    expect(markdownToText(undefined)).toBe('');
  });

  it('accepts owner/name only', () => {
    for (const ok of ['ollama/ollama', 'vercel/next.js', 'a-b/c_d.e']) expect(isWatchableRepo(ok), ok).toBe(true);
    for (const bad of ['ollama', 'a/b/c', '../etc', 'owner/..', 'owner/.', 'own er/x', 'o/x?y=1', 'o/x#y', 42]) {
      expect(isWatchableRepo(bad), String(bad)).toBe(false);
    }
    expect(pickRepos(['x/y', 'X/Y', 'bad', ' a/b ', null])).toEqual(['x/y', 'a/b']);
  });
});

describe('githubReleasesSource.fetch', () => {
  it('fetches 30 releases of each valid repo with GitHub headers and merges newest first', async () => {
    const { fetchImpl, calls } = releasesFetch({
      'ollama/ollama': [{ ...GH_PAYLOAD[0], tag_name: 'v0.12.3', name: 'v0.12.3', html_url: 'https://github.com/ollama/ollama/releases/tag/v0.12.3', published_at: '2026-09-26T00:00:00Z' }],
      [REPO]: GH_PAYLOAD,
    });
    const items = await githubReleasesSource.fetch(
      fetchImpl,
      cfg({ watchedRepos: ['ollama/ollama', 'owner/..', 'not a repo', 'a/b/c', REPO], githubToken: 'test-token' }),
    );
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/ollama/ollama/releases?per_page=30',
      `https://api.github.com/repos/${REPO}/releases?per_page=30`,
    ]);
    for (const c of calls) {
      expect(headersOf(c)).toMatchObject({
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: 'Bearer test-token',
        'User-Agent': USER_AGENT,
      });
      expect(c.init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(titles(items)).toEqual([
      'ollama/ollama v0.12.3',
      'anthropics/anthropic-sdk-typescript sdk-v1.0.0-beta.1 — Agents beta',
      'anthropics/anthropic-sdk-typescript sdk-v0.128.0',
    ]);
  });

  it('omits Authorization without a token and makes no request without valid repos', async () => {
    const { fetchImpl, calls } = releasesFetch({});
    await githubReleasesSource.fetch(fetchImpl, cfg({ watchedRepos: ['x/y'] }));
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
    expect(await githubReleasesSource.fetch(fetchImpl, cfg({ watchedRepos: ['../../etc/passwd'] }))).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('caps the merged feed at 15 items', async () => {
    const repos = Array.from({ length: 8 }, (_, n) => `org/repo${n}`);
    const byRepo = Object.fromEntries(repos.map((repo) => [repo, [1, 2, 3].map((k) => rel(repo, `v1.${k}.1`, k * DAY))]));
    expect(await githubReleasesSource.fetch(releasesFetch(byRepo).fetchImpl, cfg({ watchedRepos: repos }))).toHaveLength(15);
  });

  it('finds stable releases behind a page of canaries: at most 2 per repo, stable first', async () => {
    // 12 canaries newer than the stables: a 3-release page would have held canaries only
    const busy = Array.from({ length: 12 }, (_, k) => rel('org/busy', `v2.0.0-canary.${12 - k}`, (k + 1) * HOUR, true)).concat(
      [4, 5, 6].map((k) => rel('org/busy', `v1.${k}.0`, k * DAY)),
    );
    const { fetchImpl } = releasesFetch({ 'org/busy': busy, 'org/quiet': [rel('org/quiet', 'v9.0.0', 10 * DAY)] });
    const items = await githubReleasesSource.fetch(fetchImpl, cfg({ watchedRepos: ['org/busy', 'org/quiet'] }));
    expect(titles(items)).toEqual(['org/busy v1.4.0', 'org/busy v1.5.0', 'org/quiet v9.0.0']);
  });

  it('shows the main SDK of a monorepo whose sub-packages released more recently', async () => {
    const aiTrain = Array.from({ length: 25 }, (_, k) => rel('vercel/ai', `@ai-sdk/provider-${k}@3.0.${k}`, (k + 1) * 60_000)).concat([
      rel('vercel/ai', 'ai@7.0.118', 2 * HOUR),
      rel('vercel/ai', 'ai@7.0.117', 5 * HOUR),
    ]);
    const { fetchImpl } = releasesFetch({ 'vercel/ai': aiTrain });
    const items = await githubReleasesSource.fetch(fetchImpl, cfg({ watchedRepos: ['vercel/ai'] }));
    expect(titles(items)).toEqual(['vercel/ai ai@7.0.118', 'vercel/ai ai@7.0.117']);
  });

  it('survives a failing repo but throws when all fail', async () => {
    const { fetchImpl } = fakeFetch((url) => (url.includes('/repos/gone/repo/') ? json({ message: 'Not Found' }, 404) : json(GH_PAYLOAD)));
    expect(await githubReleasesSource.fetch(fetchImpl, cfg({ watchedRepos: ['gone/repo', REPO] }))).toHaveLength(2);

    const down = fakeFetch(() => json({ message: 'API rate limit exceeded' }, 403));
    await expect(githubReleasesSource.fetch(down.fetchImpl, cfg({ watchedRepos: ['gone/repo', REPO] }))).rejects.toThrow(
      'GitHub releases failed for all 2 watched repos; first error: gone/repo: api.github.com returned 403',
    );
  });
});
