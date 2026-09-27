import crypto from 'crypto';
import { webSearch, type SearchResult } from '../../webTools';
import { plainText, safeUrl } from '../types';
import type { DiscoverConfig, DiscoverItem, DiscoverSource } from '../types';
import { canonicalNewsId, newsGoal } from './aiNews';

/**
 * AI updates found by web search (keyless DuckDuckGo, the agent's own
 * web_search). DuckDuckGo starts answering automated queries with a bot
 * check after a few quick requests, so this runs about once a day — as part
 * of the daily digest — with a pause between queries, and stops at the first
 * sign of a bot check instead of asking again.
 */

const ID = 'web-search';
const QUERIES_MAX = 3;
const PER_QUERY = 5;
const PAUSE_MS = 4_000;

export type SearchFn = (query: string) => Promise<SearchResult[]>;

export const RATE_LIMITED_MESSAGE = 'DuckDuckGo is rate limiting automated searches; try again later';

// What webTools' fetch throws for a refused request (`HTTP 429 Too Many Requests`)
const BLOCKED_ERROR = /\bHTTP (?:403|429)\b|rate limit|too many requests|anomaly|captcha/i;

/** Queries: two fixed "what's new in AI" searches plus the first news keyword
 *  (falling back to the first research keyword), which also tags its results. */
function buildQueries(cfg: Pick<DiscoverConfig, 'newsKeywords' | 'keywords'>): { query: string; keyword?: string }[] {
  const first = (list: unknown) =>
    (Array.isArray(list) ? list : []).map((k) => (typeof k === 'string' ? k.replace(/\s+/g, ' ').trim().slice(0, 60) : '')).find(Boolean) ?? '';
  const kw = first(cfg.newsKeywords) || first(cfg.keywords);
  return [
    { query: 'new AI model released this week' },
    { query: 'AI lab research announcement this week' },
    ...(kw ? [{ query: `${kw} news this week`, keyword: kw }] : []),
  ].slice(0, QUERIES_MAX);
}

export function newsQueries(cfg: Pick<DiscoverConfig, 'newsKeywords' | 'keywords'>): string[] {
  return buildQueries(cfg).map((q) => q.query);
}

/** One query's results → items. `keyword` tags results of the keyword query. */
export function toSearchItems(query: string, results: SearchResult[], keyword?: string): DiscoverItem[] {
  const items: DiscoverItem[] = [];
  for (const r of results) {
    if (items.length === PER_QUERY) break;
    const url = safeUrl(r?.url);
    // webSearch already turned the HTML into text: keep "<" literally
    const title = plainText(r?.title, 200);
    if (!url || !title) continue;
    const host = new URL(url).hostname.replace(/^www\./, '');
    // Sponsored rows point back at duckduckgo.com (y.js ad redirects)
    if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) continue;
    const summary = plainText(r.snippet, 400);
    items.push({
      id: `${ID}:${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}`,
      category: 'news',
      source: ID,
      sourceLabel: 'Web search',
      title,
      url,
      ...(summary ? { summary } : {}),
      tags: ['web', host, ...(keyword ? [keyword] : [])],
      goal: newsGoal(`Read "${title}" (${url}; found by a web search for "${query}")`, title, summary),
      canonicalId: canonicalNewsId(url),
    });
  }
  return items;
}

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

export function makeWebSearchSource(search: SearchFn = webSearch, pauseMs = PAUSE_MS): DiscoverSource {
  return {
    id: ID,
    label: 'Web search',
    category: 'news',
    // Once a day, even when a refresh is forced
    ttlMs: 20 * 3_600_000,
    minRefreshMs: 20 * 3_600_000,
    async fetch(_fetchImpl, cfg) {
      const queries = buildQueries(cfg);
      const seen = new Set<string>();
      const items: DiscoverItem[] = [];
      const errors: string[] = [];
      let blocked = false;
      for (const [i, { query, keyword }] of queries.entries()) {
        if (i && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
        let results: SearchResult[];
        try {
          results = await search(query);
        } catch (err) {
          const msg = message(err);
          errors.push(msg);
          if (BLOCKED_ERROR.test(msg)) { blocked = true; break; }
          continue;
        }
        // A bot check is an HTTP 202 challenge page that webSearch parses to no
        // results; these broad queries are never really empty. More requests
        // would only prolong the block, so stop here.
        if (!results.length) { blocked = true; break; }
        for (const item of toSearchItems(query, results, keyword)) {
          const key = item.canonicalId ?? item.url;
          if (!seen.has(key)) { seen.add(key); items.push(item); }
        }
      }
      if (!items.length && blocked) throw new Error(RATE_LIMITED_MESSAGE);
      if (!items.length && errors.length === queries.length) throw new Error(`Web search failed for every query: ${errors[0]}`);
      return items;
    },
  };
}

export const webSearchNewsSource = makeWebSearchSource();
