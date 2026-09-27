import fs from 'fs';
import path from 'path';
import { buildConfig, resolveGithubToken } from './config';
import { scoreRelevance } from './relevance';
import type { DiscoverConfig, DiscoverItem, DiscoverSource, FetchLike, SourceResult } from './types';
import * as aiNews from './sources/aiNews';
import * as webSearchNews from './sources/webSearchNews';
import * as hackernews from './sources/hackernews';
import * as githubReleases from './sources/githubReleases';
import * as hfPapers from './sources/hfPapers';
import * as arxiv from './sources/arxiv';
import * as githubNewRepos from './sources/githubNewRepos';
import * as mcpRegistry from './sources/mcpRegistry';
import * as npmUpdates from './sources/npmUpdates';
import * as githubProject from './sources/githubProject';

function isSource(v: unknown): v is DiscoverSource {
  const s = v as DiscoverSource;
  return !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.label === 'string' && typeof s.fetch === 'function';
}

/** Every DiscoverSource exported by the adapter modules, in feed order. */
export const SOURCES: DiscoverSource[] = [
  aiNews, webSearchNews, hackernews, githubReleases, hfPapers, arxiv, githubNewRepos, mcpRegistry, npmUpdates, githubProject,
].flatMap((m) => Object.values(m).filter(isSource));

const TTL_MS = 30 * 60_000;
/** A forced refresh of the same source runs at most this often */
const MIN_REFRESH_MS = 60_000;
/** After a failed fetch, wait this long before trying again (unless forced) */
const ERROR_RETRY_MS = 5 * 60_000;
/** The feed answers within this time; slower sources finish in the background */
const DEADLINE_MS = 20_000;

interface State {
  __ocDiscoverCache?: Map<string, SourceResult>;
  __ocDiscoverInflight?: Map<string, Promise<SourceResult>>;
  /** Bumped by clearDiscoverCache so fetches started before it are discarded */
  __ocDiscoverGeneration?: number;
}
const state = globalThis as unknown as State;
const cache = (state.__ocDiscoverCache ??= new Map());
const inflight = (state.__ocDiscoverInflight ??= new Map());
state.__ocDiscoverGeneration ??= 0;

function cacheFile(root: string) {
  return path.join(root, '.platform', 'discover-cache.json');
}

function isResult(r: unknown): r is SourceResult {
  const x = r as SourceResult;
  return !!x && typeof x.source === 'string' && Array.isArray(x.items) && typeof x.fetchedAt === 'number' &&
    x.items.every((i) => i && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.url === 'string' && Array.isArray(i.tags));
}

function loadDiskCache(root: string) {
  if (cache.size) return;
  try {
    const rows = JSON.parse(fs.readFileSync(cacheFile(root), 'utf8')) as unknown[];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (isResult(r)) cache.set(r.source, { ...r, attemptedAt: typeof r.attemptedAt === 'number' ? r.attemptedAt : r.fetchedAt });
    }
  } catch {}
}

function saveDiskCache(root: string) {
  try {
    fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
    fs.writeFileSync(cacheFile(root), JSON.stringify([...cache.values()]));
  } catch {}
}

/** Drop cached results and invalidate fetches still in flight (settings changed). */
export function clearDiscoverCache(root: string) {
  state.__ocDiscoverGeneration = (state.__ocDiscoverGeneration ?? 0) + 1;
  cache.clear();
  inflight.clear();
  try { fs.rmSync(cacheFile(root), { force: true }); } catch {}
}

