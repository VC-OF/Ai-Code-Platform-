/**
 * Pure helpers over the bundled public-API catalog
 * (vendor/Public-Api-Live-Usage/apis_data.json). No I/O here: the route
 * imports the JSON and passes it in, so the client bundle can import these
 * types and helpers without pulling in 1,885 entries.
 */

export type AuthKind = 'none' | 'apiKey' | 'oauth' | 'other';
export type CorsSupport = 'yes' | 'no' | 'unknown';

/** One row as scraped from the upstream README table. */
export interface RawCatalogEntry {
  id?: number;
  name: string;
  url: string;
  category: string;
  description: string;
  auth: string;
  https: string;
  cors: string;
}

export interface PublicApi {
  id: number;
  name: string;
  /** Docs/home page; '' when the catalog URL is not a plain http(s) URL. */
  url: string;
  category: string;
  description: string;
  authKind: AuthKind;
  /** Human label for the auth column: 'No', 'apiKey', 'OAuth', 'X-Mashape-Key', 'User-Agent'… */
  authLabel: string;
  https: boolean;
  cors: CorsSupport;
  /** Env var the generated app reads its key from, e.g. VITE_OPENWEATHERMAP_API_KEY. */
  keyEnv: string;
}

export interface PublicApiWithKey extends PublicApi {
  keySaved: boolean;
  /** Name of the saved setting that matched (a name, never a value). */
  keySavedAs?: string;
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface CatalogStats {
  total: number;
  noKey: number;
  apiKey: number;
  oauth: number;
  other: number;
  /** Distinct saved setting names that match at least one catalog API. */
  savedKeys: number;
  /** Key-requiring APIs whose key is already saved. */
  savedKeysUnlocking: number;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 100;
const MAX_OFFSET = 100_000;

// ─── Normalisation ──────────────────────────────────────────────────────────

// The upstream table leaks control characters, backticks and backslashes into
// some cells (e.g. auth '\\\x07piKey\\', https '`Yes`').
function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value.replace(/[\t\n\v\f\r]/g, ' ')) {
    const code = ch.charCodeAt(0);
    if (code < 32 || (code >= 127 && code <= 159) || ch === '`' || ch === '\\') continue;
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Single-line, control-free text from an untrusted source, capped at `max` characters. */
export function cleanLabel(value: unknown, max = 80): string {
  const text = clean(typeof value === 'number' ? String(value) : value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Lowercase and strip diacritics so 'pokeapi' finds 'PokéAPI'. */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** VITE_<NAME>_API_KEY: uppercase, non-alphanumerics collapsed to one '_'. */
export function keyEnvFor(name: string, fallbackId = 0): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `VITE_${base || `API_${fallbackId}`}_API_KEY`;
}

/** Returns the URL only when it is a credential-free http(s) URL. */
export function safeHttpUrl(value: unknown): string {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function parseAuth(value: unknown): { kind: AuthKind; label: string } {
  const label = clean(value);
  const lower = label.toLowerCase();
  if (!lower || lower === 'no' || lower === 'none') return { kind: 'none', label: 'No' };
  if (lower.includes('oauth')) return { kind: 'oauth', label: 'OAuth' };
  if (lower.includes('key') || lower.includes('token')) {
    // Keep real header names (X-Mashape-Key); mangled cells become 'apiKey'
    return { kind: 'apiKey', label: /^x-[a-z0-9-]+$/i.test(label) ? label : 'apiKey' };
  }
  return { kind: 'other', label };
}

export function parseCors(value: unknown): CorsSupport {
  const lower = clean(value).toLowerCase();
  if (lower === 'yes') return 'yes';
  if (lower === 'no') return 'no';
  return 'unknown';
}

export function parseHttps(value: unknown): boolean {
  return clean(value).toLowerCase() === 'yes';
}

export function normalizeEntry(raw: RawCatalogEntry, index: number): PublicApi {
  const id = typeof raw.id === 'number' && Number.isInteger(raw.id) && raw.id > 0 ? raw.id : index + 1;
  const name = clean(raw.name) || `API ${id}`;
  const auth = parseAuth(raw.auth);
  return {
    id,
    name,
    url: safeHttpUrl(raw.url),
    category: clean(raw.category) || 'Uncategorized',
    description: clean(raw.description),
    authKind: auth.kind,
    authLabel: auth.label,
    https: parseHttps(raw.https),
    cors: parseCors(raw.cors),
    keyEnv: keyEnvFor(name, id),
  };
}

export function normalizeCatalog(raw: readonly RawCatalogEntry[]): PublicApi[] {
  const out: PublicApi[] = [];
  raw.forEach((entry, index) => {
    if (entry && typeof entry === 'object') out.push(normalizeEntry(entry, index));
  });
  return out;
}

// ─── Saved keys ─────────────────────────────────────────────────────────────

// Public demo keys the providers document for trying their API. Never secrets.
const KNOWN_DEMO_KEYS = new Map<string, string>([
  ['VITE_NASA_API_KEY', 'DEMO_KEY'],
  ['VITE_NASA_INSIGHT_API_KEY', 'DEMO_KEY'],
  ['VITE_FOODDATA_CENTRAL_API_KEY', 'DEMO_KEY'],
  ['VITE_THEMEALDB_API_KEY', '1'],
  ['VITE_THECOCKTAILDB_API_KEY', '1'],
]);

export function demoKeyFor(keyEnv: string | undefined): string | undefined {
  return keyEnv ? KNOWN_DEMO_KEYS.get(keyEnv) : undefined;
}

export function needsKey(api: Pick<PublicApi, 'authKind'>): boolean {
  return api.authKind === 'apiKey' || api.authKind === 'oauth';
}

/** Setting names are matched case-insensitively. */
export function toSavedKeySet(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    if (typeof name === 'string' && name.trim()) out.add(name.trim().toUpperCase());
  }
  return out;
}

/**
 * Settings the platform itself reads server-side: LLM provider keys (every
 * PROVIDERS keyEnv in src/lib/models.ts plus the ApiKeyModal ones), deploy and
 * GitHub tokens. A catalog API can share the bare name (Groq → GROQ_API_KEY),
 * but that value is the platform's secret, not a key for the generated app.
 * tests/publicApis/catalog.test.ts keeps this in sync with PROVIDERS.
 */
export const PLATFORM_SECRET_NAMES: ReadonlySet<string> = new Set([
  'LLM_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'TOGETHER_API_KEY',
  'HUGGINGFACE_API_KEY',
  'GITHUB_TOKEN',
  'VERCEL_TOKEN',
  'AUTH_TOKEN',
  'SETTINGS_ENCRYPTION_KEY',
]);

export function isPlatformSecretName(name: string): boolean {
  return PLATFORM_SECRET_NAMES.has(name.trim().toUpperCase());
}

/**
 * The saved setting satisfying this API's key: VITE_X_API_KEY, or the bare
 * X_API_KEY unless that name is one of the platform's own secrets.
 */
export function savedKeyName(
  api: Pick<PublicApi, 'authKind' | 'keyEnv'>,
  saved: ReadonlySet<string>
): string | null {
  if (!needsKey(api)) return null;
  const candidates = [api.keyEnv, api.keyEnv.replace(/^VITE_/, '')];
  return candidates.find((name) => saved.has(name) && !isPlatformSecretName(name)) ?? null;
}

/** A saved name without the VITE_ prefix: Vite keeps it out of the browser, so it must stay server-side. */
export function isServerSideKeyName(name: string | undefined): name is string {
  return typeof name === 'string' && name !== '' && !/^VITE_/i.test(name);
}

export function isKeySaved(api: Pick<PublicApi, 'authKind' | 'keyEnv'>, saved: ReadonlySet<string>): boolean {
  return savedKeyName(api, saved) !== null;
}

export function withKeyStatus(api: PublicApi, saved: ReadonlySet<string>): PublicApiWithKey {
  const savedAs = savedKeyName(api, saved);
  return savedAs ? { ...api, keySaved: true, keySavedAs: savedAs } : { ...api, keySaved: false };
}

// ─── Aggregates ─────────────────────────────────────────────────────────────

export function listCategories(apis: readonly PublicApi[], order: 'name' | 'count' = 'name'): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const api of apis) counts.set(api.category, (counts.get(api.category) ?? 0) + 1);
  const byName = (a: CategoryCount, b: CategoryCount) => a.name.localeCompare(b.name, 'en');
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    order === 'count' ? (a, b) => b.count - a.count || byName(a, b) : byName
  );
}

