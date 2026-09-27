/**
 * Discover — the feed behind "Upgrade OpenCode → Discover": what changed in
 * AI (releases, news), new research, new tools, OpenCode's own outdated
 * dependencies and open issues/CI. Every item carries a suggested upgrade
 * goal the user can edit and start.
 *
 * Lives outside src/lib/upgrade/ on purpose: the upgrade gate's protected
 * core is src/lib/upgrade/**, and Discover is something upgrades may improve.
 */

export type DiscoverCategory = 'news' | 'updates' | 'research' | 'tools' | 'dependencies' | 'project';

export interface DiscoverItem {
  /** Stable across refreshes: `${source}:${key}` */
  id: string;
  category: DiscoverCategory;
  /** Adapter id, e.g. 'hackernews', 'arxiv' */
  source: string;
  /** Human label, e.g. 'Hacker News' */
  sourceLabel: string;
  title: string;
  /** http(s) only — adapters drop items without a safe URL */
  url: string;
  /** Plain text, whitespace-collapsed, at most 400 chars */
  summary?: string;
  /** ISO 8601 */
  date?: string;
  /** Source-native popularity: HN points, GitHub stars, HF upvotes */
  score?: number;
  /** Short labels, e.g. 'release', 'prerelease', 'major', 'mcp' */
  tags: string[];
  /** Suggested "Upgrade OpenCode" goal; the user edits it before starting */
  goal: string;
  /** A shell command the user may run themselves (dependency updates) */
  command?: string;
  /** The same thing seen by several sources (e.g. 'arxiv:2609.12345' for a
   *  paper on both arXiv and Hugging Face); the aggregator keeps one */
  canonicalId?: string;
  /** Filled by the aggregator (relevance.ts): OpenCode areas this touches */
  relevance?: { score: number; areas: string[] };
}

export interface DiscoverConfig {
  /** Research search terms (arXiv, papers); news falls back to these */
  keywords: string[];
  /** Hacker News headline terms — broad words match titles better than phrases */
  newsKeywords?: string[];
  /** GitHub `owner/name` repos whose releases count as AI updates */
  watchedRepos: string[];
  /** GitHub topics for new-tool discovery */
  topics: string[];
  /** OpenCode's own GitHub repo (`owner/name`) for issues and CI; null = unknown */
  repo: string | null;
  /** Main checkout root (package.json, node_modules) */
  root: string;
  /** Optional token for the GitHub API (60 → 5000 requests/hour) */
  githubToken?: string;
  /** Injected clock for tests */
  now?: () => number;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** One data source. Pure `parse*` helpers live next to it for tests. */
export interface DiscoverSource {
  id: string;
  label: string;
  category: DiscoverCategory;
  /** Cache lifetime (default 30 min) */
  ttlMs?: number;
  /** Minimum gap between forced refreshes (default 60 s) */
  minRefreshMs?: number;
  fetch(fetchImpl: FetchLike, cfg: DiscoverConfig): Promise<DiscoverItem[]>;
}

export interface SourceResult {
  source: string;
  label: string;
  category: DiscoverCategory;
  items: DiscoverItem[];
  /** Set when the fetch failed; items may then be the last cached ones */
  error?: string;
  /** When the items were fetched (shown to the user) */
  fetchedAt: number;
  /** When a fetch was last attempted, successful or not (drives TTL and backoff) */
  attemptedAt: number;
  /** The fetch failed and `items` are the previous, non-empty result */
  stale?: boolean;
}

// ─── Shared helpers for adapters ─────────────────────────────────────────────

export const USER_AGENT = 'open-code-discover (+https://github.com/VC-OF/Ai-Code-Platform-)';

const NAMED: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

/** Decode character references in one pass, so "&amp;lt;" becomes "&lt;", not "<". */
function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(nbsp|lt|gt|quot|apos|amp));/gi, (m, dec, hex, name) =>
    dec ? codePoint(Number(dec)) : hex ? codePoint(parseInt(hex, 16)) : NAMED[name.toLowerCase()] ?? m);
}

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

/** Clip to `max` characters (code points, so emoji are never split) with an ellipsis. */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

/** For HTML/feed text: strip tags and comments, decode entities, collapse
 *  whitespace, clip. Only tag-shaped text (`<p>`, `</a>`, `<br/>`) is removed. */
export function cleanText(input: unknown, max = 400): string {
  if (typeof input !== 'string') return '';
  const text = decodeEntities(
    input.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
  return clip(text, max);
}

/** For fields that are plain text (JSON titles, abstracts): keep `<`/`>`
 *  literally (e.g. "Array<string>"), decode entities, collapse, clip. */
export function plainText(input: unknown, max = 400): string {
  if (typeof input !== 'string') return '';
  return clip(decodeEntities(input).replace(/\s+/g, ' ').trim(), max);
}

/** The URL if it is absolute http(s), else null. */
export function safeUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  try {
    const u = new URL(input);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A readable error for a failed response; GitHub's rate limit gets a fix. */
export function httpError(url: string, res: Response): Error {
  const host = new URL(url).host;
  if (host === 'api.github.com' && (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const at = reset ? ` until ${new Date(reset * 1000).toTimeString().slice(0, 5)}` : '';
    return new Error(`GitHub API rate limit reached${at}. Set GITHUB_TOKEN (a token with no scopes is enough) to raise it from 60 to 5,000 requests an hour.`);
  }
  return new Error(`${host} returned ${res.status}`);
}

/** GET JSON (or text) with a timeout, a UA header and a clear error. */
export async function getJson<T>(fetchImpl: FetchLike, url: string, headers: Record<string, string> = {}, timeoutMs = 15_000): Promise<T> {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw httpError(url, res);
  return (await res.json()) as T;
}

export async function getText(fetchImpl: FetchLike, url: string, headers: Record<string, string> = {}, timeoutMs = 15_000): Promise<string> {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw httpError(url, res);
  return res.text();
}

export function githubHeaders(cfg: DiscoverConfig): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(cfg.githubToken ? { Authorization: `Bearer ${cfg.githubToken}` } : {}),
  };
}

/** `owner/name` with GitHub's allowed characters only. The name may not be
 *  `.` or `..` — in a URL path `repos/owner/..` would resolve elsewhere. */
export const REPO_RE = /^[A-Za-z0-9-]{1,39}\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;
