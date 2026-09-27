'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sortItems, type SortMode } from '@/lib/discover/relevance';
import type { DiscoverCategory as Category, DiscoverItem as Item } from '@/lib/discover/types';
import s from './discover.module.css';

interface SourceResult { source: string; label: string; category: Category; items: Item[]; error?: string; fetchedAt: number; stale?: boolean }
interface Settings { keywords: string[]; newsKeywords: string[]; watchedRepos: string[]; topics: string[]; repo: string | null; digestHour: number }
interface Feed {
  sources: SourceResult[]; items: Item[]; settings: Settings; defaults: Settings; detectedRepo: string | null; githubToken: boolean;
  limits: { keywords: number; newsKeywords: number; watchedRepos: number; topics: number };
}
interface Digest {
  date: string; createdAt: number; highlights: Item[]; sections: { category: Category; label: string; items: Item[] }[];
  newIds: string[]; counts: Record<string, number>; errors: { source: string; error: string }[];
}
interface DigestResponse { digest: Digest | null; dates: string[]; today: string; digestHour: number; building: boolean }

type View = 'today' | 'all' | Category;

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: 'today', label: 'Today in AI', hint: 'The daily digest: news from the AI labs, releases, research and tools' },
  { id: 'all', label: 'All', hint: 'Everything, ranked by relevance to OpenCode' },
  { id: 'news', label: 'AI news', hint: 'Posts from OpenAI, Google DeepMind, Google Research, Microsoft Research, Hugging Face, NVIDIA and the tech press, plus a daily web search' },
  { id: 'updates', label: 'Releases', hint: 'Releases of AI projects OpenCode uses, and Hacker News' },
  { id: 'research', label: 'Research', hint: 'New papers: arXiv and Hugging Face daily papers' },
  { id: 'tools', label: 'New tools', hint: 'New AI repos on GitHub and new MCP servers' },
  { id: 'dependencies', label: 'Dependencies', hint: "OpenCode's outdated npm packages" },
  { id: 'project', label: 'OpenCode repo', hint: 'Open issues and failing CI checks' },
];

const SCORE_UNIT: Record<string, string> = {
  hackernews: 'points', 'github-new-repos': 'stars', 'hf-papers': 'upvotes', 'github-issues': 'comments', 'github-releases': 'reactions',
};

function relTime(iso?: string | number): string {
  if (!iso) return '';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!t) return '';
  const d = Math.round((Date.now() - t) / 60_000);
  if (d < 60) return `${Math.max(d, 1)}m ago`;
  if (d < 60 * 24) return `${Math.round(d / 60)}h ago`;
  if (d < 60 * 24 * 60) return `${Math.round(d / 1440)}d ago`;
  return new Date(t).toLocaleDateString();
}

