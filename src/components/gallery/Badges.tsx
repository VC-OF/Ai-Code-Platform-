import type { AuthKind, CorsSupport } from '@/lib/publicApis/catalog';
import type { IdeaReadiness } from '@/lib/publicApis/ideas';
import styles from './Gallery.module.css';

const AUTH_CLASS: Record<AuthKind, string> = {
  none: styles.authNone,
  apiKey: styles.authApiKey,
  oauth: styles.authOauth,
  other: styles.authOther,
};

export function authText(kind: AuthKind, label?: string): string {
  switch (kind) {
    case 'none':
      return 'No key';
    case 'apiKey':
      return 'API key';
    case 'oauth':
      return 'OAuth';
    case 'other':
      return label && label !== 'No' ? label : 'Other auth';
  }
}

export function AuthBadge({ kind, label }: { kind: AuthKind; label?: string }) {
  return <span className={`${styles.badge} ${AUTH_CLASS[kind]}`}>{authText(kind, label)}</span>;
}

export function HttpsBadge({ https }: { https: boolean }) {
  return (
    <span className={`${styles.badge} ${https ? styles.flagNeutral : styles.flagWarn}`}>
      {https ? 'HTTPS' : 'HTTP only'}
    </span>
  );
}

const CORS_TEXT: Record<CorsSupport, string> = { yes: 'CORS', no: 'No CORS', unknown: 'CORS unknown' };

export function CorsBadge({ cors }: { cors: CorsSupport }) {
  const cls = cors === 'yes' ? styles.flagNeutral : cors === 'no' ? styles.flagWarn : styles.flagMuted;
  return <span className={`${styles.badge} ${cls}`}>{CORS_TEXT[cors]}</span>;
}

export function KeySavedMark({ name }: { name?: string }) {
  return (
    <span className={`${styles.badge} ${styles.keySaved}`} title={name ? `Saved in Settings as ${name}` : undefined}>
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 8.5l3.2 3L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      key saved
    </span>
  );
}

export function ReadinessBadge({ readiness, neededKeys }: { readiness: IdeaReadiness; neededKeys: number }) {
  if (readiness === 'ready') return <span className={`${styles.badge} ${styles.ready}`}>Ready to build</span>;
  return (
    <span className={`${styles.badge} ${styles.needsKeys}`}>
      Needs {neededKeys} key{neededKeys === 1 ? '' : 's'}
    </span>
  );
}
