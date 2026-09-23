'use client';

import { useEffect, useState } from 'react';

type GalleryData = {
  source: string;
  catalogSize: number;
  categoryCounts: { name: string; count: number }[];
  recipes: { title: string; api: string; category: string; description: string; endpoint: string }[];
  live: {
    images: { id: string; title: string; image: string; source: string }[];
    meals: { id: string; title: string; image: string; source: string }[];
    pokemon: { title: string; source: string; endpoint: string }[];
  };
};

export default function PublicApiGallery() {
  const [data, setData] = useState<GalleryData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/public-apis')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return null;

  return (
    <section className="api-gallery" aria-label="Public API product gallery">
      <div className="api-gallery-head">
        <div>
          <span className="api-gallery-kicker">LIVE API CATALOG</span>
          <h2>Build from the open web</h2>
          <p>{data ? `${data.catalogSize.toLocaleString()} public APIs mapped to real product ideas.` : 'Loading public API ideas and live examples…'}</p>
        </div>
        <a href="https://github.com/VC-OF/Public-Api-Live-Usage" target="_blank" rel="noreferrer">View catalog ↗</a>
      </div>

      {data && (
        <>
          <div className="api-category-row">
            {data.categoryCounts.map((category) => (
              <span key={category.name} className="api-category-chip">{category.name} <b>{category.count}</b></span>
            ))}
          </div>

          <div className="api-image-rail" aria-label="Live image examples">
            {[...data.live.images, ...data.live.meals].map((item) => (
              <article key={`${item.source}-${item.id}`} className="api-image-card">
                <img src={item.image} alt={item.title} loading="lazy" />
                <div><strong>{item.title}</strong><span>{item.source}</span></div>
              </article>
            ))}
          </div>

          <div className="api-recipe-grid">
            {data.recipes.map((recipe) => (
              <a key={recipe.title} href={recipe.endpoint} target="_blank" rel="noreferrer" className="api-recipe-card">
                <span className="api-recipe-category">{recipe.category}</span>
                <strong>{recipe.title}</strong>
                <p>{recipe.description}</p>
                <span className="api-recipe-api">{recipe.api} ↗</span>
              </a>
            ))}
          </div>
        </>
      )}

      <style jsx>{`
        .api-gallery { width: 100%; display: flex; flex-direction: column; gap: 14px; padding: 4px 0 28px; }
        .api-gallery-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
        .api-gallery-kicker { color: var(--brand); font: 700 9px/1 var(--font-mono); letter-spacing: .12em; }
        h2 { margin: 7px 0 4px; font: 600 17px/1.2 var(--font-brand); color: var(--text-primary); }
        .api-gallery-head p { margin: 0; color: var(--text-muted); font-size: 11px; }
        .api-gallery-head a { color: var(--brand); font: 600 11px var(--font-mono); white-space: nowrap; }
        .api-category-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
        .api-category-chip { flex: 0 0 auto; padding: 5px 8px; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); color: var(--text-secondary); background: var(--bg-surface); font-size: 10px; }
        .api-category-chip b { color: var(--brand); font-family: var(--font-mono); margin-left: 3px; }
        .api-image-rail { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x proximity; padding-bottom: 5px; scrollbar-width: thin; }
        .api-image-card { flex: 0 0 154px; scroll-snap-align: start; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); }
        .api-image-card img { width: 100%; height: 100px; display: block; object-fit: cover; background: var(--bg-elevated); }
        .api-image-card div { display: flex; flex-direction: column; gap: 3px; padding: 8px; }
        .api-image-card strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--text-primary); }
        .api-image-card span { font: 9px var(--font-mono); color: var(--text-muted); }
        .api-recipe-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        .api-recipe-card { min-width: 0; padding: 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); color: inherit; transition: border-color var(--transition-fast), transform var(--transition-fast); }
        .api-recipe-card:hover { border-color: var(--accent-border); transform: translateY(-1px); }
        .api-recipe-category, .api-recipe-api { display: block; color: var(--brand); font: 9px var(--font-mono); }
        .api-recipe-card strong { display: block; margin: 6px 0 4px; font-size: 12px; }
        .api-recipe-card p { min-height: 40px; margin: 0 0 10px; color: var(--text-muted); font-size: 10px; line-height: 1.45; }
        @media (max-width: 800px) { .api-recipe-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .api-gallery-head { align-items: flex-start; flex-direction: column; gap: 8px; } }
      `}</style>
    </section>
  );
}