function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export default function DiscoverView({ onUseGoal }: { onUseGoal: (goal: string) => void }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('today');
  const [sort, setSort] = useState<SortMode>('relevant');
  const [query, setQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    fetch('/api/discover').then((r) => r.json()).then((j) => { if (j?.sources) setFeed(j); else setError(j?.error || 'Could not load Discover'); })
      .catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    setRefreshing(true);
    try {
      setFeed(await postJson('/api/discover', { refresh: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: feed?.items.length ?? 0 };
    for (const i of feed?.items ?? []) c[i.category] = (c[i.category] ?? 0) + 1;
    return c;
  }, [feed]);

  const visible = useMemo(() => {
    if (view === 'today') return [];
    const q = query.trim().toLowerCase();
    const items = (feed?.items ?? []).filter((i) =>
      (view === 'all' || i.category === view) &&
      (!q || `${i.title} ${i.summary ?? ''} ${i.tags.join(' ')} ${i.sourceLabel}`.toLowerCase().includes(q)));
    return sortItems(items, sort);
  }, [feed, view, sort, query]);

  const problems = (feed?.sources ?? []).filter((r) => r.error && (view === 'all' || view === 'today' || r.category === view));
  const lastFetched = feed?.sources.length ? Math.max(...feed.sources.map((r) => r.fetchedAt)) : 0;

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <div className={s.cats} role="group" aria-label="Discover sections">
          {VIEWS.map((c) => (
            <button key={c.id} type="button" aria-pressed={view === c.id} title={c.hint}
              className={`${s.cat} ${view === c.id ? s.catActive : ''}`} onClick={() => setView(c.id)}>
              {c.label}{c.id !== 'today' && <span className={s.count}>{counts[c.id] ?? 0}</span>}
            </button>
          ))}
        </div>
        <div className={s.controls}>
          {view !== 'today' && (
            <>
              <input id="discover-search" className={s.search} type="search" placeholder="Filter…" value={query}
                onChange={(e) => setQuery(e.target.value)} aria-label="Filter Discover items"
                onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} />
              <select id="discover-sort" className={s.select} value={sort} onChange={(e) => setSort(e.target.value as SortMode)} aria-label="Sort">
                <option value="relevant">Most relevant</option>
                <option value="newest">Newest</option>
                <option value="popular">Most popular</option>
              </select>
            </>
          )}
          <button type="button" className={s.btn} onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <button type="button" className={s.btn} onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} disabled={!feed}>Sources</button>
        </div>
      </div>

      {showSettings && feed && (
        <SettingsForm feed={feed} onClose={() => setShowSettings(false)}
          onSaved={(settings) => { setFeed((f) => (f ? { ...f, settings } : f)); setShowSettings(false); void refresh(); }} />
      )}

      {error && <div className={s.error} role="alert">{error}</div>}
      {problems.length > 0 && (
        <div className={s.warn}>
          {problems.map((p) => (
            <div key={p.source}><b>{p.label}:</b> {p.error}{p.stale && p.items.length ? ' — showing the last results' : ''}</div>
          ))}
        </div>
      )}

      {view === 'today' ? (
        <TodayView onUseGoal={onUseGoal} />
      ) : (
        <>
          <div className={s.status}>
            {loading ? 'Loading sources…' : `${visible.length} item${visible.length === 1 ? '' : 's'}${lastFetched ? ` · updated ${relTime(lastFetched)}` : ''}`}
            {feed && !feed.githubToken && <span> · Add GITHUB_TOKEN in Settings → API keys for higher GitHub rate limits</span>}
          </div>
          <ItemList items={visible} onUseGoal={onUseGoal} />
          {!loading && visible.length === 0 && !error && (
            <div className={s.empty}>{query ? 'Nothing matches this filter.' : 'Nothing here right now. Try Refresh, or adjust Sources.'}</div>
          )}
        </>
      )}
    </div>
  );
}

function ItemList({ items, onUseGoal, newIds }: { items: Item[]; onUseGoal: (goal: string) => void; newIds?: Set<string> }) {
  return (
    <ul className={s.list}>
      {items.map((i) => <ItemCard key={i.id} item={i} onUseGoal={onUseGoal} isNew={newIds?.has(i.id)} />)}
    </ul>
  );
}

function ItemCard({ item: i, onUseGoal, isNew }: { item: Item; onUseGoal: (goal: string) => void; isNew?: boolean }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const codeRef = useRef<HTMLElement>(null);
  const unit = SCORE_UNIT[i.source];
  const tags = [...new Set(i.tags)].slice(0, 5);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(i.command!);
      setCopyState('copied');
    } catch {
      // Clipboard blocked: select the command so Ctrl+C works
      const el = codeRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2500);
  };

  return (
    <li className={s.item}>
      <div className={s.itemTop}>
        <span className={s.source}>{i.sourceLabel}</span>
        {isNew && <span className={s.newBadge}>New today</span>}
        {i.date && <span className={s.dim}>{relTime(i.date)}</span>}
        {unit && typeof i.score === 'number' && i.score > 0 && <span className={s.dim}>{i.score.toLocaleString()} {unit}</span>}
      </div>
      <a className={s.title} href={i.url} target="_blank" rel="noreferrer">{i.title}</a>
      {i.summary && <p className={s.summary}>{i.summary}</p>}
      {(i.relevance?.areas.length || tags.length) ? (
        <div className={s.chips}>
          {i.relevance?.areas.map((a) => <span key={`a-${a}`} className={`${s.chip} ${s.chipArea}`}>{a}</span>)}
          {tags.map((t, n) => <span key={`t-${n}`} className={s.chip}>{t}</span>)}
        </div>
      ) : null}
      <div className={s.actions}>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => onUseGoal(i.goal)} title={i.goal}>Use as upgrade goal</button>
        {i.command && (
          <button type="button" className={s.btn} onClick={() => void copy()} title={i.command}>
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Press Ctrl+C to copy' : 'Copy command'}
          </button>
        )}
        <a className={s.link} href={i.url} target="_blank" rel="noreferrer">Open ↗</a>
      </div>
      {i.command && <code ref={codeRef} className={s.command}>{i.command}</code>}
    </li>
  );
}

