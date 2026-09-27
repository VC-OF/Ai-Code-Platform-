import { describe, it, expect } from 'vitest';
import raw from '../../vendor/Public-Api-Live-Usage/apis_data.json';
import { normalizeCatalog, normalizeEntry, toSavedKeySet, withKeyStatus, type RawCatalogEntry } from '@/lib/publicApis/catalog';
import { resolveIdeas } from '@/lib/publicApis/ideas';
import { PRODUCT_RECIPES } from '@/lib/publicApis/recipes';
import {
  buildProductPrompt,
  collectSpecKeys,
  createBuildSpec,
  keyInputsFor,
  targetFromApi,
  targetFromIdea,
  targetFromRecipe,
} from '@/lib/publicApis/buildSpec';

const CATALOG = normalizeCatalog(raw as RawCatalogEntry[]);

function catalogApi(overrides: Partial<RawCatalogEntry>, saved: string[] = []) {
  const api = normalizeEntry(
    { id: 1, name: 'Example', url: 'https://example.com/docs', category: 'Weather', description: 'Forecasts', auth: 'No', https: 'Yes', cors: 'Yes', ...overrides },
    0
  );
  return withKeyStatus(api, toSavedKeySet(saved));
}

describe('multi-API idea builds', () => {
  const ideas = resolveIdeas(CATALOG, ['VITE_ETHERSCAN_API_KEY']);
  const idea = ideas.find((i) => i.id === 'event-planner')!;
  const target = targetFromIdea(idea);

  it('lists every API with docs, auth and env var in the prompt', () => {
    const spec = createBuildSpec(target, { title: 'My planner', keyValues: {} });
    expect(spec.title).toBe('My planner');
    expect(spec.apis).toHaveLength(idea.apis.length);
    expect(spec.prompt).toContain('"My planner"');
    expect(spec.prompt).toContain(idea.pitch);
    for (const feature of idea.features) expect(spec.prompt).toContain(feature);
    for (const api of idea.apis) {
      expect(spec.prompt).toContain(api.name);
      if (api.url) expect(spec.prompt).toContain(api.url);
      if (api.needsKey) expect(spec.prompt).toContain(`import.meta.env.${api.keyEnv}`);
    }
    expect(spec.prompt).toMatch(/Auth: none/);
    expect(spec.prompt).toMatch(/Auth: API key/);
  });

  it('saves each provided key but never puts key values in the prompt', () => {
    const [keyed] = keyInputsFor(target);
    const spec = createBuildSpec(target, { title: '', keyValues: { [keyed.keyEnv]: '  tm-secret-123  ' } });
    expect(spec.title).toBe(target.title);
    expect(spec.keys).toEqual([{ keyEnv: keyed.keyEnv, value: 'tm-secret-123' }]);
    expect(spec.prompt).not.toContain('tm-secret-123');
    expect(spec.prompt).toContain(`saved in this project's settings as ${keyed.keyEnv}`);
  });

  it('asks for one input per distinct key and says when a key is already saved', () => {
    const crypto = targetFromIdea(ideas.find((i) => i.id === 'crypto-portfolio')!);
    const inputs = keyInputsFor(crypto);
    expect(inputs.map((a) => a.keyEnv)).toEqual(['VITE_ETHERSCAN_API_KEY']);
    expect(inputs[0].keySaved).toBe(true);
    expect(buildProductPrompt(crypto, 'x')).toContain('already saved in global settings as VITE_ETHERSCAN_API_KEY');
  });

  it('carries demo keys for prefill', () => {
    const recipe = targetFromIdea(ideas.find((i) => i.id === 'recipe-planner')!);
    expect(keyInputsFor(recipe).map((a) => [a.name, a.demoKey])).toEqual([
      ['TheMealDB', '1'],
      ['FoodData Central', 'DEMO_KEY'],
    ]);
  });
});

