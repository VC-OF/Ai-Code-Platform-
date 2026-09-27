import type { CatalogStats, CategoryCount, PublicApiWithKey } from '@/lib/publicApis/catalog';
import type { ResolvedIdea } from '@/lib/publicApis/ideas';
import type { LiveExample } from '@/lib/publicApis/liveItems';
import type { StarterRecipe } from '@/lib/publicApis/recipes';

/** Response shapes of GET /api/public-apis (see src/app/api/public-apis/route.ts). */

export type LiveItem = LiveExample;

export interface CategoriesResponse {
  total: number;
  categories: CategoryCount[];
}

export interface GalleryOverview {
  source: string;
  catalogSize: number;
  categoryCounts: CategoryCount[];
  categories: CategoryCount[];
  stats: CatalogStats;
  recipes: StarterRecipe[];
  live: { images: LiveItem[]; meals: LiveItem[]; pokemon: LiveItem[] };
}

export interface IdeasResponse {
  total: number;
  ideas: ResolvedIdea[];
  stats: CatalogStats;
}

export interface BrowseResponse {
  total: number;
  offset: number;
  limit: number;
  entries: PublicApiWithKey[];
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}
