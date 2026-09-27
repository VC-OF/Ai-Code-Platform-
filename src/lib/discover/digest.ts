import fs from 'fs';
import path from 'path';
import { getDiscoverFeed } from './index';
import { loadSettings } from './config';
import { sortItems } from './relevance';
import type { DiscoverCategory, DiscoverItem } from './types';

/**
 * "Today in AI": once a day (after the configured hour, server-local time)
 * every Discover source is refreshed and a dated snapshot is written to
 * .platform/discover-digests/YYYY-MM-DD.json, so past days stay browsable.
 */

export interface DigestSection {
  category: DiscoverCategory;
  label: string;
  items: DiscoverItem[];
}

export interface Digest {
  date: string;
  createdAt: number;
  /** Top news across organisations — one per organisation first */
  highlights: DiscoverItem[];
  sections: DigestSection[];
  /** Item ids that were not in the previous digest */
  newIds: string[];
  counts: Record<string, number>;
  errors: { source: string; error: string }[];
}

export const SECTION_LABELS: Record<DiscoverCategory, string> = {
  news: 'AI news',
  updates: 'Releases',
  research: 'Research',
  tools: 'New tools',
  dependencies: 'Dependency updates',
  project: 'OpenCode repo',
};

const SECTION_ORDER: DiscoverCategory[] = ['news', 'updates', 'research', 'tools', 'dependencies', 'project'];
const PER_SECTION = 8;
const HIGHLIGHTS = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD in server-local time. */
export function localDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Highlights: the labs' own posts before press and web results, newest
 *  first, and one item per organisation before any second one. */
export function pickHighlights(items: DiscoverItem[], max = HIGHLIGHTS): DiscoverItem[] {
  const rank = (i: DiscoverItem) => (i.tags.includes('lab') ? 0 : i.tags.includes('press') ? 1 : 2);
  const news = sortItems(items.filter((i) => i.category === 'news'), 'newest').sort((a, b) => rank(a) - rank(b));
  const seen = new Set<string>();
  const first: DiscoverItem[] = [];
  const rest: DiscoverItem[] = [];
  for (const i of news) (seen.has(i.sourceLabel) ? rest : (seen.add(i.sourceLabel), first)).push(i);
  return [...first, ...rest].slice(0, max);
}

export function buildDigest(date: string, items: DiscoverItem[], errors: Digest['errors'], previous: Digest | null, now = Date.now()): Digest {
  const prevIds = new Set(previous ? [...previous.highlights, ...previous.sections.flatMap((s) => s.items)].map((i) => i.id) : []);
  const sections = SECTION_ORDER.map((category) => ({
    category,
    label: SECTION_LABELS[category],
    items: sortItems(items.filter((i) => i.category === category), category === 'news' ? 'newest' : 'relevant').slice(0, PER_SECTION),
  })).filter((s) => s.items.length);
  const highlights = pickHighlights(items);
  const all = [...highlights, ...sections.flatMap((s) => s.items)];
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.category] = (counts[i.category] ?? 0) + 1;
  return {
    date,
    createdAt: now,
    highlights,
    sections,
    newIds: previous ? [...new Set(all.map((i) => i.id).filter((id) => !prevIds.has(id)))] : [],
    counts,
    errors,
  };
}

function dir(root: string) {
  return path.join(root, '.platform', 'discover-digests');
}

export function listDigests(root: string): string[] {
  try {
    return fs.readdirSync(dir(root)).map((f) => f.replace(/\.json$/, '')).filter((d) => DATE_RE.test(d)).sort().reverse();
  } catch {
    return [];
  }
}

export function readDigest(root: string, date: string): Digest | null {
  if (!DATE_RE.test(date)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir(root), `${date}.json`), 'utf8')) as Digest;
    return d && d.date === date && Array.isArray(d.sections) && Array.isArray(d.highlights) ? d : null;
  } catch {
    return null;
  }
}

/** Build (refreshing every source) and save the digest for `now`'s date. */
export async function createDigest(root: string, now = Date.now()): Promise<Digest> {
  const date = localDate(now);
  // A generous deadline: the digest should include slow sources, not "still loading"
  const feed = await getDiscoverFeed(root, { refresh: true, deadlineMs: 120_000 });
  const previous = listDigests(root).filter((d) => d < date).map((d) => readDigest(root, d)).find(Boolean) ?? null;
  const digest = buildDigest(date, feed.items, feed.sources.filter((s) => s.error).map((s) => ({ source: s.label, error: s.error! })), previous, now);
  fs.mkdirSync(dir(root), { recursive: true });
  fs.writeFileSync(path.join(dir(root), `${date}.json`), JSON.stringify(digest));
  return digest;
}

const state = globalThis as unknown as { __ocDigestTimer?: ReturnType<typeof setInterval>; __ocDigestRunning?: Promise<Digest> | null };

/** Today's digest if due and missing; concurrent callers share one build. */
export async function ensureDailyDigest(root: string, now = Date.now()): Promise<Digest | null> {
  const date = localDate(now);
  const existing = readDigest(root, date);
  if (existing) return existing;
  if (new Date(now).getHours() < loadSettings(root).digestHour) return null;
  if (!state.__ocDigestRunning) {
    state.__ocDigestRunning = createDigest(root, now).finally(() => { state.__ocDigestRunning = null; });
  }
  return state.__ocDigestRunning;
}

const TICK_MS = 10 * 60_000;

/** Background check every 10 min; the server keeps building one digest a day while it runs. */
export function startDigestScheduler(root: string) {
  if (state.__ocDigestTimer || process.env.NODE_ENV === 'test' || process.env.OPEN_CODE_SCHEDULER === 'off') return;
  const tick = () => { void ensureDailyDigest(root).catch((err) => console.warn('[discover] daily digest failed:', err instanceof Error ? err.message : err)); };
  state.__ocDigestTimer = setInterval(tick, TICK_MS);
  state.__ocDigestTimer.unref?.();
  setTimeout(tick, 5_000).unref?.();
}
