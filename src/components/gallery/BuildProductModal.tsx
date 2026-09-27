'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  createBuildSpec,
  keyInputsFor,
  type BuildProductSpec,
  type BuildTarget,
} from '@/lib/publicApis/buildSpec';
import { isServerSideKeyName } from '@/lib/publicApis/catalog';
import { AuthBadge, KeySavedMark } from './Badges';
import styles from './BuildModal.module.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

const KIND_LABEL: Record<BuildTarget['kind'], string> = {
  idea: 'Product idea',
  api: 'Catalog API',
  starter: 'Starter',
};

interface BuildProductModalProps {
  target: BuildTarget;
  onClose: () => void;
  onConfirm: (spec: BuildProductSpec) => Promise<void>;
}

export default function BuildProductModal({ target, onClose, onConfirm }: BuildProductModalProps) {
  const ids = useId();
  const keyApis = keyInputsFor(target);
  const [projectName, setProjectName] = useState(target.title);
  // Only a provider-documented demo key is ever prefilled
  const [keyValues, setKeyValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      keyInputsFor(target)
        .filter((api) => api.demoKey && !api.keySaved)
        .map((api) => [api.keyEnv, api.demoKey as string])
    )
  );
  const [loading, setLoading] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const keyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!busyRef.current) {
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  const setKey = (keyEnv: string, value: string) => setKeyValues((prev) => ({ ...prev, [keyEnv]: value }));

  // The "Use demo key" button goes away once the demo key is in, so hand focus
  // to its input rather than letting it fall out of the modal
  const applyDemoKey = (keyEnv: string, demoKey: string) => {
    setKey(keyEnv, demoKey);
    keyInputRefs.current[keyEnv]?.focus();
  };

  const missingKeys = keyApis.filter((api) => !api.keySaved && !keyValues[api.keyEnv]?.trim()).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    try {
      await onConfirm(createBuildSpec(target, { title: projectName, keyValues }));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  const titleId = `${ids}-title`;
  const summaryId = `${ids}-summary`;
  const multi = target.apis.length > 1;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busyRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
      >
        <div className={styles.header}>
          <span className={styles.tag}>
            {KIND_LABEL[target.kind]} · {target.category}
          </span>
          <button type="button" onClick={onClose} className={styles.close} aria-label="Close" disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <h2 id={titleId} className={styles.title}>
            {target.title}
          </h2>
          <p id={summaryId} className={styles.summary}>
            {target.summary}
          </p>

          <h3 className={styles.subhead}>{multi ? `${target.apis.length} APIs` : 'API'}</h3>
          <ul className={styles.apiList}>
            {target.apis.map((api) => (
              <li key={`${api.name}-${api.category}`} className={styles.apiRow}>
                <div className={styles.apiMain}>
                  {api.docsUrl ? (
                    <a href={api.docsUrl} target="_blank" rel="noopener noreferrer" className={styles.apiName}>
                      {api.name}
                      <span className={styles.srOnly}> (docs, opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className={styles.apiName}>{api.name}</span>
                  )}
                  <span className={styles.apiMeta}>{api.category}</span>
                </div>
                <div className={styles.apiBadges}>
                  <AuthBadge kind={api.authKind} label={api.authLabel} />
                  {api.keySaved && <KeySavedMark name={api.keySavedAs ?? api.keyEnv} />}
                </div>
                {api.keyEnv && <code className={styles.env}>{api.keyEnv}</code>}
              </li>
            ))}
          </ul>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${ids}-name`}>
                Project name
              </label>
              <input
                ref={nameRef}
                id={`${ids}-name`}
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My API app"
                className={styles.input}
                maxLength={120}
                required
              />
            </div>

            {keyApis.length > 0 && (
              <fieldset className={styles.keys}>
                <legend className={styles.subhead}>API keys (optional)</legend>
                <p className={styles.hint}>
                  Keys are saved encrypted to the new project&apos;s settings. The prompt only names the env var, never
                  the key. Leave a field blank to add it later in Settings.
                </p>
                {keyApis.map((api) => {
                  const inputId = `${ids}-key-${api.keyEnv}`;
                  const hintId = `${inputId}-hint`;
                  const value = keyValues[api.keyEnv] ?? '';
                  const noun = api.authKind === 'oauth' ? 'client ID' : 'key';
                  return (
                    <div key={api.keyEnv} className={styles.field}>
                      <div className={styles.labelRow}>
                        <label className={styles.label} htmlFor={inputId}>
                          {api.name} {noun}
                        </label>
                        {api.demoKey && value !== api.demoKey && (
                          <button
                            type="button"
                            className={styles.demoBtn}
                            onClick={() => applyDemoKey(api.keyEnv, api.demoKey as string)}
                          >
                            Use demo key
                          </button>
                        )}
                      </div>
                      <input
                        ref={(el) => {
                          keyInputRefs.current[api.keyEnv] = el;
                        }}
                        id={inputId}
                        type="password"
                        value={value}
                        onChange={(e) => setKey(api.keyEnv, e.target.value)}
                        placeholder={api.keySaved ? 'Using your saved key' : `Paste your ${api.name} ${noun}`}
                        className={styles.input}
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby={hintId}
                      />
                      <p id={hintId} className={styles.hint}>
                        {api.keySaved && !value.trim() ? (
                          isServerSideKeyName(api.keySavedAs) ? (
                            <>
                              Already saved as <code>{api.keySavedAs}</code>; leave blank to use it. It stays
                              server-side, so the app calls {api.name} through a dev-server proxy.
                            </>
                          ) : (
                            <>
                              Already saved as <code>{api.keySavedAs ?? api.keyEnv}</code>; leave blank to use it.
                            </>
                          )
                        ) : (
                          <>
                            Saved as <code>{api.keyEnv}</code>
                            {api.demoKey && value === api.demoKey ? ' (public demo key, rate-limited)' : ''}.
                          </>
                        )}
                      </p>
                    </div>
                  );
                })}
              </fieldset>
            )}

            <div className={styles.preview}>
              <strong>What the agent will build</strong>
              <ul>
                {target.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>

            <p className={missingKeys ? styles.statusWarn : styles.status} aria-live="polite">
              {missingKeys
                ? `${missingKeys} key${missingKeys === 1 ? '' : 's'} not provided. The app will show a setup hint until you add ${missingKeys === 1 ? 'it' : 'them'} in Settings.`
                : keyApis.length
                  ? 'All keys provided.'
                  : 'No keys needed. The agent connects to the live APIs directly.'}
            </p>

            <div className={styles.actions}>
              <button type="button" onClick={onClose} disabled={loading} className={styles.cancel}>
                Cancel
              </button>
              <button type="submit" disabled={loading} className={styles.build}>
                {loading ? 'Starting…' : 'Build'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