function TodayView({ onUseGoal }: { onUseGoal: (goal: string) => void }) {
  const [data, setData] = useState<DigestResponse | null>(null);
  const [error, setError] = useState('');
  const [building, setBuilding] = useState(false);

  const load = useCallback(async (date?: string) => {
    try {
      const r = await fetch(`/api/discover/digest${date ? `?date=${encodeURIComponent(date)}` : ''}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setData(j);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    fetch('/api/discover/digest').then((r) => r.json()).then((j) => { if (j && 'dates' in j) setData(j); else setError(j?.error || 'Could not load the digest'); })
      .catch((e) => setError(String(e)));
  }, []);

  // While the server builds today's digest in the background, check back
  const serverBuilding = !!data?.building && data.digest?.date !== data.today;
  useEffect(() => {
    if (!serverBuilding) return;
    const t = setInterval(() => { void load(); }, 5_000);
    return () => clearInterval(t);
  }, [serverBuilding, load]);

  const buildNow = async () => {
    setBuilding(true);
    setError('');
    try {
      const j = await postJson('/api/discover/digest', {});
      setData((d) => ({ ...(d ?? { today: j.digest.date, digestHour: 8, building: false }), digest: j.digest, dates: j.dates, building: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  };

  const digest = data?.digest ?? null;
  const newIds = useMemo(() => new Set(digest?.newIds ?? []), [digest]);
  const isToday = !!digest && digest.date === data?.today;

  return (
    <section className={s.today} aria-labelledby="today-heading">
      <div className={s.todayHead}>
        <div>
          <h3 id="today-heading" className={s.todayTitle}>{digest ? (isToday ? 'Today in AI' : `AI on ${longDate(digest.date)}`) : 'Today in AI'}</h3>
          <p className={s.dim}>
            {digest
              ? `${isToday ? longDate(digest.date) : 'Past digest'} · built ${relTime(digest.createdAt)}${digest.newIds.length ? ` · ${digest.newIds.length} new since the previous digest` : ''}`
              : serverBuilding ? "Building today's digest — this takes up to a couple of minutes…"
                : `Built automatically every day after ${String(data?.digestHour ?? 8).padStart(2, '0')}:00 while OpenCode runs.`}
          </p>
        </div>
        <div className={s.controls}>
          {data && data.dates.length > 0 && (
            <select id="digest-date" className={s.select} aria-label="Digest date" value={digest?.date ?? ''} onChange={(e) => void load(e.target.value)}>
              {data.dates.map((d) => <option key={d} value={d}>{d === data.today ? `Today (${d})` : d}</option>)}
            </select>
          )}
          <button type="button" className={s.btn} onClick={() => void buildNow()} disabled={building || serverBuilding}>
            {building ? 'Building…' : isToday ? 'Rebuild' : "Build today's digest"}
          </button>
        </div>
      </div>

      {error && <div className={s.error} role="alert">{error}</div>}
      {digest && digest.errors.length > 0 && (
        <div className={s.warn}>{digest.errors.map((e) => <div key={e.source}><b>{e.source}:</b> {e.error}</div>)}</div>
      )}

      {digest && digest.highlights.length > 0 && (
        <>
          <h4 className={s.sectionTitle}>Highlights from the labs and the press</h4>
          <ul className={s.highlights}>
            {digest.highlights.map((h) => (
              <li key={h.id} className={s.highlight}>
                <span className={s.org}>{h.sourceLabel}{newIds.has(h.id) && <span className={s.newBadge}>New</span>}</span>
                <a className={s.title} href={h.url} target="_blank" rel="noreferrer">{h.title}</a>
                <span className={s.dim}>{relTime(h.date)}</span>
                <button type="button" className={s.linkBtn} onClick={() => onUseGoal(h.goal)} title={h.goal}>Use as upgrade goal</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {digest?.sections.map((sec) => (
        <div key={sec.category}>
          <h4 className={s.sectionTitle}>{sec.label} <span className={s.count}>{digest.counts[sec.category] ?? sec.items.length}</span></h4>
          <ItemList items={sec.items} onUseGoal={onUseGoal} newIds={newIds} />
        </div>
      ))}

      {data && !digest && !serverBuilding && (
        <div className={s.empty}>No digest yet. Build one now, or it will be built after {String(data.digestHour).padStart(2, '0')}:00.</div>
      )}
    </section>
  );
}

function SettingsForm({ feed, onSaved, onClose }: { feed: Feed; onSaved: (settings: Settings) => void; onClose: () => void }) {
  const [keywords, setKeywords] = useState(feed.settings.keywords.join('\n'));
  const [newsKeywords, setNewsKeywords] = useState(feed.settings.newsKeywords.join('\n'));
  const [repos, setRepos] = useState(feed.settings.watchedRepos.join('\n'));
  const [topics, setTopics] = useState(feed.settings.topics.join('\n'));
  const [repo, setRepo] = useState(feed.settings.repo ?? '');
  const [digestHour, setDigestHour] = useState(String(feed.settings.digestHour));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Keywords may contain commas; repos and topics never do
  const lines = (v: string) => v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const list = (v: string) => v.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);

  const save = async (body: Settings) => {
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/discover', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
      onSaved(j.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={s.settings}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      onSubmit={(e) => {
        e.preventDefault();
        void save({ keywords: lines(keywords), newsKeywords: lines(newsKeywords), watchedRepos: list(repos), topics: list(topics), repo: repo.trim() || null, digestHour: Number(digestHour) });
      }}>
      <div className={s.settingsGrid}>
        <label className={s.field}>
          <span>Research keywords <small>phrases for arXiv and papers, one per line, up to {feed.limits.keywords}</small></span>
          <textarea id="discover-keywords" rows={5} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </label>
        <label className={s.field}>
          <span>News keywords <small>short words for headlines and the daily web search, up to {feed.limits.newsKeywords}</small></span>
          <textarea id="discover-news-keywords" rows={5} value={newsKeywords} onChange={(e) => setNewsKeywords(e.target.value)} />
        </label>
        <label className={s.field}>
          <span>Watched repositories <small>owner/name; releases count as updates</small></span>
          <textarea id="discover-repos" rows={5} value={repos} onChange={(e) => setRepos(e.target.value)} />
        </label>
        <label className={s.field}>
          <span>GitHub topics for new tools <small>up to {feed.limits.topics}</small></span>
          <textarea id="discover-topics" rows={5} value={topics} onChange={(e) => setTopics(e.target.value)} />
        </label>
        <label className={s.field}>
          <span>OpenCode repository <small>for issues and CI; empty uses {feed.detectedRepo ?? 'the git remote'}</small></span>
          <input id="discover-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={feed.detectedRepo ?? 'owner/name'} />
        </label>
        <label className={s.field}>
          <span>Daily digest after <small>server time, 0–23</small></span>
          <input id="discover-digest-hour" type="number" min={0} max={23} step={1} value={digestHour} onChange={(e) => setDigestHour(e.target.value)} />
        </label>
      </div>
      {error && <div className={s.error} role="alert">{error}</div>}
      <div className={s.actions}>
        <button type="button" className={s.btn} onClick={() => void save(feed.defaults)} disabled={saving}>Reset to defaults</button>
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={saving}>{saving ? 'Saving…' : 'Save and refresh'}</button>
      </div>
    </form>
  );
}
