import type { PublicApiWithKey } from '@/lib/publicApis/catalog';

/** The Browse panel's result list and its pure state transitions (no DOM, unit-tested). */

export interface BrowseResults {
  query: string;
  total: number;
  entries: PublicApiWithKey[];
  /** Card that takes keyboard focus once rendered: the first of an appended page, or the first after a retry. */
  focusIndex?: number;
}

export function browsePageUrl(query: string, offset: number, limit: number): string {
  return `/api/public-apis?${query}${query ? '&' : ''}offset=${offset}&limit=${limit}`;
}

/**
 * Appends a "Load more" page to the list it continues (`base`, the list the
 * request's offset came from). If the list has been replaced since, e.g. by a
 * refetch of the same query, the page is dropped: appended there it would skip
 * entries and leave "Load more" stuck on an offset it already has.
 */
export function appendPage(
  prev: BrowseResults | null,
  base: BrowseResults,
  page: { total: number; entries: PublicApiWithKey[] }
): BrowseResults | null {
  if (!prev || prev.query !== base.query || prev.entries.length !== base.entries.length) return prev;
  const seen = new Set(prev.entries.map((api) => api.id));
  const added = page.entries.filter((api) => !seen.has(api.id));
  return {
    ...prev,
    total: page.total,
    entries: [...prev.entries, ...added],
    focusIndex: added.length ? prev.entries.length : undefined,
  };
}

/**
 * Swaps in re-read copies of the loaded entries (with current key status),
 * keeping their order and every page already loaded. Leaves another query's
 * list alone and never moves focus.
 */
export function withLatestEntries(
  prev: BrowseResults | null,
  query: string,
  latest: readonly PublicApiWithKey[]
): BrowseResults | null {
  if (!prev || prev.query !== query) return prev;
  const byId = new Map(latest.map((api) => [api.id, api]));
  return { ...prev, entries: prev.entries.map((api) => byId.get(api.id) ?? api), focusIndex: undefined };
}
