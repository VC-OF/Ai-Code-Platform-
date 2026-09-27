'use client';

import type { StarterRecipe } from '@/lib/publicApis/recipes';
import { AuthBadge, KeySavedMark } from './Badges';
import type { LiveItem } from './types';
import styles from './Gallery.module.css';

interface StartersPanelProps {
  recipes: StarterRecipe[] | null;
  live: LiveItem[];
  error: boolean;
  onRetry: () => void;
  onBuildRecipe: (recipe: StarterRecipe) => void;
  onBuildLive: (item: LiveItem) => void;
}

const RECIPE_AUTH = { none: 'none', apiKey: 'apiKey', OAuth: 'oauth' } as const;

export default function StartersPanel({ recipes, live, error, onRetry, onBuildRecipe, onBuildLive }: StartersPanelProps) {
  if (error && !recipes) {
    return (
      <div className={styles.errorBox} role="alert">
        Couldn&apos;t load the starters.{' '}
        <button type="button" className={styles.linkBtn} onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (!recipes) {
    return (
      <>
        <p role="status" className={styles.srOnly}>
          Loading starters…
        </p>
        <div className={`${styles.grid} ${styles.gridCompact}`} aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <p className={styles.note}>Single-API starters with hand-checked endpoints.</p>
      <div className={`${styles.grid} ${styles.gridCompact}`}>
        {recipes.map((recipe) => (
          <button
            type="button"
            key={recipe.title}
            onClick={() => onBuildRecipe(recipe)}
            className={`${styles.card} ${styles.recipeCard}`}
          >
            <span className={styles.cardTop}>
              <span className={styles.audience}>{recipe.category}</span>
              <span className={styles.badges}>
                <AuthBadge kind={RECIPE_AUTH[recipe.auth]} />
                {recipe.keySaved && <KeySavedMark name={recipe.keySavedAs ?? recipe.keyEnv} />}
              </span>
            </span>
            <strong className={styles.cardTitle}>{recipe.title}</strong>
            <span className={styles.pitch}>{recipe.description}</span>
            <span className={styles.cardFoot}>
              <span className={styles.recipeApi}>{recipe.api}</span>
              <span className={styles.recipeCta} aria-hidden="true">
                Build
              </span>
            </span>
          </button>
        ))}
      </div>

      {live.length > 0 && (
        <>
          <h3 className={styles.sectionLabel}>Live right now from these APIs</h3>
          <div className={styles.rail}>
            {live.map((item) => (
              <button
                type="button"
                key={`${item.source}-${item.id ?? item.title}`}
                className={styles.railCard}
                onClick={() => onBuildLive(item)}
                title={`Build a product with ${item.source}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- remote demo thumbnails from arbitrary hosts */}
                {item.image && <img src={item.image} alt="" loading="lazy" />}
                <span className={styles.railCaption}>{item.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
