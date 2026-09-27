import { describe, it, expect } from 'vitest';
import raw from '../../vendor/Public-Api-Live-Usage/apis_data.json';
import { normalizeCatalog, toSavedKeys, withKeyStatus, type RawCatalogEntry } from '@/lib/publicApis/catalog';
import { appendPage, browsePageUrl, withLatestEntries, type BrowseResults } from '@/components/gallery/browseResults';

const NO_KEYS = toSavedKeys([]);
const APIS = normalizeCatalog(raw as RawCatalogEntry[])
  .slice(0, 120)
  .map((api) => withKeyStatus(api, NO_KEYS));

function list(query: string, count: number, focusIndex?: number): BrowseResults {
  return { query, total: APIS.length, entries: APIS.slice(0, count), focusIndex };
}

function page(offset: number, limit = 24) {
  return { total: APIS.length, entries: APIS.slice(offset, offset + limit) };
}

describe('browsePageUrl', () => {
  it('appends paging to the filter query', () => {
    expect(browsePageUrl('', 0, 24)).toBe('/api/public-apis?offset=0&limit=24');
    expect(browsePageUrl('search=nasa&auth=apiKey', 48, 24)).toBe('/api/public-apis?search=nasa&auth=apiKey&offset=48&limit=24');
  });
});

describe('appendPage', () => {
  it('appends the next page and focuses its first card', () => {
    const base = list('q', 24);
    const next = appendPage(base, base, page(24))!;
    expect(next.entries.map((api) => api.id)).toEqual(APIS.slice(0, 48).map((api) => api.id));
    expect(next.focusIndex).toBe(24);
  });

  it('never appends to a list replaced while the page was loading', () => {
    // Stale A results (48 entries) were on screen when "Load more" asked for
    // offset 48; A's refetch then replaced them with its first 24
    const stale = list('q', 48);
    const refetched = list('q', 24);
    expect(appendPage(refetched, stale, page(48))).toBe(refetched);
    // …and a list for another query is left alone
    const other = list('other', 24);
    expect(appendPage(other, list('q', 24), page(24))).toBe(other);
    expect(appendPage(null, stale, page(48))).toBeNull();
  });

  it('skips entries it already has and moves focus only when something was added', () => {
    const base = list('q', 24);
    const overlap = appendPage(base, base, page(12, 24))!;
    expect(overlap.entries).toHaveLength(36);
    expect(new Set(overlap.entries.map((api) => api.id)).size).toBe(36);
    expect(overlap.focusIndex).toBe(24);
    expect(appendPage(base, base, page(0))!.focusIndex).toBeUndefined();
  });
});

describe('withLatestEntries', () => {
  const keyed = APIS.find((api) => api.authKind === 'apiKey')!;

  it('updates key status in place, keeping every loaded page', () => {
    const shown = list('q', 120, 96);
    expect(shown.entries).toContain(keyed);
    const savedCopy = withKeyStatus(keyed, toSavedKeys([keyed.keyEnv]));
    const next = withLatestEntries(shown, 'q', [savedCopy])!;
    expect(next.entries).toHaveLength(120);
    expect(next.entries.map((api) => api.id)).toEqual(shown.entries.map((api) => api.id));
    expect(next.entries.find((api) => api.id === keyed.id)).toMatchObject({ keySaved: true, keySavedAs: keyed.keyEnv });
    // A refresh never steals focus
    expect(next.focusIndex).toBeUndefined();
  });

  it('leaves another query’s list alone', () => {
    const other = list('other', 24);
    expect(withLatestEntries(other, 'q', APIS)).toBe(other);
    expect(withLatestEntries(null, 'q', APIS)).toBeNull();
  });
});
