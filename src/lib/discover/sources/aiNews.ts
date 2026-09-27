import crypto from 'crypto';
import { cleanText, getText, plainText, safeUrl } from '../types';
import type { DiscoverConfig, DiscoverItem, DiscoverSource, FetchLike } from '../types';

/**
 * AI news straight from the labs and the tech press: their public RSS/Atom
 * feeds (no keys). One source so the feed stays one row in the status list;
 * each item is labelled with its organisation (sourceLabel: 'OpenAI', …).
 * Anthropic, Meta and Mistral publish no feed — their releases arrive via
 * the GitHub releases source instead.
 */

const ID = 'ai-news';
const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const PER_FEED = 5;
const MAX_ITEMS = 40;
const TIMEOUT_MS = 12_000;
const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1';

export interface NewsFeed {
  id: string;
  /** Organisation shown on the item */
  label: string;
  url: string;
  kind: 'lab' | 'press';
}

// Labs first: when the total cap bites, press items go first
export const NEWS_FEEDS: NewsFeed[] = [
  { id: 'openai', label: 'OpenAI', url: 'https://openai.com/news/rss.xml', kind: 'lab' },
  { id: 'google-deepmind', label: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', kind: 'lab' },
  { id: 'google-research', label: 'Google Research', url: 'https://research.google/blog/rss/', kind: 'lab' },
  { id: 'google-ai', label: 'Google AI', url: 'https://blog.google/innovation-and-ai/technology/ai/rss/', kind: 'lab' },
  { id: 'microsoft-research', label: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/', kind: 'lab' },
  { id: 'huggingface', label: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', kind: 'lab' },
  // The technical blog (Atom): the blogs.nvidia.com deep-learning category went quiet in July 2026
  { id: 'nvidia', label: 'NVIDIA', url: 'https://developer.nvidia.com/blog/feed', kind: 'lab' },
  { id: 'aws-ml', label: 'AWS Machine Learning', url: 'https://aws.amazon.com/blogs/machine-learning/feed/', kind: 'lab' },
  { id: 'mit-news', label: 'MIT News', url: 'https://news.mit.edu/rss/topic/artificial-intelligence2', kind: 'press' },
  { id: 'techcrunch', label: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', kind: 'press' },
  { id: 'the-verge', label: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', kind: 'press' },
];

export interface FeedEntry {
  title: string;
  url: string;
  date?: string;
  summary: string;
}

export interface ParseFeedOptions {
  /** Resolve relative links against this URL (the feed's own) */
  base?: string;
  /** Skip entries dated before this (ms), or undated, before parsing the rest —
   *  OpenAI's feed carries 1,200+ entries and only a week's worth are used */
  since?: number;
  /** …and entries dated after this (ms) */
  until?: number;
}

// ─── XML helpers (no XML dependency) ────────────────────────────────────────

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML character data → text: CDATA sections verbatim, entities elsewhere
 *  decoded once (so escaped HTML becomes HTML for cleanText). */
function xmlText(raw: string): string {
  return raw
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) => part.startsWith('<![CDATA[') ? part.slice(9, -3)
      : part.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos));/gi, (m, dec, hex, name) => {
        if (name) return XML_ENTITIES[name.toLowerCase()];
        const n = dec ? Number(dec) : parseInt(hex, 16);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }))
    .join('');
}

const tagCache = new Map<string, RegExp>();

/** First `<name …>…</name>` in the block (self-closing tags are empty). */
function element(block: string, name: string): { attrs: string; body: string } | null {
  let re = tagCache.get(name);
  if (!re) {
    re = new RegExp(`<${name}(\\s[^>]*)?(?<!/)>([\\s\\S]*?)</${name}\\s*>`, 'i');
    tagCache.set(name, re);
  }
  const m = block.match(re);
  return m ? { attrs: m[1] ?? '', body: m[2] } : null;
}

function text(block: string, ...names: string[]): string {
  for (const name of names) {
    const el = element(block, name);
    if (el && el.body.trim()) return xmlText(el.body).trim();
  }
  return '';
}

