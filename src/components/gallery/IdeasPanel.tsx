'use client';

import { useId, useState } from 'react';
import type { ResolvedIdea } from '@/lib/publicApis/ideas';
import { AuthBadge, KeySavedMark, ReadinessBadge } from './Badges';
import styles from './Gallery.module.css';

type IdeaFilter = 'all' | 'ready';

interface IdeasPanelProps {
  ideas: ResolvedIdea[] | null;
  error: boolean;
  onRetry: () => void;
  onBuild: (idea: ResolvedIdea) => void;
}

export default function IdeasPanel({ ideas, error, onRetry, onBuild }: IdeasPanelProps) {
  const [filter, setFilter] = useState<IdeaFilter>('all');
  const filterName = useId();

  if (error && !ideas) {
    return (
      <div className={styles.errorBox} role="alert">
        Couldn&apos;t load product ideas.{' '}
        <button type="button" className={styles.linkBtn} onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (!ideas) {
    return (
      <>
        <p role="status" className={styles.srOnly}>
          Loading product ideas…
        </p>
        <div className={styles.grid} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      </>
    );
  }

  const readyCount = ideas.filter((idea) => idea.readiness === 'ready').length;
  const shown = filter === 'ready' ? ideas.filter((idea) => idea.readiness === 'ready') : ideas;

  return (
    <>
      <div className={styles.toolbar}>
        <p className={styles.note}>
          Products that combine APIs from the catalog. Pick one and the agent builds it end to end.
        </p>
        <fieldset className={styles.fieldset}>
          <legend className={styles.srOnly}>Show ideas</legend>
          <div className={styles.segmented}>
            {(
              [
                ['all', `All ${ideas.length}`],
                ['ready', `Ready now ${readyCount}`],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={styles.segment}>
                <input
                  type="radio"
                  name={filterName}
                  value={value}
                  checked={filter === value}
                  onChange={() => setFilter(value)}
                  className={styles.segmentInput}
                />
                <span className={styles.segmentLabel}>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {shown.length === 0 ? (
        <p className={styles.empty}>No idea is ready without keys yet. Save an API key in Settings to unlock more.</p>
      ) : (
        <div className={styles.grid}>
          {shown.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} onBuild={onBuild} />
          ))}
        </div>
      )}
    </>
  );
}

function IdeaCard({ idea, onBuild }: { idea: ResolvedIdea; onBuild: (idea: ResolvedIdea) => void }) {
  const titleId = `idea-${idea.id}-title`;
  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <div className={styles.cardTop}>
        <h3 id={titleId} className={styles.cardTitle}>
          {idea.title}
        </h3>
        <ReadinessBadge readiness={idea.readiness} neededKeys={idea.neededKeys.length} />
      </div>
      <p className={styles.pitch}>{idea.pitch}</p>
      <ul className={styles.chips} aria-label="APIs used">
        {idea.apis.map((api) => (
          <li key={api.id} className={styles.chip} title={`${api.category}${api.description ? `: ${api.description}` : ''}`}>
            <span className={styles.chipName}>{api.name}</span>
            <AuthBadge kind={api.authKind} label={api.authLabel} />
            {api.keySaved && <KeySavedMark name={api.keySavedAs} />}
          </li>
        ))}
      </ul>
      <ul className={styles.features}>
        {idea.features.slice(0, 3).map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <div className={styles.cardFoot}>
        <span className={styles.audience}>{idea.audience}</span>
        <button type="button" className={styles.primaryBtn} onClick={() => onBuild(idea)} aria-describedby={titleId}>
          Build this
        </button>
      </div>
    </article>
  );
}