export function computeStats(apis: readonly PublicApi[], saved: ReadonlySet<string>): CatalogStats {
  const stats: CatalogStats = {
    total: apis.length,
    noKey: 0,
    apiKey: 0,
    oauth: 0,
    other: 0,
    savedKeys: 0,
    savedKeysUnlocking: 0,
  };
  const matchedNames = new Set<string>();
  for (const api of apis) {
    if (api.authKind === 'none') stats.noKey++;
    else if (api.authKind === 'apiKey') stats.apiKey++;
    else if (api.authKind === 'oauth') stats.oauth++;
    else stats.other++;
    const savedAs = savedKeyName(api, saved);
    if (savedAs) {
      stats.savedKeysUnlocking++;
      matchedNames.add(savedAs);
    }
  }
  stats.savedKeys = matchedNames.size;
  return stats;
}

// ─── Filter / search / paginate ─────────────────────────────────────────────

export interface CatalogQuery {
  /** Matched against name, description and category; every word must match. */
  search?: string;
  category?: string;
  auth?: AuthKind | 'any';
  httpsOnly?: boolean;
  cors?: CorsSupport | 'any';
  offset?: number;
  limit?: number;
}

export interface CatalogPage<T> {
  total: number;
  offset: number;
  limit: number;
  entries: T[];
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

interface Folded {
  name: string;
  category: string;
  haystack: string;
}

const foldCache = new WeakMap<PublicApi, Folded>();

function folded(api: PublicApi): Folded {
  let f = foldCache.get(api);
  if (!f) {
    const name = foldText(api.name);
    const category = foldText(api.category);
    f = { name, category, haystack: `${name} ${foldText(api.description)} ${category}` };
    foldCache.set(api, f);
  }
  return f;
}

// Lower is more relevant: exact name, name prefix, name contains, all words in
// name, category contains, anything else (description).
function relevance(f: Folded, phrase: string, terms: string[]): number {
  if (f.name === phrase) return 0;
  if (f.name.startsWith(phrase)) return 1;
  if (f.name.includes(phrase)) return 2;
  if (terms.every((t) => f.name.includes(t))) return 3;
  if (f.category.includes(phrase)) return 4;
  return 5;
}

/**
 * Filters, then orders by search relevance (when searching) and catalog order,
 * so the same query always yields the same pages.
 */
export function queryCatalog(apis: readonly PublicApi[], query: CatalogQuery = {}): CatalogPage<PublicApi> {
  const limit = clampInt(query.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const phrase = foldText((query.search ?? '').slice(0, MAX_SEARCH_LENGTH)).replace(/\s+/g, ' ').trim();
  const terms = phrase ? phrase.split(' ') : [];
  const category = query.category?.trim().toLowerCase();
  const auth = query.auth && query.auth !== 'any' ? query.auth : null;
  const cors = query.cors && query.cors !== 'any' ? query.cors : null;

  const matches: { api: PublicApi; index: number; score: number }[] = [];
  apis.forEach((api, index) => {
    if (category && api.category.toLowerCase() !== category) return;
    if (auth && api.authKind !== auth) return;
    if (query.httpsOnly && !api.https) return;
    if (cors && api.cors !== cors) return;
    if (terms.length) {
      const f = folded(api);
      if (!terms.every((t) => f.haystack.includes(t))) return;
      matches.push({ api, index, score: relevance(f, phrase, terms) });
    } else {
      matches.push({ api, index, score: 0 });
    }
  });
  matches.sort((a, b) => a.score - b.score || a.index - b.index);

  const total = matches.length;
  const offset = Math.min(clampInt(query.offset, 0, MAX_OFFSET, 0), total);
  return {
    total,
    offset,
    limit,
    entries: matches.slice(offset, offset + limit).map((m) => m.api),
  };
}

// ─── Query-string parsing (route input validation) ─────────────────────────

export const BROWSE_PARAMS = ['search', 'category', 'auth', 'https', 'cors', 'offset', 'limit'] as const;

export function hasBrowseParams(params: URLSearchParams): boolean {
  return BROWSE_PARAMS.some((name) => params.has(name));
}

const AUTH_PARAM = new Map<string, AuthKind | 'any'>([
  ['', 'any'],
  ['any', 'any'],
  ['all', 'any'],
  ['none', 'none'],
  ['no', 'none'],
  ['apikey', 'apiKey'],
  ['key', 'apiKey'],
  ['oauth', 'oauth'],
  ['other', 'other'],
]);

const CORS_PARAM = new Map<string, CorsSupport | 'any'>([
  ['', 'any'],
  ['any', 'any'],
  ['yes', 'yes'],
  ['no', 'no'],
  ['unknown', 'unknown'],
]);

const HTTPS_PARAM = new Map<string, boolean>([
  ['', false],
  ['any', false],
  ['0', false],
  ['false', false],
  ['no', false],
  ['1', true],
  ['true', true],
  ['yes', true],
  ['only', true],
]);

export type ParsedCatalogQuery = { ok: true; query: CatalogQuery } | { ok: false; error: string };

/**
 * Validates browse parameters. Enumerations must be known values (400 on
 * anything else); offset/limit are clamped; search is trimmed and capped.
 */
export function parseCatalogParams(params: URLSearchParams, categories: readonly string[]): ParsedCatalogQuery {
  const search = clean(params.get('search') ?? '').slice(0, MAX_SEARCH_LENGTH);

  let category: string | undefined;
  const rawCategory = clean(params.get('category') ?? '');
  if (rawCategory && rawCategory.toLowerCase() !== 'all') {
    category = categories.find((c) => c.toLowerCase() === rawCategory.toLowerCase());
    if (!category) return { ok: false, error: 'Unknown category' };
  }

  const auth = AUTH_PARAM.get((params.get('auth') ?? '').trim().toLowerCase());
  if (!auth) return { ok: false, error: 'auth must be one of any, none, apiKey, oauth, other' };

  const cors = CORS_PARAM.get((params.get('cors') ?? '').trim().toLowerCase());
  if (!cors) return { ok: false, error: 'cors must be one of any, yes, no, unknown' };

  const httpsOnly = HTTPS_PARAM.get((params.get('https') ?? '').trim().toLowerCase());
  if (httpsOnly === undefined) return { ok: false, error: 'https must be a boolean' };

  return {
    ok: true,
    query: {
      search: search || undefined,
      category,
      auth,
      httpsOnly,
      cors,
      offset: clampInt(params.get('offset'), 0, MAX_OFFSET, 0),
      limit: clampInt(params.get('limit'), 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    },
  };
}
