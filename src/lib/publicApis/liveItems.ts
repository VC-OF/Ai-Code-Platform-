import { cleanLabel, safeHttpUrl } from './catalog';

/**
 * Normalises the live example payloads (Lorem Picsum, TheMealDB, PokéAPI)
 * shown on the Starters tab. Their text reaches the agent prompt when the
 * user builds from a card, so it is cleaned and capped like catalog text, and
 * ids and URLs are validated rather than trusted.
 */
export interface LiveExample {
  id?: string;
  title: string;
  image?: string;
  source: string;
  api: string;
  category: string;
  endpoint: string;
  auth: 'none';
}

export const MAX_LIVE_TITLE = 60;

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
}

function field(payload: unknown, name: string): unknown {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[name] : undefined;
}

function safeId(value: unknown): string {
  const id = typeof value === 'number' && Number.isInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{1,32}$/.test(id) ? id : '';
}

function urlOnHost(value: unknown, host: string): string {
  const url = safeHttpUrl(value);
  if (!url) return '';
  return new URL(url).hostname === host ? url : '';
}

export function liveImages(payload: unknown, limit = 14): LiveExample[] {
  const out: LiveExample[] = [];
  for (const image of records(payload)) {
    const id = safeId(image.id);
    const src = safeHttpUrl(image.download_url) || safeHttpUrl(image.url);
    if (!id || !src) continue;
    out.push({
      id,
      title: `Image product ${id}`,
      image: src,
      source: 'Lorem Picsum',
      api: 'Lorem Picsum',
      category: 'Photography',
      endpoint: 'https://picsum.photos/v2/list',
      auth: 'none',
    });
  }
  return out.slice(0, limit);
}

export function liveMeals(payload: unknown, limit = 6): LiveExample[] {
  const out: LiveExample[] = [];
  for (const meal of records(field(payload, 'meals'))) {
    const id = safeId(meal.idMeal);
    const title = cleanLabel(meal.strMeal, MAX_LIVE_TITLE);
    if (!id || !title) continue;
    const image = safeHttpUrl(meal.strMealThumb);
    out.push({
      id,
      title,
      ...(image ? { image } : {}),
      source: 'TheMealDB',
      api: 'TheMealDB',
      category: 'Food & Drink',
      endpoint: `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(id)}`,
      auth: 'none',
    });
  }
  return out.slice(0, limit);
}

export function livePokemon(payload: unknown, limit = 8): LiveExample[] {
  const out: LiveExample[] = [];
  for (const item of records(field(payload, 'results'))) {
    const title = cleanLabel(item.name, MAX_LIVE_TITLE);
    const endpoint = urlOnHost(item.url, 'pokeapi.co');
    if (!title || !endpoint) continue;
    out.push({ title, source: 'PokéAPI', api: 'PokéAPI', category: 'Games & Comics', endpoint, auth: 'none' });
  }
  return out.slice(0, limit);
}
