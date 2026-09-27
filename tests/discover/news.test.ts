import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import type { DiscoverConfig, DiscoverItem, FetchLike } from '@/lib/discover/types';
import { USER_AGENT } from '@/lib/discover/types';
import {
  NEWS_FEEDS,
  aiNewsSource,
  canonicalNewsId,
  fetchNewsFeeds,
  isFeed,
  mergeNewsItems,
  newsGoal,
  parseFeed,
  summarizeFeedFailures,
  toNewsItems,
  type NewsFeed,
} from '@/lib/discover/sources/aiNews';
import {
  RATE_LIMITED_MESSAGE,
  makeWebSearchSource,
  newsQueries,
  toSearchItems,
  webSearchNewsSource,
} from '@/lib/discover/sources/webSearchNews';
import type { SearchResult } from '@/lib/webTools';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const DAY = 24 * 3600_000;
const sha = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function cfg(over: Partial<DiscoverConfig> = {}): DiscoverConfig {
  return { keywords: [], watchedRepos: [], topics: [], repo: null, root: '/repo', now: () => NOW, ...over };
}

type Call = { url: string; init?: RequestInit };
function fakeFetch(handler: (url: string) => Response | Promise<Response>): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url);
  });
  return { fetchImpl, calls };
}

const xml = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/rss+xml' } });

// Every class of goal must stay within what an upgrade candidate may do
function expectSafeGoal(goal: string) {
  expect(goal).toMatch(/OpenCode/);
  expect(goal).not.toMatch(/npm (?:i|install|update|upgrade)\b|bump (?:the )?(?:dependenc|package)|(?<!not )edit package\.json/i);
}

// ─── Feed fixtures ───────────────────────────────────────────────────────────

