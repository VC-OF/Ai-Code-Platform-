import { describe, it, expect } from 'vitest';
import raw from '../../vendor/Public-Api-Live-Usage/apis_data.json';
import {
  listCategories,
  normalizeCatalog,
  normalizeEntry,
  toSavedKeySet,
  type PublicApi,
  type RawCatalogEntry,
} from '@/lib/publicApis/catalog';
import {
  IDEA_BLUEPRINTS,
  rankApis,
  resolveIdea,
  resolveIdeas,
  type IdeaBlueprint,
} from '@/lib/publicApis/ideas';

const CATALOG = normalizeCatalog(raw as RawCatalogEntry[]);
const CATEGORY_NAMES = new Set(listCategories(CATALOG).map((c) => c.name));

let nextId = 1;
function api(overrides: Partial<RawCatalogEntry>): PublicApi {
  const id = nextId++;
  return normalizeEntry(
    { id, name: `API ${id}`, url: 'https://example.com', category: 'Weather', description: '', auth: 'No', https: 'Yes', cors: 'Yes', ...overrides },
    id - 1
  );
}

function blueprint(overrides: Partial<IdeaBlueprint> = {}): IdeaBlueprint {
  return {
    id: 'test',
    title: 'Test idea',
    pitch: 'A test idea.',
    categories: ['Weather'],
    features: ['One', 'Two', 'Three'],
    audience: 'Testers',
    ...overrides,
  };
}

describe('IDEA_BLUEPRINTS', () => {
  it('has about two dozen well-formed blueprints', () => {
    expect(IDEA_BLUEPRINTS.length).toBeGreaterThanOrEqual(20);
    expect(IDEA_BLUEPRINTS.length).toBeLessThanOrEqual(30);
    expect(new Set(IDEA_BLUEPRINTS.map((b) => b.id)).size).toBe(IDEA_BLUEPRINTS.length);
    for (const b of IDEA_BLUEPRINTS) {
      expect(b.title.trim()).not.toBe('');
      expect(b.audience.trim()).not.toBe('');
      expect(b.pitch).toMatch(/^[^.!?]+[.!?]$/);
      expect(b.features.length).toBeGreaterThanOrEqual(3);
      expect(b.features.length).toBeLessThanOrEqual(5);
      expect(b.categories.length).toBeGreaterThan(0);
      expect(new Set(b.categories).size).toBe(b.categories.length);
    }
  });

  it('only uses real catalog categories and API names', () => {
    for (const b of IDEA_BLUEPRINTS) {
      for (const category of b.categories) {
        expect(CATEGORY_NAMES.has(category), `${b.id}: unknown category "${category}"`).toBe(true);
      }
      for (const [category, names] of Object.entries(b.candidates ?? {})) {
        expect(b.categories, `${b.id}: shortlist for unused category "${category}"`).toContain(category);
        for (const name of names) {
          const found = CATALOG.some((a) => a.category === category && a.name === name);
          expect(found, `${b.id}: "${name}" is not in ${category}`).toBe(true);
        }
      }
    }
  });
});

describe('rankApis', () => {
  const zeta = api({ name: 'Zeta', auth: 'No', cors: 'Yes' });
  const alpha = api({ name: 'Alpha', auth: 'apiKey' });
  const beta = api({ name: 'Beta', auth: 'No', cors: 'Unknown' });
  const gamma = api({ name: 'Gamma', auth: 'apiKey' });
  const delta = api({ name: 'Delta', auth: 'OAuth' });
  const plainHttp = api({ name: 'Aardvark', auth: 'No', https: 'No', cors: 'Yes' });
  const all = [delta, gamma, beta, alpha, zeta, plainHttp];
  const names = (list: PublicApi[]) => list.map((a) => a.name);

  it('prefers no-key HTTPS+CORS, then no-key, then API keys, then OAuth', () => {
    expect(names(rankApis(all, new Set()))).toEqual(['Zeta', 'Beta', 'Aardvark', 'Alpha', 'Gamma', 'Delta']);
  });

  it('moves an API whose key is saved ahead of other no-key APIs', () => {
    const saved = toSavedKeySet(['VITE_GAMMA_API_KEY']);
    expect(names(rankApis(all, saved))).toEqual(['Zeta', 'Gamma', 'Beta', 'Aardvark', 'Alpha', 'Delta']);
  });

  it('breaks ties by shortlist position, then name, then id', () => {
    const b = api({ name: 'b-api' });
    const a = api({ name: 'a-api' });
    const aAgain = api({ name: 'a-api' });
    expect(rankApis([b, aAgain, a], new Set()).map((x) => x.id)).toEqual([a.id, aAgain.id, b.id]);
    expect(names(rankApis([a, b], new Set(), ['b-api']))).toEqual(['b-api', 'a-api']);
  });

  it('does not depend on input order', () => {
    const reversed = [...all].reverse();
    expect(names(rankApis(reversed, new Set()))).toEqual(names(rankApis(all, new Set())));
  });
});

