import { getText, plainText, safeUrl } from '../types';
import type { DiscoverConfig, DiscoverItem, DiscoverSource } from '../types';
import { authorLine, isoDate, paperGoal, paperSummary } from './hfPapers';

/**
 * arXiv: the newest papers whose abstracts mention the user's keywords, in
 * software engineering, NLP, AI and ML. The API returns Atom XML, parsed
 * with regexes to avoid an XML dependency.
 */

const SOURCE_ID = 'arxiv';
const SOURCE_LABEL = 'arXiv';
const API = 'https://export.arxiv.org/api/query';
const MAX_ITEMS = 15;
const CATEGORIES = ['cs.SE', 'cs.CL', 'cs.AI', 'cs.LG'];
const MAX_KEYWORDS = 10;
/** New-style (2609.30266) and old-style (cs/0112017) ids, without the version */
const ARXIV_ID_RE = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})$/;
const CATEGORY_RE = /^[a-z-]+(?:\.[a-z-]+)?$/i;

export interface ArxivEntry {
  /** Versionless id, e.g. 2609.30266 */
  id: string;
  title: string;
  abstract: string;
  published?: string;
  authors: string[];
  primaryCategory?: string;
  /** https abs link, or null when the entry has no usable one */
  url: string | null;
}

/** abs:"kw" OR … AND-ed with the category filter. Quotes and parens are stripped from keywords. */
export function buildArxivQuery(keywords: string[]): string {
  const terms = [...new Set(keywords
    .map((k) => (typeof k === 'string' ? k : '').replace(/["()\\]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean))]
    .slice(0, MAX_KEYWORDS)
    .map((k) => `abs:"${k}"`);
  const cats = `(${CATEGORIES.map((c) => `cat:${c}`).join(' OR ')})`;
  return terms.length ? `(${terms.join(' OR ')}) AND ${cats}` : cats;
}

export function arxivQueryUrl(keywords: string[]): string {
  return `${API}?search_query=${encodeURIComponent(buildArxivQuery(keywords))}&sortBy=submittedDate&sortOrder=descending&max_results=${MAX_ITEMS}`;
}

// Atom text and attribute values are plain text with XML escapes: decoding
// them once (plainText) keeps "n &lt; 10" as "n < 10" and "&amp;lt;" as "&lt;"
const xmlText = (raw: string | undefined, max: number) => plainText(raw ?? '', max);

function tagContent(block: string, name: string): string | undefined {
  return block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1];
}

function attr(tag: string, name: string): string | undefined {
  const raw = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return raw ? xmlText(raw[1] ?? raw[2], 1000) : undefined;
}

/** An arxiv.org/abs/ URL as https, else null (error entries link to /api/errors). */
function absUrl(href: string | undefined): string | null {
  const url = safeUrl(href);
  if (!url) return null;
  const u = new URL(url);
  if (!/^(www\.)?arxiv\.org$/i.test(u.hostname) || !u.pathname.startsWith('/abs/')) return null;
  u.protocol = 'https:';
  return u.toString();
}

/** Atom feed → raw entries (no limit, no dedupe). Error and malformed entries are skipped. */
export function parseArxivEntries(xml: string): ArxivEntry[] {
  if (typeof xml !== 'string') return [];
  const out: ArxivEntry[] = [];
  for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const block = m[1];
    const rawId = xmlText(tagContent(block, 'id'), 200);
    const idMatch = rawId.match(/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/i);
    const id = idMatch?.[1] ?? '';
    if (!ARXIV_ID_RE.test(id)) continue;
    const title = xmlText(tagContent(block, 'title'), 200);
    if (!title) continue;
    const links = [...block.matchAll(/<link\b[^>]*>/g)].map((l) => l[0]);
    const alternate = links.find((l) => attr(l, 'rel') === 'alternate') ?? links.find((l) => !attr(l, 'rel'));
    const url = absUrl(alternate && attr(alternate, 'href')) ?? absUrl(`https://arxiv.org/abs/${rawId.replace(/^.*?arxiv\.org\/abs\//i, '')}`);
    const authors = [...block.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/g)]
      .map((a) => xmlText(tagContent(a[1], 'name'), 60))
      .filter(Boolean);
    const catTag = block.match(/<(?:\w+:)?primary_category\b[^>]*>/)?.[0];
    const primary = catTag ? attr(catTag, 'term') : undefined;
    out.push({
      id,
      title,
      abstract: xmlText(tagContent(block, 'summary'), 5000),
      published: isoDate(xmlText(tagContent(block, 'published'), 40)),
      authors,
      primaryCategory: primary && CATEGORY_RE.test(primary) ? primary : undefined,
      url,
    });
  }
  return out;
}

/** The API's error message when it answered with an error entry (HTTP 200), else null. */
export function arxivError(xml: string): string | null {
  for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    if (/arxiv\.org\/api\/errors/i.test(tagContent(m[1], 'id') ?? '')) {
      return xmlText(tagContent(m[1], 'summary'), 200) || 'unknown error';
    }
  }
  return null;
}

/** Atom feed → items, in feed order (newest submissions first). */
export function parseArxivFeed(xml: string): DiscoverItem[] {
  const seen = new Set<string>();
  const items: DiscoverItem[] = [];
  for (const e of parseArxivEntries(xml)) {
    if (!e.url || seen.has(e.id)) continue;
    seen.add(e.id);
    const summary = paperSummary(authorLine(e.authors), e.abstract);
    const tags = e.primaryCategory ? [e.primaryCategory.toLowerCase(), 'paper'] : ['paper'];
    items.push({
      id: `${SOURCE_ID}:${e.id}`,
      category: 'research',
      source: SOURCE_ID,
      sourceLabel: SOURCE_LABEL,
      title: e.title,
      url: e.url,
      ...(summary ? { summary } : {}),
      ...(e.published ? { date: e.published } : {}),
      tags,
      goal: paperGoal(e.title, e.url, e.abstract, e.primaryCategory),
      // Shared with Hugging Face papers (whose ids are arXiv ids)
      canonicalId: `arxiv:${e.id}`,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

export const arxivSource: DiscoverSource = {
  id: SOURCE_ID,
  label: SOURCE_LABEL,
  category: 'research',
  // New submissions appear once a day and the API asks for gentle use
  ttlMs: 3 * 60 * 60_000,
  minRefreshMs: 5 * 60_000,
  async fetch(fetchImpl, cfg: DiscoverConfig) {
    // arXiv's API is often slow; give it longer than the default
    const xml = await getText(fetchImpl, arxivQueryUrl(cfg.keywords ?? []), { Accept: 'application/atom+xml' }, 25_000);
    const err = arxivError(xml);
    if (err) throw new Error(`arXiv API error: ${err}`);
    if (!/<feed\b/.test(xml)) throw new Error('export.arxiv.org returned an unexpected payload');
    return parseArxivFeed(xml);
  },
};