const ATTR_RE = Object.fromEntries(
  (['rel', 'href', 'type', 'isPermaLink'] as const).map((n) => [n, new RegExp(`(?:^|\\s)${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')]),
) as Record<'rel' | 'href' | 'type' | 'isPermaLink', RegExp>;

function attr(attrs: string, name: keyof typeof ATTR_RE): string | undefined {
  const m = attrs.match(ATTR_RE[name]);
  return m ? xmlText(m[1] ?? m[2]).trim() : undefined;
}

function resolveUrl(raw: string, base?: string): string | null {
  if (!raw) return null;
  try {
    return safeUrl(new URL(raw, base).toString());
  } catch {
    return null;
  }
}

function isoDate(v: string): string | undefined {
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

// RSS <link>url</link>; Atom <link href="url"/> with rel="alternate" (Atom's
// default when rel is absent); else an RSS <guid> that is a permalink.
function entryLink(block: string, base?: string): string | null {
  const rss = resolveUrl(text(block, 'link'), base);
  if (rss) return rss;
  for (const m of block.matchAll(/<link\b([^>]*)>/gi)) {
    const rel = attr(m[1], 'rel');
    if (rel && rel.toLowerCase() !== 'alternate') continue;
    const url = resolveUrl(attr(m[1], 'href') ?? '', base);
    if (url) return url;
  }
  const guid = element(block, 'guid');
  // Only an absolute http(s) guid: an opaque id resolved against the feed URL would be a made-up link
  if (guid && attr(guid.attrs, 'isPermaLink')?.toLowerCase() !== 'false') return safeUrl(xmlText(guid.body).trim());
  return null;
}

/** Feed HTML (descriptions, Atom type="html") → summary text. */
function htmlSummary(html: string): string {
  // WordPress footer: "The post <a>X</a> appeared first on <a>Y</a>."
  const body = html.slice(0, 20_000).replace(/<p>\s*The post <a[\s\S]*?appeared first on[\s\S]*?<\/p>/gi, ' ');
  // WordPress excerpts end in "[…]"
  return cleanText(body, 400).replace(/\s*\[(?:…|\.\.\.)\]$/, '…');
}

// RSS descriptions are HTML; Atom summary/content are plain text unless type="html"/"xhtml"
function summaryOf(block: string, atom: boolean): string {
  for (const name of ['description', 'summary', 'content:encoded', 'content']) {
    const el = element(block, name);
    if (!el || !el.body.trim()) continue;
    const body = xmlText(el.body);
    const type = attr(el.attrs, 'type')?.toLowerCase() ?? 'text';
    return atom && (name === 'summary' || name === 'content') && type === 'text' ? plainText(body, 400) : htmlSummary(body);
  }
  return '';
}

/** Is this an RSS/Atom document at all (not an HTML error or challenge page)? */
export function isFeed(xml: string): boolean {
  // A generous window: some feeds open with long comments or stylesheets
  return /<(?:rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 65_536));
}

/** RSS 2.0 `<item>` or Atom `<entry>` blocks → entries, in document order.
 *  One pass over the document; per-entry work stays inside the entry. */
export function parseFeed(xml: string, opts: ParseFeedOptions = {}): FeedEntry[] {
  const out: FeedEntry[] = [];
  // By root element, so an Atom entry quoting "<item>" in its content is not misread
  const head = xml.slice(0, 65_536);
  const atom = /<feed[\s>]/i.test(head) || (!/<(?:rss|rdf:RDF)[\s>]/i.test(head) && !/<item[\s>]/i.test(xml));
  const blockRe = atom ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry\s*>/gi : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi;
  for (const [, b] of xml.matchAll(blockRe)) {
    // Atom: publication beats the last edit
    const date = isoDate(text(b, 'pubDate', 'published', 'dc:date', 'updated'));
    if (opts.since !== undefined || opts.until !== undefined) {
      const t = date ? Date.parse(date) : NaN;
      if (!(t >= (opts.since ?? -Infinity) && t <= (opts.until ?? Infinity))) continue;
    }
    // RSS titles and Atom type="text" are plain text; Atom type="html"/"xhtml" is markup
    const t = element(b, 'title');
    const rawTitle = t ? xmlText(t.body) : '';
    const title = /^x?html$/i.test(attr(t?.attrs ?? '', 'type') ?? '') ? cleanText(rawTitle, 200) : plainText(rawTitle, 200);
    const url = entryLink(b, opts.base);
    if (!title || !url) continue;
    let summary = summaryOf(b, atom);
    if (summary === title) summary = '';
    out.push({ title, url, date, summary });
  }
  return out;
}

// ─── Items ──────────────────────────────────────────────────────────────────

const TRACKING_PARAM = /^(?:utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|ref_src)$/i;

/** Key for the aggregator's cross-source dedupe: the same article found by
 *  the news feeds and by web search (or an arXiv paper) collapses to one. */
export function canonicalNewsId(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const arxiv = host === 'arxiv.org' ? u.pathname.match(/^\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?\/?$/) : null;
    if (arxiv) return `arxiv:${arxiv[1]}`;
    for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
    return `url:${host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return `url:${url}`;
  }
}

// Specific parts of OpenCode, matched anywhere in the title or summary
const SPECIFIC_AREAS: { re: RegExp; area: string }[] = [
  { re: /\bmcp\b|model context protocol/i, area: 'MCP client (src/lib/mcpClient.ts)' },
  { re: /\bsub-?agents?\b|multi-agent|orchestrat|agent teams?\b|\bswarms?\b/i, area: 'sub-agents (src/lib/subagents.ts)' },
  { re: /sandbox|prompt injection|jailbreak|exploit|vulnerab|\bsecurity\b/i, area: 'sandboxed execution (src/lib/dockerService.ts) and tool permission checks (src/lib/tools.ts)' },
  { re: /tool[- ]?(?:use|calls?|calling)|function[- ]call|computer use|browser use|structured output/i, area: 'tools and tool-call handling (src/lib/tools.ts)' },
  { re: /physics|mathemat|\bmath\b|scientific|simulat|quantum|theorem|chemistry/i, area: 'science and physics tooling (src/lib/scienceTools.ts)' },
];

// Broad words (a model name, "agent") — title first, then summary
const GENERIC_AREAS: { re: RegExp; area: string; model?: true }[] = [
  {
    re: /\b(?:gpt|gemini|gemma|claude|llama|qwen|mistral|deepseek|nemotron|phi)\b|\bmodels?\b|\bapi\b|open[- ]weights?|\breleas|\blaunch|introduc/i,
    area: 'model and provider support (src/lib/models.ts, src/lib/llmClient.ts)',
    model: true,
  },
  { re: /context window|long[- ]context|\bmemory\b|retrieval|\brag\b|prompt cach/i, area: 'context handling in the agent loop (src/lib/agentLoop.ts)' },
  { re: /\bagent|\bcoding\b|\bcode\b|codex|reasoning|planning/i, area: 'agent loop (src/lib/agentLoop.ts)' },
];

/**
 * The suggested upgrade goal for a news item. `lead` names the item and its
 * URL (e.g. `Read "X" from OpenAI (https://…)`). Goals never ask to edit
 * package.json: upgrade candidates may not, so SDK bumps are left to the user.
 */
export function newsGoal(lead: string, title: string, summary = ''): string {
  const both = `${title} ${summary}`;
  const hit: { area: string; model?: true } | undefined = SPECIFIC_AREAS.find((a) => a.re.test(both))
    ?? GENERIC_AREAS.find((a) => a.re.test(title)) ?? GENERIC_AREAS.find((a) => a.re.test(summary));
  if (hit?.model) {
    return (
      `${lead}. If it announces a model, model version or API feature OpenCode can use, add it to OpenCode's ` +
      `${hit.area} with tests. Do not edit package.json: if a newer provider SDK is required, name the version ` +
      'so the bump can be applied manually. If nothing in it applies to OpenCode, make no change and explain why.'
    );
  }
  const area = hit?.area ?? 'agent loop, tools or model support (src/lib/agentLoop.ts, src/lib/tools.ts, src/lib/models.ts)';
  return (
    `${lead} and decide whether the technique or capability it describes would improve OpenCode's ${area}. ` +
    'If it would, make the smallest useful change with tests; if not, make no change and explain why.'
  );
}

/** One feed's entries → items (last WINDOW_DAYS, newest first, capped per feed). */
export function toNewsItems(feed: NewsFeed, entries: FeedEntry[], now: number): DiscoverItem[] {
  const since = now - WINDOW_DAYS * DAY_MS;
  return entries
    .map((e) => ({ e, t: e.date ? Date.parse(e.date) : NaN }))
    // A day of slack for feeds that post-date or run ahead of our clock
    .filter(({ t }) => t >= since && t <= now + DAY_MS)
    .sort((a, b) => b.t - a.t)
    .slice(0, PER_FEED)
    .map(({ e }) => ({
      id: `${ID}:${feed.id}:${crypto.createHash('sha1').update(e.url).digest('hex').slice(0, 12)}`,
      category: 'news' as const,
      source: ID,
      sourceLabel: feed.label,
      title: e.title,
      url: e.url,
      ...(e.summary ? { summary: e.summary } : {}),
      date: e.date,
      tags: [feed.kind],
      goal: newsGoal(`Read "${e.title}" from ${feed.label} (${e.url})`, e.title, e.summary),
      canonicalId: canonicalNewsId(e.url),
    }));
}

/** Per-feed lists → one list: round-robin by rank so every feed keeps its
 *  newest items when the cap bites, deduped by article, newest first. */
export function mergeNewsItems(lists: DiscoverItem[][], limit = MAX_ITEMS): DiscoverItem[] {
  const out: DiscoverItem[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...lists.map((l) => l.length));
  for (let rank = 0; rank < depth && out.length < limit; rank++) {
    for (const list of lists) {
      const item = list[rank];
      const key = item?.canonicalId ?? item?.url;
      if (!item || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length === limit) break;
    }
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

// ─── Fetching ───────────────────────────────────────────────────────────────

export interface FeedFailure {
  feed: Pick<NewsFeed, 'id' | 'label'>;
  error: string;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return `timed out after ${TIMEOUT_MS / 1000} s`;
    const code = (err.cause as { code?: unknown } | undefined)?.code;
    if (err.message === 'fetch failed') return typeof code === 'string' ? `network error (${code})` : 'network error';
    return err.message.slice(0, 160);
  }
  return String(err).slice(0, 160);
}

/** "2 of 11 news feeds failed: NVIDIA (…returned 404); MIT News (timed out…)",
 *  or '' when none did. Pure, for status lines. */
export function summarizeFeedFailures(failures: FeedFailure[], total: number): string {
  if (!failures.length) return '';
  const list = failures.map((f) => `${f.feed.label} (${f.error})`).join('; ');
  return failures.length >= total
    ? `All ${total} news feeds failed: ${list}`
    : `${failures.length} of ${total} news feeds failed: ${list}`;
}

/** Fetch every feed in parallel; one feed failing never hides the others. */
export async function fetchNewsFeeds(
  fetchImpl: FetchLike,
  now: number,
  feeds: NewsFeed[] = NEWS_FEEDS,
): Promise<{ items: DiscoverItem[]; failures: FeedFailure[] }> {
  const since = now - WINDOW_DAYS * DAY_MS;
  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const xml = await getText(fetchImpl, feed.url, { Accept: ACCEPT }, TIMEOUT_MS);
      if (!isFeed(xml)) throw new Error(`${new URL(feed.url).host} did not return an RSS or Atom feed`);
      return toNewsItems(feed, parseFeed(xml, { base: feed.url, since, until: now + DAY_MS }), now);
    }),
  );
  const lists: DiscoverItem[][] = [];
  const failures: FeedFailure[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') lists.push(r.value);
    else failures.push({ feed: { id: feeds[i].id, label: feeds[i].label }, error: describeError(r.reason) });
  });
  return { items: mergeNewsItems(lists), failures };
}

export const aiNewsSource: DiscoverSource = {
  id: ID,
  label: 'AI news',
  category: 'news',
  async fetch(fetchImpl: FetchLike, cfg: DiscoverConfig): Promise<DiscoverItem[]> {
    const { items, failures } = await fetchNewsFeeds(fetchImpl, cfg.now?.() ?? Date.now());
    // Partial failures still return what arrived; only a total failure is an error
    if (failures.length >= NEWS_FEEDS.length) throw new Error(summarizeFeedFailures(failures, NEWS_FEEDS.length));
    return items;
  },
};
