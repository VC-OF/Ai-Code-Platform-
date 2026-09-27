'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  MAX_PAGE_SIZE,
  type AuthKind,
  type CategoryCount,
  type CorsSupport,
  type PublicApiWithKey,
} from '@/lib/publicApis/catalog';
import type { ResolvedIdea } from '@/lib/publicApis/ideas';
import { AuthBadge, CorsBadge, HttpsBadge, KeySavedMark } from './Badges';
import { appendPage, browsePageUrl, withLatestEntries, type BrowseResults } from './browseResults';
import { getJson, type BrowseResponse, type CategoriesResponse } from './types';
import styles from './Gallery.module.css';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 250;

const AUTH_OPTIONS: { value: AuthKind | 'any'; label: string }[] = [
  { value: 'any', label: 'Any auth' },
  { value: 'none', label: 'No key' },
  { value: 'apiKey', label: 'API key' },
  { value: 'oauth', label: 'OAuth' },
];

const CORS_OPTIONS: { value: CorsSupport | 'any'; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'yes', label: 'Enabled' },
  { value: 'unknown', label: 'Unknown' },
  { value: 'no', label: 'Not enabled' },
];

interface BrowsePanelProps {
  /** Categories the gallery already has; the panel fetches its own while this is empty. */
  categories: CategoryCount[];
  catalogSize: number | null;
  ideas: ResolvedIdea[] | null;
  /** Bumped when saved keys may have changed elsewhere; loaded entries then re-read their key status. */
  refreshToken?: number;
  onBuildApi: (api: PublicApiWithKey) => void;
  onBuildIdea: (idea: ResolvedIdea) => void;
}