describe('single-API builds', () => {
  it('builds a no-key API without key inputs', () => {
    const target = targetFromApi(catalogApi({ name: 'Open-Meteo' }));
    expect(keyInputsFor(target)).toEqual([]);
    const spec = createBuildSpec(target, { title: 'Weather' });
    expect(spec.keys).toEqual([]);
    expect(spec.prompt).toContain('Auth: none');
    expect(spec.prompt).toContain('CORS: enabled');
    expect(spec.prompt).not.toContain('import.meta.env');
  });

  it('explains proxies for HTTP-only and non-CORS APIs', () => {
    expect(buildProductPrompt(targetFromApi(catalogApi({ https: 'No' })), 't')).toContain('plain HTTP only');
    expect(buildProductPrompt(targetFromApi(catalogApi({ cors: 'No' })), 't')).toContain('CORS: not enabled');
    expect(buildProductPrompt(targetFromApi(catalogApi({ cors: 'Unknown' })), 't')).toContain('CORS: unknown');
  });

  it('keeps a key saved without the VITE_ prefix server-side, behind a dev-server proxy', () => {
    const target = targetFromApi(catalogApi({ name: 'Weatherbit', auth: 'apiKey' }, ['WEATHERBIT_API_KEY']));
    const prompt = buildProductPrompt(target, 't');
    expect(prompt).toContain('saved in global settings as WEATHERBIT_API_KEY');
    expect(prompt).toContain('Vite dev-server proxy');
    expect(prompt).toContain('process.env.WEATHERBIT_API_KEY');
    expect(prompt).toContain('Never copy it into a VITE_ variable');
    expect(prompt).not.toMatch(/map it to/i);
    expect(prompt).not.toContain('import.meta.env.VITE_WEATHERBIT_API_KEY');
    expect(prompt).toContain('never expose a server-side key to the browser');

    // A key typed into the modal is saved as the VITE_ variable and wins
    const provided = buildProductPrompt(target, 't', ['VITE_WEATHERBIT_API_KEY']);
    expect(provided).toContain('import.meta.env.VITE_WEATHERBIT_API_KEY');
    expect(provided).not.toContain('process.env.WEATHERBIT_API_KEY');
  });

  it('never points the app at the platform’s own LLM key', () => {
    const groq = CATALOG.find((api) => api.name === 'Groq')!;
    const target = targetFromApi(withKeyStatus(groq, toSavedKeySet(['GROQ_API_KEY'])));
    expect(target.apis[0]).toMatchObject({ keyEnv: 'VITE_GROQ_API_KEY', keySaved: false });
    const prompt = buildProductPrompt(target, 't');
    expect(prompt.replaceAll('VITE_GROQ_API_KEY', '')).not.toContain('GROQ_API_KEY');
    expect(prompt).toContain('it has not been provided yet (the user can add VITE_GROQ_API_KEY in Settings)');
  });

  it('keeps OAuth distinct from "no key"', () => {
    const target = targetFromApi(catalogApi({ name: 'Spotify', auth: 'OAuth' }));
    expect(target.apis[0]).toMatchObject({ authKind: 'oauth', keyEnv: 'VITE_SPOTIFY_API_KEY' });
    expect(buildProductPrompt(target, 't')).toContain('Auth: OAuth');

    const recipe = targetFromRecipe({ ...PRODUCT_RECIPES[0], auth: 'OAuth', keyEnv: undefined });
    expect(recipe.apis[0].authKind).toBe('oauth');
    expect(recipe.apis[0].keyEnv).toBe('VITE_LOREM_PICSUM_API_KEY');
  });

  it('converts starter recipes, including demo keys', () => {
    const nasa = PRODUCT_RECIPES.find((r) => r.api === 'NASA Open APIs')!;
    const target = targetFromRecipe({ ...nasa, keySaved: false });
    expect(target.apis[0]).toMatchObject({ authKind: 'apiKey', keyEnv: 'VITE_NASA_API_KEY', demoKey: 'DEMO_KEY' });
    const spec = createBuildSpec(target, { title: 'Space', keyValues: { VITE_NASA_API_KEY: 'DEMO_KEY' } });
    expect(spec.keys).toEqual([{ keyEnv: 'VITE_NASA_API_KEY', value: 'DEMO_KEY' }]);
    expect(spec.keyEnv).toBe('VITE_NASA_API_KEY');
    expect(spec.endpoint).toBe(nasa.endpoint);
    for (const sample of nasa.sampleEndpoints ?? []) expect(spec.prompt).toContain(sample);
  });

  it('names the setting a starter key was actually saved under', () => {
    const nasa = PRODUCT_RECIPES.find((r) => r.api === 'NASA Open APIs')!;
    const bare = targetFromRecipe({ ...nasa, keySaved: true, keySavedAs: 'NASA_API_KEY' });
    expect(bare.apis[0]).toMatchObject({ keySaved: true, keySavedAs: 'NASA_API_KEY', keyEnv: 'VITE_NASA_API_KEY' });
    const prompt = buildProductPrompt(bare, 't');
    expect(prompt).toContain('saved in global settings as NASA_API_KEY');
    expect(prompt).toContain('process.env.NASA_API_KEY');
    expect(prompt).not.toContain('saved in global settings as VITE_NASA_API_KEY');

    const prefixed = targetFromRecipe({ ...nasa, keySaved: true, keySavedAs: 'VITE_NASA_API_KEY' });
    expect(buildProductPrompt(prefixed, 't')).toContain(
      'Read it from import.meta.env.VITE_NASA_API_KEY; it is already saved in global settings as VITE_NASA_API_KEY'
    );

    // keySavedAs only counts when the key is reported as saved
    expect(targetFromRecipe({ ...nasa, keySaved: false, keySavedAs: 'NASA_API_KEY' }).apis[0].keySavedAs).toBeUndefined();
  });

  it('keeps a bare-named OAuth credential server-side too', () => {
    const target = targetFromApi(catalogApi({ name: 'Spotify', auth: 'OAuth' }, ['SPOTIFY_API_KEY']));
    const prompt = buildProductPrompt(target, 't');
    expect(prompt).toContain('Auth: OAuth');
    expect(prompt).toContain('process.env.SPOTIFY_API_KEY');
    expect(prompt).not.toContain('import.meta.env.VITE_SPOTIFY_API_KEY');
  });
});

describe('collectSpecKeys', () => {
  it('supports the legacy single apiKey field', () => {
    expect(collectSpecKeys({ apiKey: ' abc ' })).toEqual([{ keyEnv: 'VITE_API_KEY', value: 'abc' }]);
    expect(collectSpecKeys({ apiKey: 'abc', keyEnv: 'VITE_NASA_API_KEY' })).toEqual([{ keyEnv: 'VITE_NASA_API_KEY', value: 'abc' }]);
    expect(collectSpecKeys({ apiKey: '   ' })).toEqual([]);
  });

  it('merges keys, dedupes by env var and drops invalid names or blank values', () => {
    expect(
      collectSpecKeys({
        keys: [
          { keyEnv: 'VITE_A_API_KEY', value: 'a' },
          { keyEnv: 'VITE_B_API_KEY', value: ' ' },
          { keyEnv: 'BAD NAME', value: 'x' },
          { keyEnv: 'VITE_A_API_KEY', value: 'dup' },
        ],
        keyEnv: 'VITE_A_API_KEY',
        apiKey: 'legacy',
      })
    ).toEqual([{ keyEnv: 'VITE_A_API_KEY', value: 'a' }]);
  });
});