// Shapes seen live: OpenAI (CDATA titles), AWS/MIT (escaped HTML), Microsoft
// Research (WordPress footer), DeepMind (<description/>), relative links.
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title><![CDATA[Lab News]]></title>
    <atom:link href="https://lab.example/rss.xml" rel="self" type="application/rss+xml"/>
    <link>https://lab.example/news</link>
    <item>
      <title><![CDATA[GPT-7 adds Array<string> outputs & more]]></title>
      <description><![CDATA[<p>Structured <b>outputs</b> for tool calls.</p>
<p>The post <a href="https://lab.example/x">GPT-7</a> appeared first on <a href="https://lab.example">Lab</a>.</p>]]></description>
      <link>https://lab.example/index/gpt-7</link>
      <guid isPermaLink="true">https://lab.example/index/gpt-7</guid>
      <pubDate>Fri, 25 Sep 2026 19:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Tools &amp; MCP: what&#8217;s new in &lt;agents&gt;</title>
      <description>&lt;p&gt;Escaped &lt;em&gt;HTML&lt;/em&gt; &amp;amp; entities [&amp;#8230;]&lt;/p&gt;</description>
      <link>
        /news/tools-and-mcp
      </link>
      <pubDate>Thu, 24 Sep 2026 10:00:00 -0400</pubDate>
    </item>
    <item>
      <title>Guid permalink only</title>
      <guid>https://lab.example/news/guid-only</guid>
      <dc:date>2026-09-23T08:00:00Z</dc:date>
    </item>
    <item>
      <title>Opaque guid is not a link</title>
      <guid isPermaLink="false">ea9c3794156b</guid>
      <pubDate>Wed, 23 Sep 2026 08:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Unsafe link</title>
      <link>javascript:alert(1)</link>
      <pubDate>Wed, 23 Sep 2026 08:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Old post</title>
      <link>https://lab.example/news/old</link>
      <pubDate>Mon, 14 Sep 2026 08:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Undated post</title>
      <link>https://lab.example/news/undated</link>
    </item>
    <item>
      <title>From the future</title>
      <link>https://lab.example/news/future</link>
      <pubDate>Thu, 01 Oct 2026 08:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Empty description</title>
      <link>https://lab.example/news/empty</link>
      <description/>
      <pubDate>Tue, 22 Sep 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

// Shapes seen live: The Verge / NVIDIA technical blog (Atom, CDATA, type="html",
// several <link>s with href before rel, published and updated).
const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <title type="text">AI | Press</title>
  <link rel="alternate" type="text/html" href="https://press.example/ai" />
  <link rel="self" type="application/atom+xml" href="https://press.example/ai/feed" />
  <entry>
    <author><name>Terrence O’Brien</name></author>
    <title type="html"><![CDATA[OpenAI pauses <em>training</em> of its ‘most capable models’]]></title>
    <link rel="replies" type="text/html" href="https://press.example/ai/1001049#comments" />
    <link type="text/html" href="https://press.example/ai/1001049/openai-training-pause?utm_source=rss&amp;id=7" rel="alternate" />
    <id>https://press.example/?p=1001049</id>
    <updated>2026-09-26T18:00:00-04:00</updated>
    <published>2026-09-26T12:34:59-04:00</published>
    <summary type="html"><![CDATA[A model in a <b>sandbox</b> found a loophole. The incident happened on September [&#8230;]]]></summary>
    <content type="html"><![CDATA[<figure><img src="x.jpg"/></figure><p>Long body</p>]]></content>
  </entry>
  <entry>
    <title>Plain Atom title with Array&lt;T&gt; &amp; more</title>
    <link href="https://press.example/ai/plain" />
    <updated>2026-09-25T09:00:00Z</updated>
    <summary>Plain text summary keeps a &lt;tag&gt; literally</summary>
  </entry>
  <entry>
    <title>Atom content quoting RSS markup</title>
    <link href="/ai/quoting" />
    <published>2026-09-24T09:00:00Z</published>
    <content type="html"><![CDATA[<p>RSS wraps posts in <item> elements</p>]]></content>
  </entry>
</feed>`;

const LAB: NewsFeed = { id: 'lab', label: 'Lab', url: 'https://lab.example/rss.xml', kind: 'lab' };
const PRESS: NewsFeed = { id: 'press', label: 'Press', url: 'https://press.example/ai/feed', kind: 'press' };

/** An RSS feed with `n` items dated `hoursApart` apart, newest first. */
function rssFeed(prefix: string, n: number, opts: { start?: number; hoursApart?: number } = {}): string {
  const start = opts.start ?? NOW - 3600_000;
  const items = Array.from({ length: n }, (_, i) => {
    const date = new Date(start - i * (opts.hoursApart ?? 6) * 3600_000).toUTCString();
    return `<item><title>${prefix} post ${i}</title><link>https://${prefix}.example/p/${i}</link><pubDate>${date}</pubDate></item>`;
  });
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${prefix}</title>${items.join('')}</channel></rss>`;
}

// ─── parseFeed ───────────────────────────────────────────────────────────────

describe('parseFeed', () => {
  it('parses RSS 2.0: CDATA, entities, escaped HTML, guid permalinks, relative links', () => {
    const entries = parseFeed(RSS, { base: LAB.url });
    expect(entries.map((e) => e.title)).toEqual([
      // CDATA is plain text: "<string>" survives, "&" is literal
      'GPT-7 adds Array<string> outputs & more',
      'Tools & MCP: what’s new in <agents>',
      'Guid permalink only',
      'Old post',
      'Undated post',
      'From the future',
      'Empty description',
    ]);
    const [gpt, tools, guid, , undated, , empty] = entries;
    expect(gpt).toEqual({
      title: 'GPT-7 adds Array<string> outputs & more',
      url: 'https://lab.example/index/gpt-7',
      date: '2026-09-25T19:00:00.000Z',
      // HTML stripped, WordPress "The post … appeared first on …" footer dropped
      summary: 'Structured outputs for tool calls.',
    });
    // Escaped HTML is decoded once as XML, then cleaned as HTML (the second
    // decode turns "&amp;" into "&"); a trailing "[…]" becomes "…"
    expect(tools.summary).toBe('Escaped HTML & entities…');
    expect(tools.url).toBe('https://lab.example/news/tools-and-mcp');
    expect(tools.date).toBe('2026-09-24T14:00:00.000Z');
    expect(guid.url).toBe('https://lab.example/news/guid-only');
    expect(guid.date).toBe('2026-09-23T08:00:00.000Z');
    expect(undated.date).toBeUndefined();
    expect(empty.summary).toBe('');
    // isPermaLink="false" guids and javascript: links never become URLs
    expect(entries.some((e) => /opaque|unsafe/i.test(e.title))).toBe(false);
  });

  it('parses Atom: link rel=alternate in any attribute order, type="html" titles, published over updated', () => {
    const entries = parseFeed(ATOM, { base: PRESS.url });
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      title: 'OpenAI pauses training of its ‘most capable models’',
      // Not the rel="replies" link; the &amp; in href is decoded
      url: 'https://press.example/ai/1001049/openai-training-pause?utm_source=rss&id=7',
      date: '2026-09-26T16:34:59.000Z',
      summary: 'A model in a sandbox found a loophole. The incident happened on September…',
    });
    // Atom text constructs are plain text: "<T>" and "<tag>" stay
    expect(entries[1]).toEqual({
      title: 'Plain Atom title with Array<T> & more',
      url: 'https://press.example/ai/plain',
      date: '2026-09-25T09:00:00.000Z',
      summary: 'Plain text summary keeps a <tag> literally',
    });
    // The root decides the format, so "<item>" inside content is not an RSS item
    expect(entries[2]).toMatchObject({ title: 'Atom content quoting RSS markup', url: 'https://press.example/ai/quoting', summary: 'RSS wraps posts in elements' });
  });

  it('skips entries outside since/until (and undated ones) before parsing them', () => {
    const entries = parseFeed(RSS, { base: LAB.url, since: NOW - 7 * DAY, until: NOW + DAY });
    expect(entries.map((e) => e.title)).toEqual(['GPT-7 adds Array<string> outputs & more', 'Tools & MCP: what’s new in <agents>', 'Guid permalink only', 'Empty description']);
  });

  it('handles a large, unsorted feed (OpenAI ships 1,200+ items) in one pass', () => {
    // 1,500 items, only 20 inside the window, shuffled like OpenAI's feed
    const old = rssFeed('old', 1_480, { start: NOW - 30 * DAY, hoursApart: 1 }).match(/<item>[\s\S]*?<\/item>/g)!;
    const recent = rssFeed('new', 20, { hoursApart: 3 }).match(/<item>[\s\S]*?<\/item>/g)!;
    const mixed = [...old.slice(0, 700), ...recent.slice(10), ...old.slice(700), ...recent.slice(0, 10)];
    const big = `<?xml version="1.0"?><rss version="2.0"><channel>${mixed.join('\n')}</channel></rss>`;
    const started = performance.now();
    const entries = parseFeed(big, { since: NOW - 7 * DAY, until: NOW + DAY });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(entries).toHaveLength(20);
    expect(parseFeed(big)).toHaveLength(1_500);
    // The newest five win regardless of document order
    expect(toNewsItems(LAB, entries, NOW).map((i) => i.title)).toEqual(['new post 0', 'new post 1', 'new post 2', 'new post 3', 'new post 4']);
  });

  it('tells feeds from HTML pages', () => {
    expect(isFeed(RSS)).toBe(true);
    expect(isFeed(ATOM)).toBe(true);
    expect(isFeed('<?xml version="1.0"?><rdf:RDF xmlns:rdf="x"><item></item></rdf:RDF>')).toBe(true);
    expect(isFeed('<!doctype html><html><body>Just a moment…</body></html>')).toBe(false);
    expect(parseFeed('<html><body>no feed</body></html>')).toEqual([]);
  });
});

// ─── Items ───────────────────────────────────────────────────────────────────

describe('toNewsItems', () => {
  it('keeps the last 7 days, newest first, labelled with the organisation', () => {
    const items = toNewsItems(LAB, parseFeed(RSS, { base: LAB.url }), NOW);
    expect(items.map((i) => i.title)).toEqual(['GPT-7 adds Array<string> outputs & more', 'Tools & MCP: what’s new in <agents>', 'Guid permalink only', 'Empty description']);
    const [first] = items;
    expect(first).toMatchObject({
      id: `ai-news:lab:${sha('https://lab.example/index/gpt-7')}`,
      category: 'news',
      source: 'ai-news',
      sourceLabel: 'Lab',
      url: 'https://lab.example/index/gpt-7',
      date: '2026-09-25T19:00:00.000Z',
      tags: ['lab'],
      canonicalId: 'url:lab.example/index/gpt-7',
    });
    expect(items[3].summary).toBeUndefined();
    for (const item of items) expectSafeGoal(item.goal);
  });

  it('gives ids that are stable across refreshes and depend only on the URL', () => {
    const a = toNewsItems(LAB, parseFeed(RSS, { base: LAB.url }), NOW);
    const b = toNewsItems(LAB, parseFeed(RSS.replace('GPT-7 adds', 'GPT-7 (updated) adds'), { base: LAB.url }), NOW + 3600_000);
    expect(b.map((i) => i.id)).toEqual(a.map((i) => i.id));
    expect(new Set(a.map((i) => i.id)).size).toBe(a.length);
  });

  it('caps each feed at its 5 newest items', () => {
    const items = toNewsItems(LAB, parseFeed(rssFeed('lab', 8)), NOW);
    expect(items.map((i) => i.title)).toEqual(['lab post 0', 'lab post 1', 'lab post 2', 'lab post 3', 'lab post 4']);
  });

  it('tags press items as press', () => {
    const [item] = toNewsItems(PRESS, parseFeed(ATOM, { base: PRESS.url }), NOW);
    expect(item).toMatchObject({ sourceLabel: 'Press', tags: ['press'], canonicalId: 'url:press.example/ai/1001049/openai-training-pause?id=7' });
  });
});

describe('newsGoal', () => {
  const lead = 'Read "X" from Lab (https://lab.example/x)';

  it('names the item and URL and points at the part of OpenCode it touches', () => {
    const [gpt] = toNewsItems(LAB, parseFeed(RSS, { base: LAB.url }), NOW);
    expect(gpt.goal).toContain('"GPT-7 adds Array<string> outputs & more" from Lab (https://lab.example/index/gpt-7)');
    expect(gpt.goal).toContain('src/lib/tools.ts');
    // A sandbox escape in the summary beats the generic "models" in the title
    const [verge] = toNewsItems(PRESS, parseFeed(ATOM, { base: PRESS.url }), NOW);
    expect(verge.goal).toContain('src/lib/dockerService.ts');
    expect(newsGoal(lead, 'Remote MCP servers get OAuth')).toContain('src/lib/mcpClient.ts');
    expect(newsGoal(lead, 'Orchestrating parallel sub-agents')).toContain('src/lib/subagents.ts');
    expect(newsGoal(lead, 'A new PDE solver for physics simulation')).toContain('src/lib/scienceTools.ts');
    expect(newsGoal(lead, 'Why coding agents stall')).toContain('src/lib/agentLoop.ts');
  });

  it('asks for model support without touching package.json', () => {
    const goal = newsGoal(lead, 'Introducing Gemini 4 Flash', 'Available in the API today.');
    expect(goal).toContain('src/lib/models.ts, src/lib/llmClient.ts');
    expect(goal).toContain('Do not edit package.json');
    expect(goal).toContain('applied manually');
    expectSafeGoal(goal);
  });

  it('allows "no change" when nothing applies', () => {
    const goal = newsGoal(lead, 'Insurers claim AI is increasing healthcare costs', 'Hospital use of AI tools led to more spending.');
    // Bare "tools" in a summary is not a tool-calling story
    expect(goal).not.toContain('tool-call handling');
    expect(goal).toContain('make no change and explain why');
    expectSafeGoal(goal);
  });
});

describe('canonicalNewsId', () => {
  it('normalises host, tracking params, trailing slash and arXiv links', () => {
    expect(canonicalNewsId('https://www.example.com/a/b/?utm_source=rss&utm_medium=x&id=1#top')).toBe('url:example.com/a/b?id=1');
    expect(canonicalNewsId('http://example.com/a/b')).toBe('url:example.com/a/b');
    expect(canonicalNewsId('https://arxiv.org/abs/2609.12345v2')).toBe('arxiv:2609.12345');
    expect(canonicalNewsId('https://arxiv.org/pdf/2609.12345.pdf')).toBe('arxiv:2609.12345');
  });
});

describe('mergeNewsItems', () => {
  const item = (feed: string, n: number, hoursAgo: number, url = `https://${feed}.example/${n}`): DiscoverItem => ({
    id: `ai-news:${feed}:${n}`, category: 'news', source: 'ai-news', sourceLabel: feed, title: `${feed} ${n}`, url,
    date: new Date(NOW - hoursAgo * 3600_000).toISOString(), tags: [], goal: 'g', canonicalId: canonicalNewsId(url),
  });

  it('round-robins by rank so a busy feed cannot crowd out the others, then sorts newest first', () => {
    const busy = [0, 1, 2, 3, 4].map((n) => item('busy', n, n));
    const quiet = [0, 1].map((n) => item('quiet', n, 100 + n));
    const merged = mergeNewsItems([busy, quiet], 4);
    expect(merged.map((i) => i.title)).toEqual(['busy 0', 'busy 1', 'quiet 0', 'quiet 1']);
  });

  it('keeps one item per article across feeds (the earlier feed wins)', () => {
    const shared = 'https://blog.example/post?utm_source=a';
    const merged = mergeNewsItems([[item('a', 0, 1, shared)], [item('b', 0, 1, 'https://www.blog.example/post/')]]);
    expect(merged.map((i) => i.sourceLabel)).toEqual(['a']);
  });
});

