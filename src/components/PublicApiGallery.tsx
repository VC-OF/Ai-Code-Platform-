'use client';

import { useEffect, useRef, useState } from 'react';

export interface BuildProductSpec {
  title: string;
  api: string;
  category: string;
  description: string;
  endpoint: string;
  apiKey?: string;
  keyEnv?: string;
  template: string;
  prompt: string;
}

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

type GalleryData = {
  source: string;
  catalogSize: number;
  categoryCounts: { name: string; count: number }[];
  recipes: ProductRecipe[];
  live: {
    images: { id: string; title: string; image: string; source: string; api: string; category: string; endpoint: string; auth: 'none' }[];
    meals: { id: string; title: string; image: string; source: string; api: string; category: string; endpoint: string; auth: 'none' }[];
    pokemon: { title: string; source: string; endpoint: string; api: string; category: string; auth: 'none' }[];
  };
};

type CatalogApiItem = {
  name: string;
  url: string;
  category: string;
  description: string;
  auth: string;
  https: string;
  cors: string;
};

interface PublicApiGalleryProps {
  onBuildProduct?: (spec: BuildProductSpec) => Promise<void> | void;
}

export default function PublicApiGallery({ onBuildProduct }: PublicApiGalleryProps) {
  const [data, setData] = useState<GalleryData | null>(null);
  const [error, setError] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductRecipe | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [categoryItems, setCategoryItems] = useState<CatalogApiItem[]>([]);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const latestCategoryRef = useRef<string | null>(null);

  useEffect(() => {
    fetch('/api/public-apis')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const handleCategoryClick = (categoryName: string) => {
    if (activeCategory === categoryName) {
      latestCategoryRef.current = null;
      setActiveCategory(null);
      setCategoryItems([]);
      return;
    }
    latestCategoryRef.current = categoryName;
    setActiveCategory(categoryName);
    setLoadingCategory(true);
    fetch(`/api/public-apis?category=${encodeURIComponent(categoryName)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (latestCategoryRef.current !== categoryName) return;
        setCategoryItems(d.entries || []);
        setLoadingCategory(false);
      })
      .catch(() => {
        if (latestCategoryRef.current === categoryName) setLoadingCategory(false);
      });
  };

  const openRecipe = (recipe: ProductRecipe) => {
    setSelectedProduct(recipe);
  };

  const openLiveItem = (
    title: string,
    api: string,
    category: string,
    description: string,
    endpoint: string
  ) => {
    setSelectedProduct({
      title,
      api,
      category,
      description,
      endpoint,
      auth: 'none',
      sampleEndpoints: [endpoint],
    });
  };

  const openCatalogItem = (item: CatalogApiItem) => {
    const isApiKey = item.auth.toLowerCase().includes('apikey') || item.auth.toLowerCase().includes('key');
    const isOAuth = item.auth.toLowerCase().includes('oauth');
    setSelectedProduct({
      title: `${item.name} Explorer`,
      api: item.name,
      category: item.category,
      description: item.description,
      endpoint: item.url,
      auth: isApiKey ? 'apiKey' : isOAuth ? 'OAuth' : 'none',
      keyEnv: isApiKey ? `VITE_${item.name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_API_KEY` : undefined,
      docsUrl: item.url,
      sampleEndpoints: [item.url],
    });
  };

  if (error) return null;

  return (
    <section className="api-gallery" aria-label="Public API product gallery">
      <div className="api-gallery-head">
        <div>
                    <h2>Build from the open web</h2>
          <p>
            {data
              ? `Pick one of ${data.catalogSize.toLocaleString()} public APIs or a starter below and the agent builds it.`
              : 'Loading public API ideas and live examples…'}
          </p>
        </div>
        <a
          href="https://github.com/VC-OF/Public-Api-Live-Usage"
          target="_blank"
          rel="noreferrer"
          className="api-catalog-link"
        >
          View catalog
        </a>
      </div>

      {data && (
        <>
          {/* Category Chips */}
          <div className="api-category-row" role="group" aria-label="Filter by category">
            {data.categoryCounts.map((category) => {
              const isActive = activeCategory === category.name;
              return (
                <button
                  type="button"
                  key={category.name}
                  onClick={() => handleCategoryClick(category.name)}
                  aria-pressed={isActive}
                  className={`api-category-chip ${isActive ? 'api-category-chip--active' : ''}`}
                >
                  {category.name} <span className="api-category-count">{category.count}</span>
                </button>
              );
            })}
          </div>

          {/* Expanded Category Browser if a category is selected */}
          {activeCategory && (
            <div className="category-drawer">
              <div className="category-drawer-header">
                <div>
                  <strong>{activeCategory}</strong>
                  <span className="category-drawer-count"> {categoryItems.length} APIs</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCategoryClick(activeCategory)}
                  className="category-drawer-close"
                >
                  Close
                </button>
              </div>

              {loadingCategory ? (
                <div className="category-drawer-loading">Loading {activeCategory} APIs…</div>
              ) : (
                <div className="category-drawer-grid">
                  {categoryItems.map((api) => (
                    <div key={api.name} className="cat-api-card">
                      <div className="cat-api-header">
                        <span className="cat-api-title">{api.name}</span>
                        <span
                          className={`cat-api-auth ${
                            api.auth && api.auth !== 'No' ? 'cat-api-auth--key' : 'cat-api-auth--free'
                          }`}
                        >
                          {api.auth && api.auth !== 'No' ? api.auth : 'No key'}
                        </span>
                      </div>
                      <p className="cat-api-desc">{api.description}</p>
                      <button
                        type="button"
                        onClick={() => openCatalogItem(api)}
                        className="cat-api-build-btn"
                      >
                        Build
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Live Image Examples Rail */}
          <div className="api-image-rail" aria-label="Live image examples">
            {[...data.live.images, ...data.live.meals].map((item) => (
              <button
                type="button"
                key={`${item.source}-${item.id}`}
                onClick={() =>
                  openLiveItem(
                    item.source === 'TheMealDB' ? `Recipe Explorer: ${item.title}` : `Photo Gallery: ${item.title}`,
                    item.source,
                    item.category || (item.source === 'TheMealDB' ? 'Food & Drink' : 'Photography'),
                    item.source === 'TheMealDB'
                      ? `Build a culinary recipe search and cooking planner app centered around ${item.title}.`
                      : `Build an aesthetic photo collection and image viewer based on ${item.title}.`,
                    item.endpoint
                  )
                }
                className="api-image-card"
                title={`Build a product using ${item.source}`}
              >
                <img src={item.image} alt={item.title} loading="lazy" />
                <div className="api-image-info">
                  <strong>{item.title}</strong>
                  <span>{item.source}</span>
                </div>
              </button>
            ))}
          </div>

          {/* 8 Product Recipes Grid */}
          <div className="api-recipe-grid">
            {data.recipes.map((recipe) => (
              <button
                type="button"
                key={recipe.title}
                onClick={() => openRecipe(recipe)}
                className="api-recipe-card"
              >
                <div className="recipe-card-top">
                  <span className="api-recipe-category">{recipe.category}</span>
                  <span className={`recipe-auth-pill ${recipe.auth === 'apiKey' ? 'recipe-auth-pill--key' : ''}`}>
                    {recipe.auth === 'apiKey' ? 'Key needed' : 'No key'}
                  </span>
                </div>
                <strong className="api-recipe-title">{recipe.title}</strong>
                <p className="api-recipe-desc">{recipe.description}</p>
                <div className="recipe-card-bottom">
                  <span className="api-recipe-api">{recipe.api}</span>
                  <span className="recipe-build-cta">Build</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Build Product Modal */}
      {selectedProduct && (
        <BuildProductModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onConfirm={async (spec) => {
            if (onBuildProduct) {
              await onBuildProduct(spec);
            }
            setSelectedProduct(null);
          }}
        />
      )}

      <style jsx>{`
        .api-gallery :global(button:focus-visible),
        .api-gallery :global(a:focus-visible),
        .api-gallery :global(input:focus-visible) {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        .api-gallery {
          width: 100%;
          font-size: 13px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 8px 0 28px;
        }

        .api-gallery-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 20px;
        }

        h2 {
          margin: 0 0 4px;
          font: 500 20px/1.25 var(--font-serif);
          color: var(--text-primary);
        }

        .api-gallery-head p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
        }

        .api-catalog-link {
          color: var(--text-secondary);
          font-size: 12px;
          white-space: nowrap;
          text-decoration: none;
        }

        .api-catalog-link:hover {
          color: var(--text-primary);
          text-decoration: underline;
        }

        .api-category-row {
          display: flex;
          flex-wrap: wrap;
          gap: 2px 4px;
        }

        .api-category-chip {
          flex: 0 0 auto;
          padding: 3px 8px;
          border: none;
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          background: none;
          font: inherit;
          font-size: 12.5px;
          cursor: pointer;
        }

        .api-category-chip:hover {
          color: var(--text-primary);
        }

        .api-category-chip--active {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }

        .api-category-count {
          color: var(--text-disabled);
          margin-left: 2px;
        }

        /* Category Drawer */
        .category-drawer {
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          padding: 14px 16px;
          margin-bottom: 4px;
        }

        .category-drawer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          font-size: 13px;
          color: var(--text-primary);
        }

        .category-drawer-count {
          color: var(--text-muted);
          font-size: 12px;
        }

        .category-drawer-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
        }

        .category-drawer-close:hover {
          color: var(--text-primary);
        }

        .category-drawer-loading {
          padding: 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 12px;
        }

        .category-drawer-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          max-height: 260px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .cat-api-card {
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .cat-api-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .cat-api-title {
          font-weight: 600;
          font-size: 13px;
          color: var(--text-primary);
        }

        .cat-api-auth {
          font-size: 11.5px;
        }

        .cat-api-auth--free {
          color: var(--text-muted);
        }

        .cat-api-auth--key {
          color: var(--warning);
        }

        .cat-api-desc {
          margin: 0;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.45;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .cat-api-build-btn {
          align-self: flex-start;
          background: none;
          border: none;
          padding: 0;
          color: var(--text-secondary);
          font: inherit;
          font-size: 12px;
          cursor: pointer;
        }

        .cat-api-build-btn:hover {
          text-decoration: underline;
        }

        /* Image Rail */
        .api-image-rail {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          scroll-snap-type: x proximity;
          padding-bottom: 6px;
          scrollbar-width: thin;
        }

        .api-image-card {
          flex: 0 0 156px;
          scroll-snap-align: start;
          overflow: hidden;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          background: var(--bg-surface);
          text-align: left;
          padding: 0;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .api-image-card:hover {
          border-color: var(--border-strong);
        }

        .api-image-card img {
          width: 100%;
          height: 100px;
          display: block;
          object-fit: cover;
          background: var(--bg-elevated);
        }

        .api-image-info {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 8px 10px;
        }

        .api-image-info strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12.5px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .api-image-info span {
          font-size: 11.5px;
          color: var(--text-muted);
        }

        /* Recipe Grid */
        .api-recipe-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }

        .api-recipe-card {
          min-width: 0;
          padding: 14px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: var(--bg-surface);
          color: inherit;
          text-align: left;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          transition: all var(--transition-fast);
        }

        .api-recipe-card:hover {
          border-color: var(--border-strong);
          background: var(--bg-hover);
        }

        .recipe-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }

        .api-recipe-category {
          color: var(--text-muted);
          font-size: 12px;
        }

        .recipe-auth-pill {
          font-size: 11.5px;
          color: var(--text-muted);
        }

        .recipe-auth-pill--key {
          color: var(--warning);
        }

        .api-recipe-title {
          display: block;
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .api-recipe-desc {
          flex: 1;
          min-height: 40px;
          margin: 0 0 12px;
          color: var(--text-secondary);
          font-size: 12.5px;
          line-height: 1.5;
        }

        .recipe-card-bottom {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid var(--border-subtle);
          padding-top: 8px;
        }

        .api-recipe-api {
          color: var(--text-muted);
          font: 11.5px var(--font-mono);
        }

        .recipe-build-cta {
          color: var(--text-secondary);
          font-size: 12px;
        }

        .api-recipe-card:hover .recipe-build-cta {
          color: var(--text-primary);
        }

        @media (max-width: 900px) {
          .api-recipe-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .category-drawer-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 600px) {
          .api-recipe-grid {
            grid-template-columns: 1fr;
          }
          .category-drawer-grid {
            grid-template-columns: 1fr;
          }
          .api-gallery-head {
            align-items: flex-start;
            flex-direction: column;
            gap: 8px;
          }
        }
      `}</style>
    </section>
  );
}

// ─── Build Product Modal Component ──────────────────────────────────────────
function BuildProductModal({
  product,
  onClose,
  onConfirm,
}: {
  product: ProductRecipe;
  onClose: () => void;
  onConfirm: (spec: BuildProductSpec) => Promise<void>;
}) {
  const [projectName, setProjectName] = useState(product.title);
  const [apiKey, setApiKey] = useState(product.demoKey || '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    const keyEnv = product.keyEnv || (product.auth === 'apiKey' ? 'VITE_API_KEY' : undefined);

    const prompt = [
      `Build a complete, polished, and fully-functional web application for "${product.title}" using the ${product.api} API.`,
      '',
      `Product Overview:`,
      `- Category: ${product.category}`,
      `- Description: ${product.description}`,
      `- Live Endpoint / Docs: ${product.endpoint}`,
      apiKey
        ? `- API Key: User provided an API key. It is saved in project settings/env as "${keyEnv || 'VITE_API_KEY'}". Make sure to read and use process.env.${keyEnv || 'VITE_API_KEY'} or import.meta.env.${keyEnv || 'VITE_API_KEY'} in API request headers or query params as required by ${product.api}.`
        : `- Auth: Free public API (no API key required). Connect directly to ${product.endpoint}.`,
      '',
      `Core Requirements:`,
      `1. Live API Data: Integrate directly with ${product.api} (${product.endpoint}) to load live, interactive data.`,
      `2. Rich Interactive Features: Implement real-time search, category filtering, detailed item inspection (cards, modals, or dedicated views), and bookmarking/favorites.`,
      `3. Aesthetics & UX: Use a stunning, modern dark/light UI with smooth transitions, responsive mobile support, and clear loading/error states.`,
      `4. Verification: Run verification (run_lint / run_tests) before completing your changes.`,
    ].join('\n');

    try {
      await onConfirm({
        title: projectName.trim() || product.title,
        api: product.api,
        category: product.category,
        description: product.description,
        endpoint: product.endpoint,
        apiKey: apiKey.trim() || undefined,
        keyEnv,
        template: 'react-vite',
        prompt,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={product.title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-left">
            <span className="modal-tag">{product.category}</span>
            <span
              className={`modal-auth-tag ${
                product.auth === 'apiKey' ? 'modal-auth-tag--key' : 'modal-auth-tag--free'
              }`}
            >
              {product.auth === 'apiKey' ? 'Key needed' : 'No key needed'}
            </span>
          </div>
          <button type="button" onClick={onClose} className="modal-close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <h3 className="modal-title">{product.title}</h3>
          <p className="modal-desc">{product.description}</p>

          <div className="modal-api-meta">
            <div className="meta-row">
              <span className="meta-label">Provider</span>
              <span className="meta-val">{product.api}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Endpoint</span>
              <span className="meta-val font-mono">{product.endpoint}</span>
            </div>
            {product.docsUrl && (
              <div className="meta-row">
                <span className="meta-label">Docs</span>
                <a
                  href={product.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="meta-link"
                >
                  {product.docsUrl}
                </a>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="modal-form">
            {/* Project Name */}
            <div className="field-group">
              <label className="field-label" htmlFor="build-project-name">Project name</label>
              <input
                id="build-project-name"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My API app"
                className="modal-input"
                required
              />
            </div>

            {/* API Key configuration */}
            <div className="field-group">
              <div className="field-label-row">
                <label className="field-label" htmlFor="build-api-key">
                  {product.auth === 'apiKey' ? 'API key' : 'API key (optional)'}
                </label>
                {product.demoKey && (
                  <button
                    type="button"
                    onClick={() => setApiKey(product.demoKey!)}
                    className="demo-key-btn"
                  >
                    Use {product.demoKey}
                  </button>
                )}
              </div>

              {product.auth === 'apiKey' ? (
                <>
                  <input
                    id="build-api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={`${product.api} API key`}
                    className="modal-input"
                    required={!product.demoKey}
                  />
                  <p className="field-hint">
                    Saved encrypted in project settings as{' '}
                    <code>{product.keyEnv || 'VITE_API_KEY'}</code> and made available to the agent.
                  </p>
                </>
              ) : (
                <p className="field-hint">No key needed. The agent connects to the live endpoint directly.</p>
              )}
            </div>

            {/* Features preview */}
            <div className="features-preview">
              <strong>What the agent will build</strong>
              <ul>
                <li>Complete React + Vite application with responsive layout</li>
                <li>Live dynamic data fetching from {product.api}</li>
                <li>Interactive search, filter, and detail modal experience</li>
                <li>Error handling, loading skeletons, and test verification</li>
              </ul>
            </div>

            {/* Actions */}
            <div className="modal-actions">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="btn-cancel"
              >
                Cancel
              </button>
              <button type="submit" disabled={loading} className="btn-build">
                {loading ? 'Starting…' : 'Build'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <style jsx>{`
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: var(--scrim);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .modal-card {
          width: 100%;
          max-width: 520px;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          max-height: 90vh;
          overflow-y: auto;
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          font-size: 13px;
        }

        .modal-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .modal-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .modal-tag {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .modal-auth-tag {
          font-size: 12px;
        }

        .modal-auth-tag--free {
          color: var(--text-muted);
        }

        .modal-auth-tag--key {
          color: var(--warning);
        }

        .modal-close {
          background: none;
          border: none;
          display: inline-flex;
          color: var(--text-muted);
          cursor: pointer;
          padding: 6px;
          border-radius: 4px;
        }

        .modal-close:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .modal-body {
          padding: 20px;
        }

        .modal-title {
          margin: 0 0 6px;
          font: 500 20px/1.3 var(--font-serif);
          color: var(--text-primary);
        }

        .modal-desc {
          margin: 0 0 16px;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.55;
        }

        .modal-api-meta {
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 18px;
        }

        .meta-row {
          display: flex;
          gap: 8px;
          font-size: 12px;
        }

        .meta-label {
          color: var(--text-muted);
          width: 85px;
          flex-shrink: 0;
        }

        .meta-val {
          color: var(--text-primary);
          word-break: break-all;
        }

        .meta-link {
          color: var(--text-secondary);
          word-break: break-all;
          text-decoration: none;
        }

        .meta-link:hover {
          text-decoration: underline;
        }

        .font-mono {
          font-family: var(--font-mono);
          font-size: 11.5px;
        }

        .modal-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .field-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field-label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .field-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
        }

        .demo-key-btn {
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          color: var(--text-secondary);
          font: 11px var(--font-mono);
          padding: 2px 7px;
          border-radius: 4px;
          cursor: pointer;
        }

        .demo-key-btn:hover {
          background: var(--bg-hover);
        }

        .modal-input {
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-sm);
          padding: 7px 10px;
          color: var(--text-primary);
          font: inherit;
        }

        .field-hint {
          margin: 2px 0 0;
          font-size: 12px;
          color: var(--text-muted);
        }

        .field-hint code {
          background: var(--bg-elevated);
          padding: 1px 4px;
          border-radius: 3px;
          font-family: var(--font-mono);
          color: var(--text-secondary);
        }

        .features-preview {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 10px 14px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .features-preview strong {
          display: block;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .features-preview ul {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 6px;
        }

        .btn-cancel {
          padding: 9px 16px;
          border: 1px solid var(--border-base);
          background: var(--bg-surface);
          color: var(--text-secondary);
          border-radius: var(--radius-md);
          font: inherit;
          cursor: pointer;
        }

        .btn-cancel:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .btn-build {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 20px;
          background: var(--accent);
          color: var(--bg-base);
          border: 1px solid var(--accent);
          border-radius: var(--radius-md);
          font: inherit;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-build:hover:not(:disabled) {
          opacity: 0.9;
        }

        .btn-build:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

      `}</style>
    </div>
  );
}
