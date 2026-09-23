'use client';

import { useEffect, useState } from 'react';

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

  useEffect(() => {
    fetch('/api/public-apis')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const handleCategoryClick = (categoryName: string) => {
    if (activeCategory === categoryName) {
      setActiveCategory(null);
      setCategoryItems([]);
      return;
    }
    setActiveCategory(categoryName);
    setLoadingCategory(true);
    fetch(`/api/public-apis?category=${encodeURIComponent(categoryName)}`)
      .then((r) => r.json())
      .then((d) => {
        setCategoryItems(d.entries || []);
        setLoadingCategory(false);
      })
      .catch(() => setLoadingCategory(false));
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
          <span className="api-gallery-kicker">LIVE API CATALOG & PRODUCT GENERATOR</span>
          <h2>Build from the open web</h2>
          <p>
            {data
              ? `Click any of the ${data.catalogSize.toLocaleString()} public APIs or products below to build it instantly with AI.`
              : 'Loading public API ideas and live examples…'}
          </p>
        </div>
        <a
          href="https://github.com/VC-OF/Public-Api-Live-Usage"
          target="_blank"
          rel="noreferrer"
          className="api-catalog-link"
        >
          View catalog ↗
        </a>
      </div>

      {data && (
        <>
          {/* Category Chips */}
          <div className="api-category-row">
            {data.categoryCounts.map((category) => {
              const isActive = activeCategory === category.name;
              return (
                <button
                  type="button"
                  key={category.name}
                  onClick={() => handleCategoryClick(category.name)}
                  className={`api-category-chip ${isActive ? 'api-category-chip--active' : ''}`}
                >
                  {category.name} <b>{category.count}</b>
                </button>
              );
            })}
          </div>

          {/* Expanded Category Browser if a category is selected */}
          {activeCategory && (
            <div className="category-drawer">
              <div className="category-drawer-header">
                <div>
                  <strong>{activeCategory} APIs</strong>
                  <span className="category-drawer-count"> ({categoryItems.length} available)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
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
                          {api.auth && api.auth !== 'No' ? `Key: ${api.auth}` : 'Free'}
                        </span>
                      </div>
                      <p className="cat-api-desc">{api.description}</p>
                      <button
                        type="button"
                        onClick={() => openCatalogItem(api)}
                        className="cat-api-build-btn"
                      >
                        Build with AI →
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
                title={`Click to build a product using ${item.source}`}
              >
                <img src={item.image} alt={item.title} loading="lazy" />
                <div className="api-image-info">
                  <strong>{item.title}</strong>
                  <span>{item.source} • Click to build</span>
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
                    {recipe.auth === 'apiKey' ? '🔑 Key needed' : '🟢 Free API'}
                  </span>
                </div>
                <strong className="api-recipe-title">{recipe.title}</strong>
                <p className="api-recipe-desc">{recipe.description}</p>
                <div className="recipe-card-bottom">
                  <span className="api-recipe-api">{recipe.api}</span>
                  <span className="recipe-build-cta">Build product →</span>
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
        .api-gallery {
          width: 100%;
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

        .api-gallery-kicker {
          color: var(--brand);
          font: 700 9px/1 var(--font-mono);
          letter-spacing: 0.12em;
        }

        h2 {
          margin: 7px 0 4px;
          font: 600 18px/1.2 var(--font-brand);
          color: var(--text-primary);
        }

        .api-gallery-head p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 11.5px;
        }

        .api-catalog-link {
          color: var(--brand);
          font: 600 11px var(--font-mono);
          white-space: nowrap;
          text-decoration: none;
        }

        .api-catalog-link:hover {
          text-decoration: underline;
        }

        .api-category-row {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding-bottom: 4px;
          scrollbar-width: thin;
        }

        .api-category-chip {
          flex: 0 0 auto;
          padding: 6px 10px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-full);
          color: var(--text-secondary);
          background: var(--bg-surface);
          font-size: 10.5px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .api-category-chip:hover {
          border-color: var(--border-base);
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .api-category-chip--active {
          background: var(--brand-glow) !important;
          border-color: var(--accent-border) !important;
          color: var(--brand) !important;
          font-weight: 600;
        }

        .api-category-chip b {
          color: var(--brand);
          font-family: var(--font-mono);
          margin-left: 3px;
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
          font-size: 11px;
        }

        .category-drawer-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
        }

        .category-drawer-close:hover {
          color: var(--text-primary);
        }

        .category-drawer-loading {
          padding: 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 11px;
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
          font-size: 11.5px;
          color: var(--text-primary);
        }

        .cat-api-auth {
          font-size: 9px;
          font-family: var(--font-mono);
          padding: 2px 5px;
          border-radius: 4px;
        }

        .cat-api-auth--free {
          background: rgba(34, 197, 94, 0.12);
          color: #22c55e;
        }

        .cat-api-auth--key {
          background: rgba(234, 179, 8, 0.15);
          color: #eab308;
        }

        .cat-api-desc {
          margin: 0;
          color: var(--text-muted);
          font-size: 10px;
          line-height: 1.4;
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
          color: var(--brand);
          font-size: 10px;
          font-weight: 600;
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
          border-color: var(--accent-border);
          transform: translateY(-2px);
          box-shadow: var(--shadow-sm);
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
          font-size: 10.5px;
          color: var(--text-primary);
        }

        .api-image-info span {
          font: 9.5px var(--font-mono);
          color: var(--brand);
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
          border-color: var(--accent-border);
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
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
          font: 600 9.5px var(--font-mono);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .recipe-auth-pill {
          font-size: 9px;
          font-family: var(--font-mono);
          padding: 2px 6px;
          border-radius: var(--radius-full);
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
          font-weight: 500;
        }

        .recipe-auth-pill--key {
          background: rgba(234, 179, 8, 0.12);
          color: #eab308;
        }

        .api-recipe-title {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 6px;
        }

        .api-recipe-desc {
          flex: 1;
          min-height: 40px;
          margin: 0 0 12px;
          color: var(--text-secondary);
          font-size: 10.5px;
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
          font: 9.5px var(--font-mono);
        }

        .recipe-build-cta {
          color: var(--brand);
          font: 600 10.5px var(--font-sans);
          transition: transform var(--transition-fast);
        }

        .api-recipe-card:hover .recipe-build-cta {
          transform: translateX(2px);
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
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-left">
            <span className="modal-tag">{product.category}</span>
            <span
              className={`modal-auth-tag ${
                product.auth === 'apiKey' ? 'modal-auth-tag--key' : 'modal-auth-tag--free'
              }`}
            >
              {product.auth === 'apiKey' ? '🔑 Requires API Key' : '🟢 Free Public API'}
            </span>
          </div>
          <button type="button" onClick={onClose} className="modal-close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <h3 className="modal-title">{product.title}</h3>
          <p className="modal-desc">{product.description}</p>

          <div className="modal-api-meta">
            <div className="meta-row">
              <span className="meta-label">Provider:</span>
              <span className="meta-val">{product.api}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Endpoint:</span>
              <span className="meta-val font-mono">{product.endpoint}</span>
            </div>
            {product.docsUrl && (
              <div className="meta-row">
                <span className="meta-label">Documentation:</span>
                <a
                  href={product.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="meta-link"
                >
                  {product.docsUrl} ↗
                </a>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="modal-form">
            {/* Project Name */}
            <div className="field-group">
              <label className="field-label">Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My API Application…"
                className="modal-input"
                required
              />
            </div>

            {/* API Key configuration */}
            <div className="field-group">
              <div className="field-label-row">
                <label className="field-label">
                  {product.auth === 'apiKey' ? 'API Key *' : 'API Key (Optional)'}
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
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={`Enter ${product.api} API key…`}
                    className="modal-input"
                    required={!product.demoKey}
                  />
                  <p className="field-hint">
                    Key will be saved to your encrypted project settings as{' '}
                    <code>{product.keyEnv || 'VITE_API_KEY'}</code> and provided to the LLM agent.
                  </p>
                </>
              ) : (
                <div className="free-api-notice">
                  <div className="free-icon">✓</div>
                  <div className="free-text">
                    <strong>100% Free Public API</strong>
                    <span>No API key required. The AI agent will connect to the live endpoint immediately.</span>
                  </div>
                </div>
              )}
            </div>

            {/* Features preview */}
            <div className="features-preview">
              <strong>What the AI agent will build:</strong>
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
                {loading ? (
                  <>
                    <span className="spinner" />
                    <span>Configuring & Launching…</span>
                  </>
                ) : (
                  <>
                    <span>🚀</span>
                    <span>Build Product with AI</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <style jsx>{`
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(4px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: fade-in 0.15s ease forwards;
        }

        .modal-card {
          width: 100%;
          max-width: 520px;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          overflow: hidden;
          animation: scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
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
          font: 600 10px var(--font-mono);
          text-transform: uppercase;
          color: var(--brand);
          background: var(--brand-glow);
          border: 1px solid var(--accent-border);
          padding: 3px 8px;
          border-radius: var(--radius-full);
        }

        .modal-auth-tag {
          font: 500 10px var(--font-mono);
          padding: 3px 8px;
          border-radius: var(--radius-full);
        }

        .modal-auth-tag--free {
          background: rgba(34, 197, 94, 0.12);
          color: #22c55e;
        }

        .modal-auth-tag--key {
          background: rgba(234, 179, 8, 0.15);
          color: #eab308;
        }

        .modal-close {
          background: none;
          border: none;
          font-size: 14px;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
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
          font: 600 18px var(--font-brand);
          color: var(--text-primary);
        }

        .modal-desc {
          margin: 0 0 16px;
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.5;
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
          font-size: 11px;
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
          color: var(--brand);
          text-decoration: none;
        }

        .meta-link:hover {
          text-decoration: underline;
        }

        .font-mono {
          font-family: var(--font-mono);
          font-size: 10px;
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
          font-size: 11.5px;
          font-weight: 500;
          color: var(--text-secondary);
        }

        .demo-key-btn {
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          color: var(--brand);
          font: 600 10px var(--font-mono);
          padding: 2px 7px;
          border-radius: 4px;
          cursor: pointer;
        }

        .demo-key-btn:hover {
          background: var(--bg-hover);
        }

        .modal-input {
          background: var(--bg-base);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          padding: 9px 12px;
          color: var(--text-primary);
          font-size: 12.5px;
          outline: none;
          transition: border-color var(--transition-fast);
        }

        .modal-input:focus {
          border-color: var(--brand);
          box-shadow: 0 0 0 1px var(--brand);
        }

        .field-hint {
          margin: 2px 0 0;
          font-size: 10px;
          color: var(--text-muted);
        }

        .field-hint code {
          background: var(--bg-elevated);
          padding: 1px 4px;
          border-radius: 3px;
          font-family: var(--font-mono);
          color: var(--brand);
        }

        .free-api-notice {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: var(--radius-md);
          background: rgba(34, 197, 94, 0.08);
          border: 1px solid rgba(34, 197, 94, 0.2);
        }

        .free-icon {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #22c55e;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          flex-shrink: 0;
        }

        .free-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .free-text strong {
          font-size: 11px;
          color: #22c55e;
        }

        .free-text span {
          font-size: 10px;
          color: var(--text-secondary);
        }

        .features-preview {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 10px 14px;
          font-size: 11px;
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
          font-size: 12px;
          font-weight: 500;
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
          background: var(--brand);
          color: #fffaf7;
          border: none;
          border-radius: var(--radius-md);
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-build:hover:not(:disabled) {
          background: var(--brand-dim);
          transform: translateY(-1px);
        }

        .btn-build:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .spinner {
          width: 13px;
          height: 13px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
