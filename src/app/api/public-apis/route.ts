import { NextRequest, NextResponse } from 'next/server';
import catalog from '../../../../vendor/Public-Api-Live-Usage/apis_data.json';

export type CatalogEntry = {
  id?: number;
  name: string;
  url: string;
  category: string;
  description: string;
  auth: string;
  https: string;
  cors: string;
};

export type ProductRecipe = {
  title: string;
  api: string;
  category: string;
  description: string;
  endpoint: string;
  auth: 'none' | 'apiKey' | 'OAuth';
  keyEnv?: string;
  docsUrl?: string;
  demoKey?: string;
  sampleEndpoints?: string[];
};

const PRODUCT_RECIPES: ProductRecipe[] = [
  {
    title: 'Live image gallery',
    api: 'Lorem Picsum',
    category: 'Photography',
    description: 'Build moodboards, portfolios, inspiration boards, and responsive image explorers with filters and layout controls.',
    endpoint: 'https://picsum.photos/v2/list',
    auth: 'none',
    docsUrl: 'https://picsum.photos',
    sampleEndpoints: ['https://picsum.photos/v2/list?page=1&limit=20', 'https://picsum.photos/id/{id}/info'],
  },
  {
    title: 'Recipe discovery app',
    api: 'TheMealDB',
    category: 'Food & Drink',
    description: 'Build recipe search, meal planning, category filtering, ingredient lists, and cooking instruction drawers.',
    endpoint: 'https://www.themealdb.com/api/json/v1/1/search.php?s=',
    auth: 'none',
    docsUrl: 'https://www.themealdb.com/api.php',
    sampleEndpoints: [
      'https://www.themealdb.com/api/json/v1/1/search.php?s=chicken',
      'https://www.themealdb.com/api/json/v1/1/categories.php',
      'https://www.themealdb.com/api/json/v1/1/lookup.php?i=52772',
    ],
  },
  {
    title: 'Pokemon collection',
    api: 'PokéAPI',
    category: 'Games & Comics',
    description: 'Build searchable catalogs, stat cards, battle team builders, detail modals, and favorites collection trackers.',
    endpoint: 'https://pokeapi.co/api/v2/pokemon',
    auth: 'none',
    docsUrl: 'https://pokeapi.co',
    sampleEndpoints: [
      'https://pokeapi.co/api/v2/pokemon?limit=24',
      'https://pokeapi.co/api/v2/pokemon/{name}',
      'https://pokeapi.co/api/v2/type',
    ],
  },
  {
    title: 'Public data dashboard',
    api: 'REST Countries',
    category: 'Geocoding',
    description: 'Build country explorers, comparison dashboards, interactive maps, population indicators, and travel widgets.',
    endpoint: 'https://restcountries.com/v3.1/all',
    auth: 'none',
    docsUrl: 'https://restcountries.com',
    sampleEndpoints: [
      'https://restcountries.com/v3.1/all?fields=name,capital,currencies,flags,population,region',
      'https://restcountries.com/v3.1/region/europe',
    ],
  },
  {
    title: 'Space image journal',
    api: 'NASA Open APIs',
    category: 'Science & Math',
    description: 'Build astronomy picture of the day galleries, Mars rover photo viewers, space exploration logs, and science explainers.',
    endpoint: 'https://api.nasa.gov/planetary/apod',
    auth: 'apiKey',
    keyEnv: 'VITE_NASA_API_KEY',
    demoKey: 'DEMO_KEY',
    docsUrl: 'https://api.nasa.gov',
    sampleEndpoints: [
      'https://api.nasa.gov/planetary/apod?api_key={KEY}&count=10',
      'https://api.nasa.gov/mars-photos/api/v1/rovers/curiosity/photos?sol=1000&api_key={KEY}',
    ],
  },
  {
    title: 'News reader',
    api: 'NewsAPI',
    category: 'News',
    description: 'Build topic feeds, newsroom dashboards, reading lists, category tabs, and real-time headline summaries.',
    endpoint: 'https://newsapi.org/v2/top-headlines',
    auth: 'apiKey',
    keyEnv: 'VITE_NEWS_API_KEY',
    docsUrl: 'https://newsapi.org',
    sampleEndpoints: ['https://newsapi.org/v2/top-headlines?country=us&apiKey={KEY}'],
  },
  {
    title: 'Developer toolkit',
    api: 'Public Development APIs',
    category: 'Development',
    description: 'Build API explorers, status monitoring dashboards, request generators, and automation consoles.',
    endpoint: 'https://api.github.com/zen',
    auth: 'none',
    docsUrl: 'https://github.com/public-apis/public-apis',
    sampleEndpoints: ['https://api.github.com/zen', 'https://httpbin.org/get'],
  },
  {
    title: 'Finance tracker',
    api: 'CoinGecko Crypto & Markets',
    category: 'Finance',
    description: 'Build market dashboards, live crypto price trackers, exchange-rate calculators, and trending asset watchlists.',
    endpoint: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd',
    auth: 'none',
    docsUrl: 'https://www.coingecko.com/en/api',
    sampleEndpoints: [
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20',
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd',
    ],
  },
];

async function fetchJson(url: string) {
  try {
    const response = await fetch(url, { next: { revalidate: 300 } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const entries = catalog as CatalogEntry[];
  const url = new URL(req.url);
  const categoryParam = url.searchParams.get('category');
  const searchParam = url.searchParams.get('search');

  // Filtered catalog request
  if (categoryParam || searchParam) {
    let filtered = entries;
    if (categoryParam) {
      filtered = filtered.filter((e) => e.category.toLowerCase() === categoryParam.toLowerCase());
    }
    if (searchParam) {
      const q = searchParam.toLowerCase();
      filtered = filtered.filter(
        (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
      );
    }
    return NextResponse.json({
      total: filtered.length,
      entries: filtered.slice(0, 50),
    });
  }

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
      images: Array.isArray(images)
        ? images.map((image) => ({
            id: image.id,
            title: `Image product ${image.id}`,
            image: image.download_url || image.url,
            source: 'Lorem Picsum',
            api: 'Lorem Picsum',
            category: 'Photography',
            endpoint: 'https://picsum.photos/v2/list',
            auth: 'none',
          }))
        : [],
      meals: (meals?.meals || [])
        .slice(0, 6)
        .map((meal: { idMeal: string; strMeal: string; strMealThumb: string }) => ({
          id: meal.idMeal,
          title: meal.strMeal,
          image: meal.strMealThumb,
          source: 'TheMealDB',
          api: 'TheMealDB',
          category: 'Food & Drink',
          endpoint: `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${meal.idMeal}`,
          auth: 'none',
        })),
      pokemon: (pokemon?.results || [])
        .slice(0, 8)
        .map((item: { name: string; url: string }) => ({
          title: item.name,
          source: 'PokéAPI',
          api: 'PokéAPI',
          category: 'Games & Comics',
          endpoint: item.url,
          auth: 'none',
        })),
    },
  });
}
