'use client';

import type { ActiveTab } from '@/app/page';

interface MobileNavProps {
  active:    ActiveTab;
  onChange:  (t: ActiveTab) => void;
  badge?:    number;
}

const TABS: Array<{
  id:    ActiveTab;
  label: string;
  icon:  (active: boolean) => React.ReactNode;
}> = [
  {
    id:    'editor',
    label: 'Code',
    icon:  (a) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d="M7 8l-4 3 4 3M15 8l4 3-4 3M13 5l-4 12"
          stroke="currentColor"
          strokeWidth={a ? '2' : '1.5'}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id:    'preview',
    label: 'Preview',
    icon:  (a) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect
          x="2" y="4" width="18" height="14" rx="2"
          stroke="currentColor"
          strokeWidth={a ? '2' : '1.5'}
        />
        <path
          d="M2 8h18"
          stroke="currentColor"
          strokeWidth={a ? '2' : '1.5'}
        />
        <circle cx="5" cy="6" r="1" fill="currentColor" />
        <circle cx="8" cy="6" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id:    'settings',
    label: 'Settings',
    icon:  (a) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle
          cx="11" cy="11" r="3"
          stroke="currentColor"
          strokeWidth={a ? '2' : '1.5'}
        />
        <path
          d="M11 2v2M11 18v2M2 11h2M18 11h2M4.9 4.9l1.4 1.4M15.7 15.7l1.4 1.4M4.9 17.1l1.4-1.4M15.7 6.3l1.4-1.4"
          stroke="currentColor"
          strokeWidth={a ? '2' : '1.5'}
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export default function MobileNav({
  active,
  onChange,
  badge,
}: MobileNavProps) {
  return (
    <nav className="mob-nav">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`mob-nav-item ${active === tab.id ? 'mob-nav-item--active' : ''}`}
          onClick={() => onChange(tab.id)}
          aria-label={tab.label}
          aria-current={active === tab.id ? 'page' : undefined}
        >
          <div className="mob-nav-icon">
            {tab.icon(active === tab.id)}
            {/* Badge on Code tab */}
            {tab.id === 'editor' && badge && badge > 0 && (
              <span className="mob-nav-badge">{badge}</span>
            )}
          </div>
          <span className="mob-nav-label">{tab.label}</span>
        </button>
      ))}

      <style jsx>{`
        .mob-nav {
          display: flex;
          align-items: center;
          background: var(--bg-surface);
          border-top: 1px solid var(--border-subtle);
          padding-bottom: env(safe-area-inset-bottom, 0);
          flex-shrink: 0;
        }

        .mob-nav-item {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          padding: 10px 4px;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          transition: color var(--transition-fast);
          position: relative;
        }

        .mob-nav-item:active {
          color: var(--text-secondary);
        }

        .mob-nav-item--active {
          color: var(--brand) !important;
        }

        .mob-nav-icon {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .mob-nav-badge {
          position: absolute;
          top: -4px;
          right: -8px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          background: var(--brand);
          border-radius: var(--radius-full);
          font-size: 10px;
          font-weight: 700;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
        }

        .mob-nav-label {
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.02em;
        }
      `}</style>
    </nav>
  );
}