// ─── The source ──────────────────────────────────────────────────────────────

describe('aiNewsSource', () => {
  const feedFor = (url: string) => NEWS_FEEDS.find((f) => f.url === url)!;

  it('fetches every feed with feed Accept headers and caps the total at 40', async () => {
    const { fetchImpl, calls } = fakeFetch((url) => xml(rssFeed(feedFor(url).id, 6)));
    const items = await aiNewsSource.fetch(fetchImpl, cfg());
    expect(calls.map((c) => c.url).sort()).toEqual(NEWS_FEEDS.map((f) => f.url).sort());
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(USER_AGENT);
    expect(headers.Accept).toMatch(/application\/rss\+xml.*application\/atom\+xml/);
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);

    expect(items).toHaveLength(40);
    // 11 feeds × 5 = 55 candidates: every feed keeps at least 3
    const perFeed = new Map<string, number>();
    for (const i of items) perFeed.set(i.sourceLabel, (perFeed.get(i.sourceLabel) ?? 0) + 1);
    expect([...perFeed.keys()].sort()).toEqual(NEWS_FEEDS.map((f) => f.label).sort());
    expect(Math.min(...perFeed.values())).toBeGreaterThanOrEqual(3);
    expect(Math.max(...perFeed.values())).toBeLessThanOrEqual(5);
    const dates = items.map((i) => i.date!);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(items.map((i) => i.id)).size).toBe(40);
  });

  it('returns what arrived when some feeds fail, and reports which ones', async () => {
    const { fetchImpl } = fakeFetch((url) => {
      const feed = feedFor(url);
      if (feed.id === 'openai') return xml('oops', 500);
      if (feed.id === 'nvidia') return new Response('<!doctype html><html><body>Just a moment…</body></html>', { status: 200 });
      if (feed.id === 'the-verge') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      if (feed.id === 'mit-news') throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      return xml(rssFeed(feed.id, 2));
    });
    const items = await aiNewsSource.fetch(fetchImpl, cfg());
    expect(items).toHaveLength(14);
    expect(items.some((i) => ['OpenAI', 'NVIDIA', 'The Verge', 'MIT News'].includes(i.sourceLabel))).toBe(false);

    const { failures } = await fetchNewsFeeds(fetchImpl, NOW);
    expect(failures).toEqual([
      { feed: { id: 'openai', label: 'OpenAI' }, error: 'openai.com returned 500' },
      { feed: { id: 'nvidia', label: 'NVIDIA' }, error: 'developer.nvidia.com did not return an RSS or Atom feed' },
      { feed: { id: 'mit-news', label: 'MIT News' }, error: 'network error (ENOTFOUND)' },
      { feed: { id: 'the-verge', label: 'The Verge' }, error: 'timed out after 12 s' },
    ]);
    expect(summarizeFeedFailures(failures, NEWS_FEEDS.length)).toBe(
      '4 of 11 news feeds failed: OpenAI (openai.com returned 500); NVIDIA (developer.nvidia.com did not return an RSS or Atom feed); ' +
      'MIT News (network error (ENOTFOUND)); The Verge (timed out after 12 s)',
    );
  });

  it('throws only when every feed fails, naming each one', async () => {
    const { fetchImpl } = fakeFetch(() => xml('down', 503));
    await expect(aiNewsSource.fetch(fetchImpl, cfg())).rejects.toThrow(/^All 11 news feeds failed: OpenAI \(openai\.com returned 503\); Google DeepMind/);
  });

  it('is not an error when the feeds are fine but quiet', async () => {
    const { fetchImpl } = fakeFetch(() => xml(rssFeed('quiet', 3, { start: NOW - 30 * DAY })));
    await expect(aiNewsSource.fetch(fetchImpl, cfg())).resolves.toEqual([]);
  });
});