describe('resolveIdea', () => {
  it('picks one API per category and dedupes across categories', () => {
    const shared = api({ name: 'Shared', category: 'Weather' });
    const sharedEnv = api({ name: 'Shared', category: 'Environment' });
    const other = api({ name: 'Other', category: 'Environment', cors: 'Unknown' });
    const idea = resolveIdea(blueprint({ categories: ['Weather', 'Environment'] }), [shared, sharedEnv, other]);
    expect(idea.apis.map((a) => `${a.category}:${a.name}`)).toEqual(['Weather:Shared', 'Environment:Other']);
    expect(idea.missingCategories).toEqual([]);
  });

  it('reports categories with no usable API', () => {
    const idea = resolveIdea(blueprint({ categories: ['Weather', 'Events'] }), [api({ category: 'Weather' })]);
    expect(idea.missingCategories).toEqual(['Events']);
    expect(idea.apis).toHaveLength(1);
  });

  it('falls back to the whole category when no shortlisted name exists', () => {
    const only = api({ name: 'Only', category: 'Weather' });
    const idea = resolveIdea(blueprint({ candidates: { Weather: ['Missing'] } }), [only]);
    expect(idea.apis[0].name).toBe('Only');
  });

  it('is ready when no keys are needed', () => {
    const idea = resolveIdea(blueprint(), [api({ category: 'Weather' })]);
    expect(idea).toMatchObject({ readiness: 'ready', neededKeys: [] });
    expect(idea.apis[0]).toMatchObject({ needsKey: false, keySaved: false });
  });

  it('needs keys for unsaved API-key and OAuth APIs until they are saved', () => {
    const catalog = [api({ name: 'Keyed', category: 'Weather', auth: 'apiKey' }), api({ name: 'Social', category: 'Social', auth: 'OAuth' })];
    const bp = blueprint({ categories: ['Weather', 'Social'] });

    const before = resolveIdea(bp, catalog);
    expect(before.readiness).toBe('needs-keys');
    expect(before.neededKeys).toEqual(['VITE_KEYED_API_KEY', 'VITE_SOCIAL_API_KEY']);

    const partial = resolveIdea(bp, catalog, ['KEYED_API_KEY']);
    expect(partial.neededKeys).toEqual(['VITE_SOCIAL_API_KEY']);
    expect(partial.apis[0]).toMatchObject({ keySaved: true, keySavedAs: 'KEYED_API_KEY' });

    const after = resolveIdea(bp, catalog, ['VITE_KEYED_API_KEY', 'vite_social_api_key']);
    expect(after).toMatchObject({ readiness: 'ready', neededKeys: [] });
  });

  it('lets a saved key for a non-shortlisted API unlock the idea', () => {
    const listed = api({ name: 'Listed', category: 'Weather', auth: 'apiKey' });
    const unlisted = api({ name: 'Unlisted', category: 'Weather', auth: 'apiKey' });
    const noise = api({ name: 'Noise', category: 'Weather', auth: 'No' });
    const bp = blueprint({ candidates: { Weather: ['Listed'] } });

    // Without saved keys the shortlist still decides, even over a no-key API
    expect(resolveIdea(bp, [noise, unlisted, listed]).apis[0].name).toBe('Listed');

    const unlocked = resolveIdea(bp, [noise, unlisted, listed], ['VITE_UNLISTED_API_KEY']);
    expect(unlocked.apis[0]).toMatchObject({ name: 'Unlisted', keySaved: true });
    expect(unlocked.readiness).toBe('ready');

    // A saved shortlisted key wins the tie over a saved unlisted one
    const both = resolveIdea(bp, [unlisted, listed], ['VITE_UNLISTED_API_KEY', 'LISTED_API_KEY']);
    expect(both.apis[0]).toMatchObject({ name: 'Listed', keySavedAs: 'LISTED_API_KEY' });
  });

  it('ignores platform secrets that share an API’s bare key name', () => {
    const groqLike = api({ name: 'Groq', category: 'Weather', auth: 'apiKey' });
    const idea = resolveIdea(blueprint(), [groqLike], ['GROQ_API_KEY']);
    expect(idea).toMatchObject({ readiness: 'needs-keys', neededKeys: ['VITE_GROQ_API_KEY'] });
    expect(idea.apis[0].keySaved).toBe(false);
  });
});

