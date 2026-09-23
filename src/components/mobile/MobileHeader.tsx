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
  planning:      '#3b82f6',
  reading:       '#eab308',
  writing:       '#22c55e',
  testing:       '#a855f7',
  linting:       '#f97316',
  running:       '#06b6d4',
  waiting:       '#f59e0b',
  compacting:    '#6366f1',
  done:          '#22c55e',
  error:         '#ef4444',
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
            style={{
              background:  STATUS_DOT[status] || '#52525b',
              animation:   isActive ? 'pulse-soft 1.5s ease infinite' : 'none',
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
          height: 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
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
          transition: all var(--transition-fast);
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
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .mob-project-name {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
          max-width: 160px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </header>
  );
}
