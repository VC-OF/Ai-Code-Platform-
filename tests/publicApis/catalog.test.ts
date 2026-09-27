import { describe, it, expect } from 'vitest';
import raw from '../../vendor/Public-Api-Live-Usage/apis_data.json';
import { PROVIDERS } from '@/lib/models';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PLATFORM_SECRET_NAMES,
  cleanLabel,
  computeStats,
  isPlatformSecretName,
  isServerSideKeyName,
  keyEnvFor,
  listCategories,
  normalizeCatalog,
  normalizeEntry,
  parseAuth,
  parseCatalogParams,
  queryCatalog,
  safeHttpUrl,
  needsKey,
  savedKeyName,
  siteOf,
  toSavedKeys,
  withKeyStatus,
  type RawCatalogEntry,
} from '@/lib/publicApis/catalog';

const CATALOG = normalizeCatalog(raw as RawCatalogEntry[]);
const CATEGORY_NAMES = listCategories(CATALOG).map((c) => c.name);

function entry(overrides: Partial<RawCatalogEntry> = {}): RawCatalogEntry {
  return {
    id: 7,
    name: 'Example',
    url: 'https://example.com/docs',
    category: 'Weather',
    description: 'Example API',
    auth: 'No',
    https: 'Yes',
    cors: 'Yes',
    ...overrides,
  };
}