describe('resolveIdeas (bundled catalog)', () => {
  const ideas = resolveIdeas(CATALOG);

  it('resolves every blueprint category to a concrete API', () => {
    expect(ideas).toHaveLength(IDEA_BLUEPRINTS.length);
    for (const [i, idea] of ideas.entries()) {
      expect(idea.missingCategories, idea.id).toEqual([]);
      expect(idea.apis.map((a) => a.category)).toEqual(IDEA_BLUEPRINTS[i].categories);
      expect(new Set(idea.apis.map((a) => a.name.toLowerCase())).size).toBe(idea.apis.length);
    }
  });

  it('is deterministic regardless of catalog order', () => {
    const shuffled = [...CATALOG].sort((a, b) => ((a.id * 7919) % 1885) - ((b.id * 7919) % 1885));
    const picks = (list: typeof ideas) => list.map((idea) => idea.apis.map((a) => a.id));
    expect(picks(resolveIdeas(CATALOG))).toEqual(picks(ideas));
    expect(picks(resolveIdeas(shuffled))).toEqual(picks(ideas));
  });

  it('marks readiness consistently with the picked APIs', () => {
    for (const idea of ideas) {
      const needed = idea.apis.filter((a) => a.needsKey && !a.keySaved).map((a) => a.keyEnv);
      expect(idea.neededKeys).toEqual([...new Set(needed)]);
      expect(idea.readiness).toBe(needed.length ? 'needs-keys' : 'ready');
    }
    expect(ideas.some((idea) => idea.readiness === 'ready')).toBe(true);
    expect(ideas.some((idea) => idea.readiness === 'needs-keys')).toBe(true);
  });

  it('turns an idea ready once its keys are saved', () => {
    const needy = ideas.find((idea) => idea.readiness === 'needs-keys');
    expect(needy).toBeDefined();
    const resolved = resolveIdeas(CATALOG, needy!.neededKeys).find((idea) => idea.id === needy!.id);
    expect(resolved?.readiness).toBe('ready');
  });

  it('unlocks ideas with keys saved for APIs outside the curated shortlist', () => {
    const sports = (saved: string[]) => resolveIdeas(CATALOG, saved).find((idea) => idea.id === 'sports-tracker')!;
    expect(sports([]).readiness).toBe('needs-keys');
    // VITE_NEWS_API_KEY is also the News reader starter's key
    const withNews = sports(['VITE_NEWS_API_KEY']);
    expect(withNews.readiness).toBe('ready');
    expect(withNews.apis.find((a) => a.category === 'News')).toMatchObject({ name: 'News', keySaved: true });

    const finance = resolveIdeas(CATALOG, ['VITE_MARKETSTACK_API_KEY']).find((idea) => idea.id === 'finance-dashboard')!;
    expect(finance.readiness).toBe('ready');
    expect(finance.apis[0]).toMatchObject({ name: 'Marketstack', keySaved: true });
  });

  it('attaches documented demo keys', () => {
    const recipe = ideas.find((idea) => idea.id === 'recipe-planner');
    expect(recipe?.apis.find((a) => a.name === 'TheMealDB')?.demoKey).toBe('1');
  });
});
