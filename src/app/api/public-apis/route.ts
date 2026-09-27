import { NextRequest, NextResponse } from 'next/server';
import catalog from '../../../../vendor/Public-Api-Live-Usage/apis_data.json';
import { listEnvVarsMasked } from '@/lib/settingsStore';
import {
  computeStats,
  hasBrowseParams,
  keyEnvFor,
  listCategories,
  normalizeCatalog,
  parseCatalogParams,
  queryCatalog,
  savedKeyName,
  toSavedKeySet,
  withKeyStatus,
  type RawCatalogEntry,
} from '@/lib/publicApis/catalog';
import { resolveIdeas } from '@/lib/publicApis/ideas';
import { liveImages, liveMeals, livePokemon } from '@/lib/publicApis/liveItems';
import { PRODUCT_RECIPES, type StarterRecipe } from '@/lib/publicApis/recipes';

/**
 * GET /api/public-apis
 *   (no params)                     overview: recipes, live examples, categories, stats
 *   ?view=ideas                     product ideas resolved against the catalog + saved keys
 *   ?view=categories                category names and counts (no upstream fetches)
 *   ?search&category&auth&https&cors&offset&limit
 *                                   filtered, paginated catalog entries
 *
 * "Saved" means a global setting with a matching NAME exists; values are
 * never read here.
 */

const APIS = normalizeCatalog(catalog as RawCatalogEntry[]);
const CATEGORIES = listCategories(APIS);
const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

async function savedKeyNames(): Promise<Set<string>> {
  try {
    const vars = await listEnvVarsMasked();
    return toSavedKeySet(vars.map((v) => v.key));
  } catch {
    return new Set();
  }
}

async function fetchJson(url: string) {
  try {
    const response = await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const view = params.get('view');

  if (view !== null) {
    if (view === 'categories') return NextResponse.json({ total: APIS.length, categories: CATEGORIES });
    if (view !== 'ideas') return badRequest('view must be "ideas" or "categories"');
    const saved = await savedKeyNames();
    const ideas = resolveIdeas(APIS, saved);
    return NextResponse.json({ total: ideas.length, ideas, stats: computeStats(APIS, saved) });
  }

  if (hasBrowseParams(params)) {
    const parsed = parseCatalogParams(params, CATEGORY_NAMES);
    if (!parsed.ok) return badRequest(parsed.error);
    const saved = await savedKeyNames();
    const page = queryCatalog(APIS, parsed.query);
    return NextResponse.json({
      total: page.total,
      offset: page.offset,
      limit: page.limit,
      entries: page.entries.map((api) => withKeyStatus(api, saved)),
    });
  }

  const [saved, images, meals, pokemon] = await Promise.all([
    savedKeyNames(),
    fetchJson('https://picsum.photos/v2/list?page=2&limit=14'),
    fetchJson('https://www.themealdb.com/api/json/v1/1/search.php?s=chicken'),
    fetchJson('https://pokeapi.co/api/v2/pokemon?limit=12'),
  ]);

  const recipes: StarterRecipe[] = PRODUCT_RECIPES.map((recipe) => {
    const savedAs =
      recipe.auth === 'none'
        ? null
        : savedKeyName(
            { authKind: recipe.auth === 'OAuth' ? 'oauth' : 'apiKey', keyEnv: recipe.keyEnv || keyEnvFor(recipe.api) },
            saved
          );
    return savedAs ? { ...recipe, keySaved: true, keySavedAs: savedAs } : { ...recipe, keySaved: false };
  });

  return NextResponse.json({
    source: 'VC-OF/Public-Api-Live-Usage',
    catalogSize: APIS.length,
    categoryCounts: listCategories(APIS, 'count').slice(0, 12),
    categories: CATEGORIES,
    stats: computeStats(APIS, saved),
    recipes,
    live: {
      images: liveImages(images),
      meals: liveMeals(meals),
      pokemon: livePokemon(pokemon),
    },
  });
}