describe('summarizeFeedFailures', () => {
  it('is empty without failures and singular for one feed', () => {
    expect(summarizeFeedFailures([], 11)).toBe('');
    expect(summarizeFeedFailures([{ feed: { id: 'a', label: 'A' }, error: 'x returned 404' }], 2)).toBe('1 of 2 news feeds failed: A (x returned 404)');
    expect(summarizeFeedFailures([{ feed: { id: 'a', label: 'A' }, error: 'boom' }], 1)).toBe('All 1 news feeds failed: A (boom)');
  });
});

// ─── Web search ──────────────────────────────────────────────────────────────

const result = (url: string, title = `Title for ${url}`, snippet = 'A snippet'): SearchResult => ({ url, title, snippet });
const noFetch: FetchLike = vi.fn(async () => { throw new Error('the web search source must not use fetchImpl'); });

describe('newsQueries', () => {
  it('adds the first news keyword, falling back to the research keywords', () => {
    expect(newsQueries({ newsKeywords: ['  MCP   servers ', 'LLM'], keywords: ['coding agent'] })).toEqual([
      'new AI model released this week',
      'AI lab research announcement this week',
      'MCP servers news this week',
    ]);
    expect(newsQueries({ newsKeywords: [], keywords: ['coding agent'] })[2]).toBe('coding agent news this week');
    expect(newsQueries({ newsKeywords: ['', '  '], keywords: ['tool use'] })[2]).toBe('tool use news this week');
    expect(newsQueries({ keywords: [] })).toHaveLength(2);
  });
});

