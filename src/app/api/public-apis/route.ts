import { NextResponse } from 'next/server';
import catalog from '../../../../vendor/Public-Api-Live-Usage/apis_data.json';

type CatalogEntry = {
  name: string;
  url: string;
  category: string;
  description: string;
  auth: string;
  https: string;
  cors: string;
};

const PRODUCT_RECIPES = [
  { title: 'Live image gallery', api: 'Lorem Picsum', category: 'Photography', description: 'Build moodboards, portfolios, inspiration boards, and image explorers.', endpoint: 'https://picsum.photos/v2/list' },
  { title: 'Recipe discovery app', api: 'TheMealDB', category: 'Food & Drink', description: 'Build recipe search, meal planning, ingredient explorers, and cooking assistants.', endpoint: 'https://www.themealdb.com/api.php' },
  { title: 'Pokemon collection', api: 'PokéAPI', category: 'Games & Comics', description: 'Build searchable catalogs, team builders, detail pages, and collection trackers.', endpoint: 'https://pokeapi.co/api/v2/pokemon' },
  { title: 'Public data dashboard', api: 'REST Countries', category: 'Geocoding', description: 'Build country explorers, comparison dashboards, maps, and travel tools.', endpoint: 'https://restcountries.com/v3.1/all' },
  { title: 'Space image journal', api: 'NASA Open APIs', category: 'Science & Math', description: 'Build astronomy galleries, daily image feeds, and science explainers.', endpoint: 'https://api.nasa.gov' },
  { title: 'News reader', api: 'News & RSS APIs', category: 'News', description: 'Build topic feeds, newsroom dashboards, reading lists, and summaries.', endpoint: 'https://newsapi.org' },
  { title: 'Developer toolkit', api: 'Public Development APIs', category: 'Development', description: 'Build API explorers, status dashboards, generators, and automation consoles.', endpoint: 'https://github.com/public-apis/public-apis' },
  { title: 'Finance tracker', api: 'Finance APIs', category: 'Finance', description: 'Build market dashboards, portfolio tools, exchange-rate views, and alerts.', endpoint: 'https://github.com/public-apis/public-apis' },
] as const;

async function fetchJson(url: string) {
  try {
    const response = await fetch(url, { next: { revalidate: 300 } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function GET() {
  const entries = catalog as CatalogEntry[];
  const categoryCounts = Object.entries(
    entries.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.category] = (counts[entry.category] || 0) + 1;
      return counts;
    }, {})
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));

  const [images, meals, pokemon] = await Promise.all([
    fetchJson('https://picsum.photos/v2/list?page=2&limit=14'),
    fetchJson('https://www.themealdb.com/api/json/v1/1/search.php?s=chicken'),
    fetchJson('https://pokeapi.co/api/v2/pokemon?limit=12'),
  ]);

  return NextResponse.json({
    source: 'VC-OF/Public-Api-Live-Usage',
    catalogSize: entries.length,
    categoryCounts,
    recipes: PRODUCT_RECIPES,
    live: {
      images: Array.isArray(images) ? images.map((image) => ({
        id: image.id,
        title: `Image product ${image.id}`,
        image: image.download_url || image.url,
        source: 'Lorem Picsum',
      })) : [],
      meals: (meals?.meals || []).slice(0, 6).map((meal: { idMeal: string; strMeal: string; strMealThumb: string }) => ({
        id: meal.idMeal,
        title: meal.strMeal,
        image: meal.strMealThumb,
        source: 'TheMealDB',
      })),
      pokemon: (pokemon?.results || []).slice(0, 8).map((item: { name: string; url: string }) => ({
        title: item.name,
        source: 'PokéAPI',
        endpoint: item.url,
      })),
    },
  });
}