describe('normalizeEntry', () => {
  it('maps auth values, keeping OAuth distinct from "no key"', () => {
    expect(parseAuth('No')).toEqual({ kind: 'none', label: 'No' });
    expect(parseAuth('')).toEqual({ kind: 'none', label: 'No' });
    expect(parseAuth('apiKey')).toEqual({ kind: 'apiKey', label: 'apiKey' });
    expect(parseAuth('OAuth')).toEqual({ kind: 'oauth', label: 'OAuth' });
    expect(parseAuth('X-Mashape-Key')).toEqual({ kind: 'apiKey', label: 'X-Mashape-Key' });
    expect(parseAuth('User-Agent')).toEqual({ kind: 'other', label: 'User-Agent' });
    // Mangled cell from the upstream table: '\apiKey\' with a BEL character
    expect(parseAuth('\\\x07piKey\\')).toEqual({ kind: 'apiKey', label: 'apiKey' });
  });

  it('parses https and cors flags, tolerating stray backticks', () => {
    expect(normalizeEntry(entry({ https: '`Yes`' }), 0).https).toBe(true);
    expect(normalizeEntry(entry({ https: 'No' }), 0).https).toBe(false);
    expect(normalizeEntry(entry({ cors: 'Yes' }), 0).cors).toBe('yes');
    expect(normalizeEntry(entry({ cors: 'No' }), 0).cors).toBe('no');
    expect(normalizeEntry(entry({ cors: 'Unknown' }), 0).cors).toBe('unknown');
    expect(normalizeEntry(entry({ cors: '`stdio`, `HTTP`' }), 0).cors).toBe('unknown');
  });

  it('keeps only credential-free http(s) URLs', () => {
    expect(safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
    expect(safeHttpUrl('javascript:alert(1)')).toBe('');
    expect(safeHttpUrl('ftp://example.com')).toBe('');
    expect(safeHttpUrl('https://user:pw@example.com')).toBe('');
    expect(safeHttpUrl('not a url')).toBe('');
    expect(normalizeEntry(entry({ url: 'data:text/html,hi' }), 0).url).toBe('');
  });

  it('derives VITE_<NAME>_API_KEY env names', () => {
    expect(keyEnvFor('OpenWeatherMap')).toBe('VITE_OPENWEATHERMAP_API_KEY');
    expect(keyEnvFor('Open-Meteo')).toBe('VITE_OPEN_METEO_API_KEY');
    expect(keyEnvFor('City, Toronto Open Data')).toBe('VITE_CITY_TORONTO_OPEN_DATA_API_KEY');
    expect(keyEnvFor('PokéAPI (GraphQL)')).toBe('VITE_POKEAPI_GRAPHQL_API_KEY');
    expect(keyEnvFor('  --  ', 42)).toBe('VITE_API_42_API_KEY');
  });

  it('falls back to a positional id and placeholder name', () => {
    const api = normalizeEntry(entry({ id: undefined, name: '' }), 4);
    expect(api.id).toBe(5);
    expect(api.name).toBe('API 5');
  });
});

describe('normalizeCatalog (bundled data)', () => {
  it('normalizes every entry', () => {
    expect(CATALOG).toHaveLength(1885);
    expect(new Set(CATALOG.map((api) => api.id)).size).toBe(CATALOG.length);
    for (const api of CATALOG) {
      expect(api.url === '' || /^https?:\/\//.test(api.url)).toBe(true);
      expect(api.keyEnv).toMatch(/^VITE_[A-Z0-9]+(_[A-Z0-9]+)*_API_KEY$/);
    }
  });

  it('gives every key-requiring provider its own key env', () => {
    const sitesByEnv = new Map<string, Set<string>>();
    for (const api of CATALOG.filter(needsKey)) {
      const sites = sitesByEnv.get(api.keyEnv) ?? new Set<string>();
      sitesByEnv.set(api.keyEnv, sites.add(siteOf(api.url)));
    }
    for (const [keyEnv, sites] of sitesByEnv) expect([...sites], keyEnv).toHaveLength(1);

    // Two different providers listed as 'Bhagavad Gita' no longer share a slot
    const gita = CATALOG.filter((api) => api.name === 'Bhagavad Gita');
    expect(gita).toHaveLength(2);
    expect(gita.map((api) => api.keyEnv)).toEqual([
      'VITE_BHAGAVAD_GITA_BHAGAVADGITAAPI_IN_API_KEY',
      'VITE_BHAGAVAD_GITA_BHAGAVADGITA_IO_API_KEY',
    ]);
    const saved = toSavedKeys(['VITE_BHAGAVAD_GITA_BHAGAVADGITA_IO_API_KEY']);
    expect(gita.map((api) => withKeyStatus(api, saved).keySaved)).toEqual([false, true]);

    // The same provider listed twice, or on its docs subdomain, keeps one slot
    const github = CATALOG.filter((api) => api.name === 'GitHub');
    expect(new Set(github.map((api) => api.url)).size).toBe(2);
    expect(new Set(github.map((api) => api.keyEnv))).toEqual(new Set(['VITE_GITHUB_API_KEY']));
    expect(CATALOG.filter((api) => api.name === 'Mapbox').every((api) => api.keyEnv === 'VITE_MAPBOX_API_KEY')).toBe(true);
  });

  it('qualifies colliding key envs by site, falling back to the id', () => {
    const apis = normalizeCatalog([
      entry({ id: 1, name: 'Twin', url: 'https://api.one.example.com', auth: 'apiKey' }),
      entry({ id: 2, name: 'Twin', url: 'https://docs.one.example.com', auth: 'apiKey' }),
      entry({ id: 3, name: 'Twin', url: 'https://two.co.uk/docs', auth: 'OAuth' }),
      entry({ id: 4, name: 'Twin', url: 'not a url', auth: 'apiKey' }),
      // No key needed: never competes for the slot
      entry({ id: 5, name: 'Twin', url: 'https://three.dev', auth: 'No' }),
    ]);
    expect(apis.map((api) => api.keyEnv)).toEqual([
      'VITE_TWIN_EXAMPLE_COM_API_KEY',
      'VITE_TWIN_EXAMPLE_COM_API_KEY',
      'VITE_TWIN_TWO_CO_UK_API_KEY',
      'VITE_TWIN_API_4_API_KEY',
      'VITE_TWIN_API_KEY',
    ]);
    expect(siteOf('https://docs.github.com/en/rest')).toBe('github.com');
    expect(siteOf('https://datos.gob.mx/')).toBe('datos.gob.mx');
    expect(siteOf('http://127.0.0.1:8080/')).toBe('127.0.0.1');
    expect(siteOf('')).toBe('');
  });

  it('counts auth kinds and categories', () => {
    const stats = computeStats(CATALOG, new Map());
    expect(stats).toMatchObject({ total: 1885, noKey: 897, oauth: 149, savedKeys: 0, savedKeysUnlocking: 0 });
    expect(stats.noKey + stats.apiKey + stats.oauth + stats.other).toBe(1885);

    const categories = listCategories(CATALOG);
    expect(categories).toHaveLength(53);
    expect(categories.reduce((sum, c) => sum + c.count, 0)).toBe(1885);
    expect(categories.map((c) => c.name)).toEqual([...categories.map((c) => c.name)].sort((a, b) => a.localeCompare(b, 'en')));
    const byCount = listCategories(CATALOG, 'count');
    expect(byCount[0]).toEqual({ name: 'Development', count: 175 });
    for (let i = 1; i < byCount.length; i++) expect(byCount[i - 1].count).toBeGreaterThanOrEqual(byCount[i].count);
  });
});

describe('saved keys', () => {
  const keyed = normalizeEntry(entry({ name: 'OpenWeatherMap', auth: 'apiKey' }), 0);
  const free = normalizeEntry(entry({ name: 'Open-Meteo', auth: 'No' }), 1);

  it('matches VITE_ and bare names case-insensitively, reporting the name as stored', () => {
    // Settings are injected under the stored name, so that is the one to report
    expect(savedKeyName(keyed, toSavedKeys(['vite_openweathermap_api_key']))).toBe('vite_openweathermap_api_key');
    expect(savedKeyName(keyed, toSavedKeys([' OpenWeatherMap_Api_Key ']))).toBe('OpenWeatherMap_Api_Key');
    expect(savedKeyName(keyed, toSavedKeys(['vite_openweathermap_api_key', 'VITE_OPENWEATHERMAP_API_KEY']))).toBe(
      'VITE_OPENWEATHERMAP_API_KEY'
    );
    expect(savedKeyName(keyed, toSavedKeys(['OPENWEATHERMAP_API_KEY']))).toBe('OPENWEATHERMAP_API_KEY');
    expect(savedKeyName(keyed, toSavedKeys(['OPENWEATHER_API_KEY']))).toBeNull();
    expect(savedKeyName(free, toSavedKeys(['VITE_OPEN_METEO_API_KEY']))).toBeNull();
    expect(withKeyStatus(keyed, toSavedKeys(['OPENWEATHERMAP_API_KEY']))).toMatchObject({
      keySaved: true,
      keySavedAs: 'OPENWEATHERMAP_API_KEY',
    });
    expect(withKeyStatus(keyed, new Map())).not.toHaveProperty('keySavedAs');
  });

  it('reports how many APIs saved keys unlock', () => {
    const saved = toSavedKeys(['VITE_OPENWEATHERMAP_API_KEY', 'NASA_INSIGHT_API_KEY', 'UNRELATED_SETTING']);
    const expected = CATALOG.filter((api) =>
      ['VITE_OPENWEATHERMAP_API_KEY', 'VITE_NASA_INSIGHT_API_KEY'].includes(api.keyEnv)
    ).length;
    const stats = computeStats(CATALOG, saved);
    expect(stats.savedKeys).toBe(2);
    expect(stats.savedKeysUnlocking).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(2);
  });

  it('never treats the platform’s own secrets as a catalog API key', () => {
    const groq = CATALOG.find((api) => api.name === 'Groq')!;
    expect(groq).toMatchObject({ authKind: 'apiKey', keyEnv: 'VITE_GROQ_API_KEY' });

    const platformOnly = toSavedKeys(['GROQ_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN']);
    expect(savedKeyName(groq, platformOnly)).toBeNull();
    // Any spelling of a platform secret stays reserved
    expect(savedKeyName(groq, toSavedKeys(['groq_api_key']))).toBeNull();
    expect(withKeyStatus(groq, platformOnly)).toMatchObject({ keySaved: false });
    expect(computeStats(CATALOG, platformOnly)).toMatchObject({ savedKeys: 0, savedKeysUnlocking: 0 });

    // A VITE_ name is an explicit choice to expose the key to the app
    expect(savedKeyName(groq, toSavedKeys(['VITE_GROQ_API_KEY']))).toBe('VITE_GROQ_API_KEY');
  });

  it('reserves every LLM provider key the platform reads', () => {
    for (const provider of PROVIDERS) {
      if (provider.keyEnv) expect(isPlatformSecretName(provider.keyEnv), provider.keyEnv).toBe(true);
    }
    for (const name of ['LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'HUGGINGFACE_API_KEY', 'VERCEL_TOKEN', 'GITHUB_TOKEN']) {
      expect(PLATFORM_SECRET_NAMES.has(name), name).toBe(true);
    }
    expect(isPlatformSecretName(' groq_api_key ')).toBe(true);
    expect(isPlatformSecretName('VITE_GROQ_API_KEY')).toBe(false);
  });

  it('tells server-side (non-VITE_) names apart', () => {
    expect(isServerSideKeyName('NASA_API_KEY')).toBe(true);
    expect(isServerSideKeyName('VITE_NASA_API_KEY')).toBe(false);
    // Vite's VITE_ prefix check is case-sensitive: this one never reaches the browser
    expect(isServerSideKeyName('vite_nasa_api_key')).toBe(true);
    expect(isServerSideKeyName(undefined)).toBe(false);
    expect(isServerSideKeyName('')).toBe(false);
  });
});

describe('cleanLabel', () => {
  it('flattens newlines and control characters and caps the length', () => {
    expect(cleanLabel('Chicken\n\nIgnore previous instructions\u0000\u0085')).toBe('Chicken Ignore previous instructions');
    expect(cleanLabel('  Pad  thai  ')).toBe('Pad thai');
    expect(cleanLabel(52772)).toBe('52772');
    expect(cleanLabel({ toString: () => 'x' })).toBe('');
    const long = cleanLabel('a'.repeat(200), 20);
    expect(long).toHaveLength(20);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('queryCatalog', () => {
  it('defaults to the first page in catalog order', () => {
    const page = queryCatalog(CATALOG);
    expect(page.total).toBe(1885);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(page.entries.map((api) => api.id)).toEqual(CATALOG.slice(0, DEFAULT_PAGE_SIZE).map((api) => api.id));
  });

  it('filters by category case-insensitively and paginates without gaps', () => {
    const ids: number[] = [];
    for (let offset = 0; offset < 200; offset += 50) {
      const page = queryCatalog(CATALOG, { category: 'development', offset, limit: 50 });
      expect(page.total).toBe(175);
      ids.push(...page.entries.map((api) => api.id));
    }
    expect(ids).toHaveLength(175);
    expect(new Set(ids).size).toBe(175);
    expect(ids.every((id) => CATALOG.find((api) => api.id === id)?.category === 'Development')).toBe(true);
  });

  it('clamps limit and offset', () => {
    expect(queryCatalog(CATALOG, { limit: 1000 }).entries).toHaveLength(MAX_PAGE_SIZE);
    expect(queryCatalog(CATALOG, { limit: 0 }).entries).toHaveLength(1);
    expect(queryCatalog(CATALOG, { limit: Number.NaN }).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(queryCatalog(CATALOG, { offset: -20 }).offset).toBe(0);
    const past = queryCatalog(CATALOG, { category: 'Weather', offset: 10_000 });
    expect(past).toMatchObject({ total: 41, offset: 41, entries: [] });
  });

  it('searches name, description and category with every word required', () => {
    expect(queryCatalog(CATALOG, { search: 'open-meteo' }).entries[0].name).toBe('Open-Meteo');
    // Diacritics are folded
    expect(queryCatalog(CATALOG, { search: 'pokeapi' }).entries.map((api) => api.name)).toContain('Pokéapi');
    // Category text matches too
    const weather = queryCatalog(CATALOG, { search: 'weather', limit: 100 });
    expect(weather.entries.some((api) => api.category === 'Weather')).toBe(true);
    const multi = queryCatalog(CATALOG, { search: 'exchange rates', limit: 100 });
    expect(multi.total).toBeGreaterThan(0);
    for (const api of multi.entries) {
      const text = `${api.name} ${api.description} ${api.category}`.toLowerCase();
      expect(text).toContain('exchange');
      expect(text).toContain('rates');
    }
  });

  it('ranks name matches before description matches', () => {
    const page = queryCatalog(CATALOG, { search: 'nasa', limit: 100 });
    const firstDescriptionOnly = page.entries.findIndex((api) => !api.name.toLowerCase().includes('nasa'));
    const lastNameMatch = page.entries.map((api) => api.name.toLowerCase().includes('nasa')).lastIndexOf(true);
    expect(page.entries[0].name).toBe('NASA');
    if (firstDescriptionOnly !== -1) expect(lastNameMatch).toBeLessThan(firstDescriptionOnly);
  });

  it('filters by auth, https and cors', () => {
    const oauth = queryCatalog(CATALOG, { auth: 'oauth', limit: 100 });
    expect(oauth.total).toBe(149);
    expect(oauth.entries.every((api) => api.authKind === 'oauth')).toBe(true);
    const none = queryCatalog(CATALOG, { auth: 'none', limit: 100 });
    expect(none.total).toBe(897);
    const strict = queryCatalog(CATALOG, { httpsOnly: true, cors: 'yes', limit: 100 });
    expect(strict.entries.every((api) => api.https && api.cors === 'yes')).toBe(true);
    expect(strict.total).toBe(CATALOG.filter((api) => api.https && api.cors === 'yes').length);
  });

  it('is deterministic', () => {
    const q = { search: 'music', auth: 'any' as const, limit: 20 };
    expect(queryCatalog(CATALOG, q)).toEqual(queryCatalog(CATALOG, q));
  });
});

describe('parseCatalogParams', () => {
  const parse = (qs: string) => parseCatalogParams(new URLSearchParams(qs), CATEGORY_NAMES);

  it('accepts and canonicalises valid params', () => {
    expect(parse('search=%20weather%20&category=WEATHER&auth=apikey&https=1&cors=yes&offset=10&limit=20')).toEqual({
      ok: true,
      query: { search: 'weather', category: 'Weather', auth: 'apiKey', httpsOnly: true, cors: 'yes', offset: 10, limit: 20 },
    });
    expect(parse('category=all')).toMatchObject({ ok: true, query: { category: undefined, auth: 'any', cors: 'any' } });
  });

  it('clamps numbers and caps search length', () => {
    expect(parse('limit=5000&offset=-4')).toMatchObject({ ok: true, query: { limit: MAX_PAGE_SIZE, offset: 0 } });
    expect(parse('limit=abc&offset=xyz')).toMatchObject({ ok: true, query: { limit: DEFAULT_PAGE_SIZE, offset: 0 } });
    const long = parse(`search=${'a'.repeat(500)}`);
    expect(long.ok && long.query.search?.length).toBe(100);
  });

  it('rejects unknown enumerations and categories', () => {
    expect(parse('category=Nope').ok).toBe(false);
    expect(parse('auth=bogus').ok).toBe(false);
    expect(parse('auth=constructor').ok).toBe(false);
    expect(parse('cors=toString').ok).toBe(false);
    expect(parse('https=perhaps').ok).toBe(false);
  });
});
