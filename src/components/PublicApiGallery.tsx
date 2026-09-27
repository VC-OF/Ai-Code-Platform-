'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cleanLabel, type CatalogStats, type PublicApiWithKey } from '@/lib/publicApis/catalog';
import type { ResolvedIdea } from '@/lib/publicApis/ideas';
import { MAX_LIVE_TITLE } from '@/lib/publicApis/liveItems';
import type { StarterRecipe } from '@/lib/publicApis/recipes';
import {
  targetFromApi,
  targetFromIdea,
  targetFromRecipe,
  type BuildProductSpec,
  type BuildTarget,
} from '@/lib/publicApis/buildSpec';
import BrowsePanel from './gallery/BrowsePanel';
import BuildProductModal from './gallery/BuildProductModal';
import IdeasPanel from './gallery/IdeasPanel';
import StartersPanel from './gallery/StartersPanel';
import { getJson, type GalleryOverview, type IdeasResponse, type LiveItem } from './gallery/types';
import styles from './gallery/Gallery.module.css';

export type { BuildProductSpec } from '@/lib/publicApis/buildSpec';
export type { ProductRecipe } from '@/lib/publicApis/recipes';

type TabId = 'ideas' | 'starters' | 'browse';

const TABS: { id: TabId; label: string }[] = [
  { id: 'ideas', label: 'Product ideas' },
  { id: 'starters', label: 'Starters' },
  { id: 'browse', label: 'Browse all APIs' },
];

interface PublicApiGalleryProps {
  onBuildProduct?: (spec: BuildProductSpec) => Promise<void> | void;
}

// Saved keys can change elsewhere (another tab, the agent), so key status is
// re-read when the window regains focus, at most this often.
const REFRESH_MIN_INTERVAL_MS = 15_000;

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

function StatsLine({ stats }: { stats: CatalogStats | null }) {
  if (!stats) return <p className={styles.stats}>Loading the public API catalog…</p>;
  const sep = (
    <span className={styles.statsSep} aria-hidden="true">
      ·
    </span>
  );
  return (
    <p className={styles.stats}>
      {formatCount(stats.total)} APIs{sep}
      {formatCount(stats.noKey)} need no key{sep}
      {stats.savedKeys > 0 ? (
        <span className={styles.statsUnlock}>
          {stats.savedKeys} saved key{stats.savedKeys === 1 ? '' : 's'} unlock {formatCount(stats.savedKeysUnlocking)} more
        </span>
      ) : (
        <>
          {formatCount(stats.apiKey)} take an API key{sep}
          {formatCount(stats.oauth)} use OAuth
        </>
      )}
    </p>
  );
}

function liveItemRecipe(item: LiveItem): StarterRecipe {
  const isMeal = item.source === 'TheMealDB';
  // Third-party text ends up in the agent prompt; the route cleans it too
  const name = cleanLabel(item.title, MAX_LIVE_TITLE) || (isMeal ? 'a meal' : 'a photo');
  return {
    title: isMeal ? `Recipe explorer: ${name}` : `Photo gallery: ${name}`,
    api: item.source,
    category: item.category || (isMeal ? 'Food & Drink' : 'Photography'),
    description: isMeal
      ? `Build a recipe search and cooking planner app centred on ${name}.`
      : `Build a photo collection and image viewer inspired by ${name}.`,
    endpoint: item.endpoint,
    auth: 'none',
    sampleEndpoints: [item.endpoint],
    keySaved: false,
  };
}