export default function BrowsePanel({
  categories,
  catalogSize,
  ideas,
  refreshToken = 0,
  onBuildApi,
  onBuildIdea,
}: BrowsePanelProps) {
  const ids = useId();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [auth, setAuth] = useState<AuthKind | 'any'>('any');
  const [httpsOnly, setHttpsOnly] = useState(false);
  const [cors, setCors] = useState<CorsSupport | 'any'>('any');

  const [results, setResults] = useState<BrowseResults | null>(null);
  // Whether `results` came from the current query's own fetch. After a round
  // trip (A → B → A) the old A results match the query string again, but stay
  // dimmed, without "Load more", until A's refetch lands.
  const [fresh, setFresh] = useState(false);
  const [failedQuery, setFailedQuery] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [ownCategories, setOwnCategories] = useState<CategoriesResponse | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // Aborted when the query changes, cancelling that query's "Load more" too
  const requestRef = useRef<AbortController | null>(null);
  // The current results, for the key-status refresh (which must not refetch on every page)
  const currentRef = useRef<BrowseResults | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (category) params.set('category', category);
    if (auth !== 'any') params.set('auth', auth);
    if (httpsOnly) params.set('https', '1');
    if (cors !== 'any') params.set('cors', cors);
    return params.toString();
  }, [debouncedSearch, category, auth, httpsOnly, cors]);

  // A new query starts clean: an earlier failure of the same query string, or
  // the previous query's "Load more" state, must not show against it.
  const [statusQuery, setStatusQuery] = useState(query);
  if (statusQuery !== query) {
    setStatusQuery(query);
    setFresh(false);
    setFailedQuery(null);
    setRetrying(false);
    setLoadingMore(false);
    setLoadMoreFailed(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    getJson<BrowseResponse>(browsePageUrl(query, 0, PAGE_SIZE), controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        // "Try again" gives way to "Clear filters" now; don't leave focus on a removed button
        const retryFocused = retryRef.current !== null && document.activeElement === retryRef.current;
        if (retryFocused && !data.entries.length) searchRef.current?.focus();
        setResults({
          query,
          total: data.total,
          entries: data.entries,
          focusIndex: retryFocused && data.entries.length ? 0 : undefined,
        });
        setFresh(true);
        setRetrying(false);
        setLoadMoreFailed(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFailedQuery(query);
        setRetrying(false);
      });
    return () => controller.abort();
  }, [query, retryToken]);

  const needCategories = categories.length === 0 && ownCategories === null;
  useEffect(() => {
    if (!needCategories) return;
    const controller = new AbortController();
    getJson<CategoriesResponse>('/api/public-apis?view=categories', controller.signal)
      .then(setOwnCategories)
      .catch(() => {
        // The select keeps "All categories"; "Try again" re-requests it
      });
    return () => controller.abort();
  }, [needCategories, retryToken]);

  // After "Load more" (or a retry), move focus to the first new card for keyboard users
  useEffect(() => {
    const index = results?.focusIndex;
    if (index === undefined) return;
    resultsRef.current?.querySelectorAll<HTMLElement>('[data-api-card]')[index]?.focus();
  }, [results]);

  const current = fresh && results?.query === query ? results : null;
  const failed = !current && failedQuery === query;
  const loading = !current && !failed;
  // Earlier results stay (dimmed) while loading, but never under an error
  const shown = current ?? (failed ? null : results);
  const remaining = current ? current.total - current.entries.length : 0;
  const categoryOptions = categories.length ? categories : (ownCategories?.categories ?? []);
  const allCount = catalogSize ?? ownCategories?.total ?? null;

  useEffect(() => {
    currentRef.current = current;
  });

  // Saved keys can change elsewhere: re-read the key status of every loaded
  // entry in place, keeping the pages already loaded (and the scroll position)
  useEffect(() => {
    const base = currentRef.current;
    if (!refreshToken || !base?.entries.length) return;
    const controller = new AbortController();
    const pages: Promise<BrowseResponse>[] = [];
    for (let offset = 0; offset < base.entries.length; offset += MAX_PAGE_SIZE) {
      pages.push(getJson<BrowseResponse>(browsePageUrl(base.query, offset, MAX_PAGE_SIZE), controller.signal));
    }
    Promise.all(pages)
      .then((responses) => {
        if (controller.signal.aborted) return;
        const latest = responses.flatMap((page) => page.entries);
        setResults((prev) => withLatestEntries(prev, base.query, latest));
      })
      .catch(() => {
        // Keep the statuses on screen; the next refresh tries again
      });
    return () => controller.abort();
  }, [refreshToken]);

  const loadMore = async () => {
    const signal = requestRef.current?.signal;
    const base = current;
    if (!base || loadingMore || !signal || signal.aborted) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const data = await getJson<BrowseResponse>(browsePageUrl(base.query, base.entries.length, PAGE_SIZE), signal);
      if (signal.aborted) return;
      setResults((prev) => appendPage(prev, base, data));
    } catch {
      if (!signal.aborted) setLoadMoreFailed(true);
    } finally {
      if (!signal.aborted) setLoadingMore(false);
    }
  };

  // "Try again" stays mounted (inert) until the retry settles, so a double
  // click or a repeated Enter cannot land on "Clear filters" in its place
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    setFailedQuery(null);
    setRetryToken((t) => t + 1);
  };

  const filtersActive = Boolean(search.trim() || category || auth !== 'any' || httpsOnly || cors !== 'any');
  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setCategory('');
    setAuth('any');
    setHttpsOnly(false);
    setCors('any');
  };

  const categoryIdeas = category && ideas ? ideas.filter((idea) => idea.categories.includes(category)) : [];

  return (
    <>
      <div className={styles.controls}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${ids}-search`}>
            Search APIs
          </label>
          <input
            ref={searchRef}
            id={`${ids}-search`}
            type="search"
            className={styles.input}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="weather, recipes, stocks, anime…"
            maxLength={100}
            autoComplete="off"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${ids}-category`}>
            Category
          </label>
          <select
            id={`${ids}-category`}
            className={styles.select}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories{allCount ? ` (${allCount.toLocaleString()})` : ''}</option>
            {categoryOptions.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.filters}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.srOnly}>Authentication</legend>
          <div className={styles.segmented}>
            {AUTH_OPTIONS.map((option) => (
              <label key={option.value} className={styles.segment}>
                <input
                  type="radio"
                  name={`${ids}-auth`}
                  value={option.value}
                  checked={auth === option.value}
                  onChange={() => setAuth(option.value)}
                  className={styles.segmentInput}
                />
                <span className={styles.segmentLabel}>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={httpsOnly} onChange={(e) => setHttpsOnly(e.target.checked)} />
          HTTPS only
        </label>
        <label className={styles.inlineField}>
          CORS
          <select
            className={`${styles.select} ${styles.selectSmall}`}
            value={cors}
            onChange={(e) => setCors(e.target.value as CorsSupport | 'any')}
          >
            {CORS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {categoryIdeas.length > 0 && (
        <div className={styles.ideaHint}>
          <span>Ideas using {category}:</span>
          {categoryIdeas.map((idea) => (
            <button key={idea.id} type="button" className={styles.hintBtn} onClick={() => onBuildIdea(idea)}>
              {idea.title}
            </button>
          ))}
        </div>
      )}

      <div className={styles.resultBar}>
        <span role="status" aria-live="polite">
          {failed
            ? 'Couldn’t load APIs.'
            : loading
              ? 'Searching…'
              : current && current.total === 0
                ? 'No APIs match these filters.'
                : current
                  ? `Showing ${current.entries.length.toLocaleString()} of ${current.total.toLocaleString()} API${current.total === 1 ? '' : 's'}${loadMoreFailed ? '. Couldn’t load more.' : ''}`
                  : ''}
        </span>
        {/* Distinct keys: never one DOM button that changes meaning under the pointer or focus */}
        {failed || retrying ? (
          <button
            key="retry"
            ref={retryRef}
            type="button"
            className={styles.linkBtn}
            onClick={retry}
            aria-disabled={retrying || undefined}
          >
            Try again
          </button>
        ) : (
          filtersActive && (
            <button
              key="clear"
              type="button"
              className={styles.linkBtn}
              onClick={(e) => {
                // Ignore the second click of a double-click that began on "Try again":
                // a fast retry swaps this button into the same spot
                if (e.detail > 1) return;
                clearFilters();
              }}
            >
              Clear filters
            </button>
          )
        )}
      </div>

      {shown && shown.entries.length > 0 ? (
        <div ref={resultsRef} className={`${styles.grid} ${styles.gridCompact} ${styles.results}`} aria-busy={loading}>
          {shown.entries.map((api) => (
            <ApiCard key={api.id} api={api} onBuild={onBuildApi} />
          ))}
        </div>
      ) : (
        !shown && loading && (
          <div className={`${styles.grid} ${styles.gridCompact}`} aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={styles.skeleton} />
            ))}
          </div>
        )
      )}

      {current && remaining > 0 && (
        <div className={styles.moreRow}>
          {/* aria-disabled, not disabled: a disabled button would drop keyboard focus mid-load */}
          <button type="button" className={styles.secondaryBtn} onClick={loadMore} aria-disabled={loadingMore || undefined}>
            {loadingMore
              ? 'Loading…'
              : loadMoreFailed
                ? 'Couldn’t load more. Try again'
                : `Load ${Math.min(PAGE_SIZE, remaining)} more (${remaining.toLocaleString()} left)`}
          </button>
        </div>
      )}
    </>
  );
}