function runSource(src: DiscoverSource, cfg: DiscoverConfig, fetchImpl: FetchLike): Promise<SourceResult> {
  const running = inflight.get(src.id);
  if (running) return running;
  const generation = state.__ocDiscoverGeneration;
  const p = (async (): Promise<SourceResult> => {
    const base = { source: src.id, label: src.label, category: src.category };
    const attemptedAt = Date.now();
    let result: SourceResult;
    try {
      result = { ...base, items: await src.fetch(fetchImpl, cfg), fetchedAt: attemptedAt, attemptedAt };
    } catch (err) {
      const prev = cache.get(src.id);
      const keep = !!prev && prev.items.length > 0;
      result = {
        ...base,
        items: keep ? prev!.items : [],
        error: err instanceof Error ? err.message : String(err),
        fetchedAt: keep ? prev!.fetchedAt : attemptedAt,
        attemptedAt,
        ...(keep ? { stale: true } : {}),
      };
    }
    // Settings changed while this ran: its result belongs to the old config
    if (generation === state.__ocDiscoverGeneration) {
      cache.set(src.id, result);
      saveDiskCache(cfg.root);
    }
    return result;
  })().finally(() => {
    if (inflight.get(src.id) === p) inflight.delete(src.id);
  });
  inflight.set(src.id, p);
  return p;
}

/** Keep one item per canonicalId (the higher-scored one, with tags merged). */
export function dedupeItems(items: DiscoverItem[]): DiscoverItem[] {
  const byId = new Set<string>();
  const byCanonical = new Map<string, number>();
  const out: DiscoverItem[] = [];
  for (const item of items) {
    if (byId.has(item.id)) continue;
    byId.add(item.id);
    const at = item.canonicalId ? byCanonical.get(item.canonicalId) : undefined;
    if (at === undefined) {
      if (item.canonicalId) byCanonical.set(item.canonicalId, out.length);
      out.push(item);
      continue;
    }
    const kept = out[at];
    const winner = (item.score ?? 0) > (kept.score ?? 0) ? item : kept;
    const other = winner === item ? kept : item;
    out[at] = { ...winner, tags: [...new Set([...winner.tags, ...other.tags, `also on ${other.sourceLabel}`])] };
  }
  return out;
}

export interface DiscoverFeed {
  sources: SourceResult[];
  items: DiscoverItem[];
}

function pending(src: DiscoverSource, now: number): SourceResult {
  return { source: src.id, label: src.label, category: src.category, items: [], error: 'Still loading — refresh in a moment.', fetchedAt: now, attemptedAt: now };
}

/**
 * The feed, from cache where fresh. `refresh`: true refetches every source,
 * a source id refetches just that one (each source at most once per its
 * minimum refresh interval). Answers within DEADLINE_MS; sources still
 * running then show their cached result and fill the cache when done.
 */
export async function getDiscoverFeed(
  root: string,
  opts: { refresh?: boolean | string; fetchImpl?: FetchLike; deadlineMs?: number } = {},
): Promise<DiscoverFeed> {
  loadDiskCache(root);
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const now = Date.now();
  const cfg = { ...buildConfig(root), githubToken: await resolveGithubToken() };
  const deadline = new Promise<'deadline'>((r) => setTimeout(() => r('deadline'), opts.deadlineMs ?? DEADLINE_MS).unref?.());
  const results = await Promise.all(SOURCES.map(async (src) => {
    const cached = cache.get(src.id);
    const sinceAttempt = cached ? now - (cached.attemptedAt ?? cached.fetchedAt) : Infinity;
    const forced = opts.refresh === true || opts.refresh === src.id;
    // After an error retry sooner than the TTL — but never sooner than the
    // source's own minimum interval (the daily web search must stay daily
    // while DuckDuckGo is showing bot checks)
    const errorRetry = Math.max(ERROR_RETRY_MS, src.minRefreshMs ?? 0);
    const ttl = cached?.error ? Math.min(errorRetry, src.ttlMs ?? TTL_MS) : src.ttlMs ?? TTL_MS;
    const due = !cached || sinceAttempt > ttl || (forced && sinceAttempt > (src.minRefreshMs ?? MIN_REFRESH_MS));
    if (!due) return cached!;
    const done = await Promise.race([runSource(src, cfg, fetchImpl), deadline]);
    return done === 'deadline' ? cache.get(src.id) ?? pending(src, now) : done;
  }));

  const items = dedupeItems(results.flatMap((r) => r.items)).map((item) => ({ ...item, relevance: scoreRelevance(item, cfg.keywords) }));
  return { sources: results, items };
}