export default function PublicApiGallery({ onBuildProduct }: PublicApiGalleryProps) {
  const [overview, setOverview] = useState<GalleryOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [overviewToken, setOverviewToken] = useState(0);
  const [ideasData, setIdeasData] = useState<IdeasResponse | null>(null);
  const [ideasError, setIdeasError] = useState(false);
  const [ideasToken, setIdeasToken] = useState(0);

  const [activeTab, setActiveTab] = useState<TabId>('ideas');
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set<TabId>(['ideas']));
  const [target, setTarget] = useState<BuildTarget | null>(null);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  // Refetches keep the data already on screen until the new response arrives
  useEffect(() => {
    const controller = new AbortController();
    getJson<GalleryOverview>('/api/public-apis', controller.signal)
      .then((data) => {
        setOverview(data);
        setOverviewError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setOverviewError(true);
      });
    return () => controller.abort();
  }, [overviewToken]);

  useEffect(() => {
    const controller = new AbortController();
    getJson<IdeasResponse>('/api/public-apis?view=ideas', controller.signal)
      .then((data) => {
        setIdeasData(data);
        setIdeasError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setIdeasError(true);
      });
    return () => controller.abort();
  }, [ideasToken]);

  useEffect(() => {
    let lastRefresh = Date.now();
    const refreshKeyStatus = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < REFRESH_MIN_INTERVAL_MS) return;
      lastRefresh = Date.now();
      setIdeasToken((t) => t + 1);
      setOverviewToken((t) => t + 1);
    };
    window.addEventListener('focus', refreshKeyStatus);
    document.addEventListener('visibilitychange', refreshKeyStatus);
    return () => {
      window.removeEventListener('focus', refreshKeyStatus);
      document.removeEventListener('visibilitychange', refreshKeyStatus);
    };
  }, []);

  const selectTab = (id: TabId, focus = false) => {
    setActiveTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    if (focus) tabRefs.current[id]?.focus();
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const next =
      e.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (index - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next === -1) return;
    e.preventDefault();
    selectTab(TABS[next].id, true);
  };

  const ideas = ideasData?.ideas ?? null;
  const stats = ideasData?.stats ?? overview?.stats ?? null;
  const live = overview ? [...overview.live.images, ...overview.live.meals].filter((item) => item.image) : [];
  const counts: Record<TabId, number | null> = {
    ideas: ideas?.length ?? null,
    starters: overview?.recipes.length ?? null,
    browse: stats?.total ?? overview?.catalogSize ?? null,
  };

  const openIdea = (idea: ResolvedIdea) => setTarget(targetFromIdea(idea));
  const openApi = (api: PublicApiWithKey) => setTarget(targetFromApi(api));
  const openRecipe = (recipe: StarterRecipe) => setTarget(targetFromRecipe(recipe));
  const openLive = (item: LiveItem) => setTarget(targetFromRecipe(liveItemRecipe(item)));

  return (
    <section className={styles.gallery} aria-labelledby="api-gallery-title">
      <div className={styles.head}>
        <div>
          <h2 id="api-gallery-title" className={styles.title}>
            Build from the open web
          </h2>
          <StatsLine stats={stats} />
        </div>
        <a
          href="https://github.com/VC-OF/Public-Api-Live-Usage"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.sourceLink}
        >
          Catalog source
        </a>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Ways to start from public APIs">
        {TABS.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={`api-gallery-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`api-gallery-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => selectTab(tab.id)}
              onKeyDown={onTabKeyDown}
            >
              {tab.label}
              {counts[tab.id] !== null && <span className={styles.tabCount}>{formatCount(counts[tab.id] as number)}</span>}
            </button>
          );
        })}
      </div>

      {TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`api-gallery-panel-${tab.id}`}
          aria-labelledby={`api-gallery-tab-${tab.id}`}
          hidden={tab.id !== activeTab}
          className={styles.panel}
        >
          {visited.has(tab.id) && tab.id === 'ideas' && (
            <IdeasPanel
              ideas={ideas}
              error={ideasError}
              onRetry={() => {
                setIdeasError(false);
                setIdeasToken((t) => t + 1);
              }}
              onBuild={openIdea}
            />
          )}
          {visited.has(tab.id) && tab.id === 'starters' && (
            <StartersPanel
              recipes={overview?.recipes ?? null}
              live={live}
              error={overviewError}
              onRetry={() => {
                setOverviewError(false);
                setOverviewToken((t) => t + 1);
              }}
              onBuildRecipe={openRecipe}
              onBuildLive={openLive}
            />
          )}
          {visited.has(tab.id) && tab.id === 'browse' && (
            <BrowsePanel
              categories={overview?.categories ?? []}
              catalogSize={stats?.total ?? null}
              ideas={ideas}
              onBuildApi={openApi}
              onBuildIdea={openIdea}
            />
          )}
        </div>
      ))}

      {target && (
        <BuildProductModal
          target={target}
          onClose={() => setTarget(null)}
          onConfirm={async (spec) => {
            if (onBuildProduct) await onBuildProduct(spec);
            setTarget(null);
          }}
        />
      )}
    </section>
  );
}