export function ApiCard({ api, onBuild }: { api: PublicApiWithKey; onBuild: (api: PublicApiWithKey) => void }) {
  const titleId = `api-${api.id}-name`;
  return (
    <article className={styles.card} aria-labelledby={titleId} tabIndex={-1} data-api-card>
      <div className={styles.apiHead}>
        <h3 id={titleId} className={styles.apiName}>
          {api.url ? (
            <a href={api.url} target="_blank" rel="noopener noreferrer">
              {api.name}
              <span className={styles.srOnly}> (docs, opens in a new tab)</span>
            </a>
          ) : (
            api.name
          )}
        </h3>
        <span className={styles.apiCategory}>{api.category}</span>
      </div>
      {api.description && <p className={styles.apiDesc}>{api.description}</p>}
      <div className={styles.badges}>
        <AuthBadge kind={api.authKind} label={api.authLabel} />
        <HttpsBadge https={api.https} />
        <CorsBadge cors={api.cors} />
        {api.keySaved && <KeySavedMark name={api.keySavedAs} />}
      </div>
      <div className={styles.apiFoot}>
        <button type="button" className={styles.secondaryBtn} onClick={() => onBuild(api)} aria-label={`Build with ${api.name}`}>
          Build
        </button>
      </div>
    </article>
  );
}