describe('toSearchItems', () => {
  it('builds capped, safe items with plain-text titles', () => {
    const results = [
      result('https://duckduckgo.com/y.js?ad_domain=example.com&u3=x', 'Sponsored'),
      result('javascript:alert(1)', 'Bad link'),
      result('https://www.news.example/a', 'Array<string> & friends', 'Snippet with <b> kept'),
      ...[1, 2, 3, 4, 5].map((n) => result(`https://site${n}.example/post`)),
    ];
    const items = toSearchItems('LLM news this week', results, 'LLM');
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({
      id: `web-search:${sha('https://www.news.example/a')}`,
      category: 'news',
      source: 'web-search',
      sourceLabel: 'Web search',
      title: 'Array<string> & friends',
      url: 'https://www.news.example/a',
      summary: 'Snippet with <b> kept',
      tags: ['web', 'news.example', 'LLM'],
      canonicalId: 'url:news.example/a',
    });
    expect(items[0].date).toBeUndefined();
    expect(items[0].goal).toContain('"Array<string> & friends" (https://www.news.example/a; found by a web search for "LLM news this week")');
    for (const i of items) expectSafeGoal(i.goal);
    expect(items.map((i) => i.url)).not.toContain('https://site5.example/post');
    expect(toSearchItems('q', [result('https://a.example/x')])[0].tags).toEqual(['web', 'a.example']);
  });
});

