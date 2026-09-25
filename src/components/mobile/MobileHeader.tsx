'use client';

import type { Project } from '@/types';
import type { AgentStatus } from '../StatusIndicator';

interface MobileHeaderProps {
  project?:       Project | null;
  status:         AgentStatus;
  onMenuOpen:     () => void;
  onPaletteOpen:  () => void;
}

const STATUS_DOT: Record<AgentStatus, string> = {
  planning:   'var(--accent)',
  reading:    'var(--accent)',
  writing:    'var(--accent)',
  testing:    'var(--accent)',
  linting:    'var(--accent)',
  running:    'var(--accent)',
  waiting:    'var(--warning)',
  compacting: 'var(--accent)',
  done:       'var(--success)',
  error:      'var(--error)',
};

const IS_ACTIVE: AgentStatus[] = [
  'planning','reading','writing','testing',
  'linting','running','waiting','compacting',
];

export default function MobileHeader({
  project,
  status,
  onMenuOpen,
  onPaletteOpen,
}: MobileHeaderProps) {
  const isActive = IS_ACTIVE.includes(status);
  const statusLabel = isActive ? `Agent ${status}` : status === 'error' ? 'Agent error' : 'Idle';

  return (
    <header className="mob-header">
      {/* Menu button */}
      <button
        className="mob-icon-btn"
        onClick={onMenuOpen}
        aria-label="Open menu"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M2 4h14M2 9h14M2 14h14"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Project name + status */}
      <div className="mob-title">
        <div className="mob-status-row">
          <span
            className="mob-status-dot"
            title={statusLabel}
            role="img"
            aria-label={statusLabel}
            style={{
              background: STATUS_DOT[status] || 'var(--text-disabled)',
            }}
          />
          <span className="mob-project-name">
            {project?.title ?? 'Open Code'}
          </span>
        </div>
      </div>

      {/* Search / palette */}
      <button
        className="mob-icon-btn"
        onClick={onPaletteOpen}
        aria-label="Search commands"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="8" cy="8" r="5.5"
            stroke="currentColor" strokeWidth="1.5"/>
          <path d="M12.5 12.5L16 16"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      <style jsx>{`
        .mob-header {
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 8px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .mob-icon-btn {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: var(--radius-md);
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .mob-icon-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        .mob-icon-btn:active {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .mob-title {
          flex: 1;
          display: flex;
          justify-content: center;
        }

        .mob-status-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .mob-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .mob-project-name {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
          max-width: 200px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </header>
  );
}
