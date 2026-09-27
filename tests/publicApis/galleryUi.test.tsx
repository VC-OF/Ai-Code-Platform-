import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import raw from '../../vendor/Public-Api-Live-Usage/apis_data.json';
import { listCategories, normalizeCatalog, normalizeEntry, type RawCatalogEntry } from '@/lib/publicApis/catalog';
import { resolveIdea, resolveIdeas } from '@/lib/publicApis/ideas';
import { PRODUCT_RECIPES } from '@/lib/publicApis/recipes';
import { targetFromIdea, targetFromRecipe } from '@/lib/publicApis/buildSpec';
import PublicApiGallery, { StatsLine } from '@/components/PublicApiGallery';
import IdeasPanel from '@/components/gallery/IdeasPanel';
import BrowsePanel from '@/components/gallery/BrowsePanel';
import BuildProductModal from '@/components/gallery/BuildProductModal';
import StartersPanel from '@/components/gallery/StartersPanel';

// Server-side render only (no DOM in this test environment): checks markup,
// labels and ARIA wiring, not interaction.

const CATALOG = normalizeCatalog(raw as RawCatalogEntry[]);
const noop = () => {};

describe('PublicApiGallery', () => {
  const html = renderToStaticMarkup(<PublicApiGallery />);

  it('renders three tabs wired to tabpanels', () => {
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
    for (const id of ['ideas', 'starters', 'browse']) {
      expect(html).toContain(`id="api-gallery-tab-${id}"`);
      expect(html).toContain(`aria-controls="api-gallery-panel-${id}"`);
      expect(html).toContain(`aria-labelledby="api-gallery-tab-${id}"`);
    }
    expect(html).toMatch(/id="api-gallery-tab-ideas"[^>]*aria-selected="true"[^>]*tabindex="0"/);
    expect(html).toMatch(/id="api-gallery-tab-browse"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(html).toMatch(/id="api-gallery-panel-browse"[^>]*hidden=""/);
    expect(html).toContain('Product ideas');
    expect(html).toContain('Browse all APIs');
  });

  it('says the catalog is loading until both requests fail, then stops claiming it', () => {
    expect(html).toContain('Loading the public API catalog…');
    expectAnnouncedSkeleton(html, 'Loading product ideas…');
    const loading = renderToStaticMarkup(<StatsLine stats={null} failed={false} />);
    expect(loading).toContain('Loading the public API catalog…');
    const failed = renderToStaticMarkup(<StatsLine stats={null} failed />);
    expect(failed).not.toContain('Loading');
    expect(failed).toContain('Catalog stats unavailable.');
    const stats = { total: 1885, noKey: 897, apiKey: 800, oauth: 149, other: 39, savedKeys: 0, savedKeysUnlocking: 0 };
    expect(renderToStaticMarkup(<StatsLine stats={stats} failed />)).toContain('1,885 APIs');
  });
});

describe('IdeasPanel', () => {
  const oauthApi = normalizeEntry(
    { id: 1, name: 'Spotify', url: 'https://developer.spotify.com', category: 'Music', description: '', auth: 'OAuth', https: 'Yes', cors: 'Unknown' },
    0
  );
  const oauthIdea = resolveIdea(
    { id: 'oauth-idea', title: 'OAuth idea', pitch: 'Uses OAuth.', categories: ['Music'], features: ['a', 'b', 'c'], audience: 'x' },
    [oauthApi]
  );
  const ideas = [...resolveIdeas(CATALOG, ['VITE_ETHERSCAN_API_KEY']).slice(0, 13), oauthIdea];
  const html = renderToStaticMarkup(<IdeasPanel ideas={ideas} error={false} onRetry={noop} onBuild={noop} />);

  it('labels OAuth as OAuth, never as "No key"', () => {
    const card = html.slice(html.indexOf('OAuth idea'));
    expect(card).toContain('Spotify');
    expect(card).toMatch(/Spotify<\/span><span[^>]*>OAuth<\/span>/);
    expect(card).toContain('Needs 1 key');
  });

  it('shows readiness, saved keys and a build button per idea', () => {
    expect(html).toContain('Ready to build');
    expect(html).toContain('key saved');
    expect(html.match(/Build this/g)).toHaveLength(ideas.length);
    expect(html).toContain('<legend');
  });

  it('shows a skeleton while loading and a retry on error', () => {
    const loading = renderToStaticMarkup(<IdeasPanel ideas={null} error={false} onRetry={noop} onBuild={noop} />);
    expectAnnouncedSkeleton(loading, 'Loading product ideas…');
    expect(renderToStaticMarkup(<IdeasPanel ideas={null} error onRetry={noop} onBuild={noop} />)).toContain('Try again');
  });
});

// A loading state screen readers hear: a status message, with the skeleton cards hidden from them
function expectAnnouncedSkeleton(html: string, message: string) {
  expect(html).toMatch(new RegExp(`<p role="status"[^>]*>${message}</p>`));
  expect(html).toMatch(/<div class="[^"]*grid[^"]*" aria-hidden="true">(<div class="[^"]*skeleton[^"]*"><\/div>)+<\/div>/);
  // aria-label on a role-less element is ignored, so none is relied on
  expect(html).not.toMatch(/<div(?![^>]*role=)[^>]*aria-label=/);
}

describe('BrowsePanel', () => {
  const categories = listCategories(CATALOG);
  const html = renderToStaticMarkup(
    <BrowsePanel categories={categories} catalogSize={1885} ideas={null} onBuildApi={noop} onBuildIdea={noop} />
  );

  it('labels every control', () => {
    const labelled = (id: string) => html.includes(`for="${id}"`) && html.includes(`id="${id}"`);
    const ids = [...html.matchAll(/<(?:input|select)[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids) expect(labelled(id), id).toBe(true);
    expect(html).toContain('HTTPS only');
    expect(html).toContain('<legend');
  });

  it('offers every category', () => {
    expect(html.match(/<option/g)!.length).toBe(categories.length + 1 + 4);
    expect(html).toContain('All categories (1,885)');
  });

  it('still renders its controls before any categories arrive', () => {
    const empty = renderToStaticMarkup(
      <BrowsePanel categories={[]} catalogSize={null} ideas={null} onBuildApi={noop} onBuildIdea={noop} />
    );
    expect(empty).toContain('>All categories</option>');
    expect(empty).toContain('Searching…');
  });

  it('announces its state in one status region and offers no stale actions while loading', () => {
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/<span role="status" aria-live="polite">Searching…<\/span>/);
    expect(html).not.toContain('Try again');
    expect(html).not.toContain('Clear filters');
    expect(html).not.toContain('Load ');
    // Skeleton cards are hidden from screen readers; the status speaks for them
    expect(html).toMatch(/<div class="[^"]*grid[^"]*" aria-hidden="true">/);
  });
});

describe('StartersPanel', () => {
  it('labels a saved starter key with the name it was saved under', () => {
    const recipes = PRODUCT_RECIPES.map((recipe) =>
      recipe.api === 'NASA Open APIs'
        ? { ...recipe, keySaved: true, keySavedAs: 'NASA_API_KEY' }
        : { ...recipe, keySaved: false }
    );
    const html = renderToStaticMarkup(
      <StartersPanel recipes={recipes} live={[]} error={false} onRetry={noop} onBuildRecipe={noop} onBuildLive={noop} />
    );
    expect(html).toContain('title="Saved in Settings as NASA_API_KEY"');
    expect(html).not.toContain('Saved in Settings as VITE_NASA_API_KEY');
  });

  it('announces its loading skeleton', () => {
    const html = renderToStaticMarkup(
      <StartersPanel recipes={null} live={[]} error={false} onRetry={noop} onBuildRecipe={noop} onBuildLive={noop} />
    );
    expectAnnouncedSkeleton(html, 'Loading starters…');
  });
});

describe('BuildProductModal', () => {
  const ideas = resolveIdeas(CATALOG, ['VITE_ETHERSCAN_API_KEY']);
  const render = (id: string) =>
    renderToStaticMarkup(
      <BuildProductModal target={targetFromIdea(ideas.find((i) => i.id === id)!)} onClose={noop} onConfirm={async () => {}} />
    );

  it('asks for each needed key with password inputs, prefilling only demo keys', () => {
    const html = render('recipe-planner');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const inputs = [...html.matchAll(/<input[^>]*type="password"[^>]*>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toContain('value="1"');
    expect(inputs[1]).toContain('value="DEMO_KEY"');
    expect(html).toContain('VITE_THEMEALDB_API_KEY');
    expect(html).toContain('VITE_FOODDATA_CENTRAL_API_KEY');
  });

  it('does not prefill keys without a demo key, and notes saved keys', () => {
    const planner = render('event-planner');
    const [input] = [...planner.matchAll(/<input[^>]*type="password"[^>]*>/g)].map((m) => m[0]);
    expect(input).toContain('value=""');
    expect(planner).toContain('1 key not provided');

    const crypto = render('crypto-portfolio');
    expect(crypto).toContain('Using your saved key');
    expect(crypto).toContain('All keys provided.');
  });

  it('shows no key inputs when none are needed', () => {
    const html = render('travel-planner');
    expect(html).not.toContain('type="password"');
    expect(html).toContain('No keys needed');
  });

  it('explains that a key saved without VITE_ stays server-side', () => {
    const nasa = PRODUCT_RECIPES.find((r) => r.api === 'NASA Open APIs')!;
    const html = renderToStaticMarkup(
      <BuildProductModal
        target={targetFromRecipe({ ...nasa, keySaved: true, keySavedAs: 'NASA_API_KEY' })}
        onClose={noop}
        onConfirm={async () => {}}
      />
    );
    expect(html).toContain('Already saved as <code>NASA_API_KEY</code>');
    expect(html).toContain('dev-server proxy');
    const [input] = [...html.matchAll(/<input[^>]*type="password"[^>]*>/g)].map((m) => m[0]);
    expect(input).toContain('value=""');
  });
});