describe('web search source', () => {
  it('runs about once a day', () => {
    const src = makeWebSearchSource(async () => []);
    expect(src).toMatchObject({ id: 'web-search', label: 'Web search', category: 'news', ttlMs: 20 * 3600_000, minRefreshMs: 20 * 3600_000 });
    expect(webSearchNewsSource.id).toBe('web-search');
  });

  it('runs the queries in order through the injected search and dedupes by URL', async () => {
    const search = vi.fn(async (q: string) => {
      if (q.startsWith('new AI model')) return [result('https://a.example/1'), result('https://b.example/shared')];
      if (q.startsWith('AI lab')) return [result('https://www.b.example/shared/?utm_source=ddg'), result('https://c.example/2')];
      return [result('https://a.example/1'), result('https://d.example/3')];
    });
    const items = await makeWebSearchSource(search, 0).fetch(noFetch, cfg({ newsKeywords: ['LLM'] }));
    expect(search.mock.calls.map((c) => c[0])).toEqual(['new AI model released this week', 'AI lab research announcement this week', 'LLM news this week']);
    expect(items.map((i) => i.url)).toEqual(['https://a.example/1', 'https://b.example/shared', 'https://c.example/2', 'https://d.example/3']);
    // Only the keyword query tags its results with the keyword
    expect(items[3].tags).toEqual(['web', 'd.example', 'LLM']);
    expect(items[0].tags).toEqual(['web', 'a.example']);
    expect(noFetch).not.toHaveBeenCalled();
  });

  it('pauses between queries', async () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn(async (q: string) => [result(`https://x.example/${encodeURIComponent(q)}`)]);
      const pending = makeWebSearchSource(search, 1_000).fetch(noFetch, cfg({ newsKeywords: ['LLM'] }));
      await vi.advanceTimersByTimeAsync(0);
      expect(search).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(search).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(search).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(search).toHaveBeenCalledTimes(3);
      expect(await pending).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a bot check (empty results) as rate limiting and stops asking', async () => {
    const search = vi.fn(async () => [] as SearchResult[]);
    await expect(makeWebSearchSource(search, 0).fetch(noFetch, cfg({ newsKeywords: ['LLM'] }))).rejects.toThrow(RATE_LIMITED_MESSAGE);
    expect(search).toHaveBeenCalledTimes(1);
    expect(RATE_LIMITED_MESSAGE).toBe('DuckDuckGo is rate limiting automated searches; try again later');
  });

  it('reports HTTP 429/403 as rate limiting', async () => {
    const search = vi.fn(async () => { throw new Error('HTTP 429 Too Many Requests'); });
    await expect(makeWebSearchSource(search, 0).fetch(noFetch, cfg())).rejects.toThrow(RATE_LIMITED_MESSAGE);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('keeps earlier results when a later query hits the bot check', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([result('https://a.example/1')])
      .mockResolvedValueOnce([]);
    const items = await makeWebSearchSource(search, 0).fetch(noFetch, cfg({ newsKeywords: ['LLM'] }));
    expect(items.map((i) => i.url)).toEqual(['https://a.example/1']);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('throws a plain failure when every query errors without a bot check', async () => {
    const search = vi.fn(async () => { throw new Error('Could not resolve host: lite.duckduckgo.com'); });
    await expect(makeWebSearchSource(search, 0).fetch(noFetch, cfg({ newsKeywords: ['LLM'] })))
      .rejects.toThrow('Web search failed for every query: Could not resolve host: lite.duckduckgo.com');
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('survives one failing query', async () => {
    const search = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 500 Internal Server Error'))
      .mockResolvedValueOnce([result('https://b.example/1')]);
    const items = await makeWebSearchSource(search, 0).fetch(noFetch, cfg());
    expect(items.map((i) => i.url)).toEqual(['https://b.example/1']);
  });

  it('returns nothing, without an error, when results exist but none are usable', async () => {
    const search = vi.fn(async () => [result('https://duckduckgo.com/y.js?ad_domain=x', 'Ad')]);
    await expect(makeWebSearchSource(search, 0).fetch(noFetch, cfg())).resolves.toEqual([]);
    expect(search).toHaveBeenCalledTimes(2);
  });
});
