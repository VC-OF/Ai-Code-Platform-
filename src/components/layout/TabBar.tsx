'use client';

import { useCommandPaletteStore } from '@/hooks/useCommandPalette';
import type { ActiveTab } from '@/app/page';

interface TabBarProps {
  active:            ActiveTab;
  onChange:          (t: ActiveTab) => void;
  changedFiles:      string[];
  /** Build Mode projects (arbitrary folders) don't get a live-preview tab */
  showPreview?:      boolean;
  explorerOpen?:     boolean;
  onExplorerToggle?: () => void;
}

export default function TabBar({
  active,
  onChange,
  changedFiles,
  showPreview = true,
  explorerOpen = false,
  onExplorerToggle,
}: TabBarProps) {
  const openPalette = useCommandPaletteStore((s) => s.setOpen);

  const handleTabToggle = (target: ActiveTab) => {
    if (active === target) {
      // If already open (e.g. preview or settings), toggle back to editor (closed)
      if (target !== 'editor') {
        onChange('editor');
      }
    } else {
      onChange(target);
    }
  };

  const handleTerminalClick = () => {
    window.dispatchEvent(new CustomEvent('oc-toggle-terminal'));
    const inputEl = document.querySelector('.input-textarea') as HTMLTextAreaElement;
    if (inputEl) inputEl.focus();
  };

  return (
    <div className="tabbar">
      {/* ── Left: View Logos (Code, Preview, Settings) ────────────────── */}
      <div className="tabbar-left-logos">
        {/* 1. Code Editor Logo (</>) */}
        <button
          type="button"
          className={`tabbar-logo-btn ${active === 'editor' ? 'tabbar-logo-btn--active' : ''}`}
          onClick={() => handleTabToggle('editor')}
          title="Code editor"
          aria-label="Code editor"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
            <polyline points="16 18 22 12 16 6" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="8 6 2 12 8 18" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {changedFiles.length > 0 && (
            <span className="tab-badge" title={`${changedFiles.length} files modified`}>
              {changedFiles.length}
            </span>
          )}
        </button>

        {/* 2. Live Web Preview Logo (🌐) - Click to open, click again to close */}
        {showPreview && (
          <button
            type="button"
            className={`tabbar-logo-btn ${active === 'preview' ? 'tabbar-logo-btn--active' : ''}`}
            onClick={() => handleTabToggle('preview')}
            title={active === 'preview' ? "Close live preview" : "Open live preview"}
            aria-label="Toggle live preview"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={16} height={16}>
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </button>
        )}

        {/* 3. Settings Logo (⚙) - Click to open, click again to close */}
        <button
          type="button"
          className={`tabbar-logo-btn ${active === 'settings' ? 'tabbar-logo-btn--active' : ''}`}
          onClick={() => handleTabToggle('settings')}
          title={active === 'settings' ? "Close settings" : "Project settings"}
          aria-label="Toggle settings"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={16} height={16}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* ── Right: Tool Logos (>_, [±], ⋮) ───────────────────────────── */}
      <div className="tabbar-right-logos">
        {/* 4. Terminal Logo (>_) */}
        <button
          type="button"
          className="tabbar-logo-btn"
          onClick={handleTerminalClick}
          title="Terminal"
          aria-label="Toggle terminal"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} width={15} height={15}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 17l6-6-6-6M12 19h8" />
          </svg>
        </button>

        {/* 5. Sidebar / File Explorer Toggle Logo ([±]) - Click to open, click again to close */}
        {onExplorerToggle && (
          <button
            type="button"
            className={`tabbar-logo-btn ${explorerOpen ? 'tabbar-logo-btn--active' : ''}`}
            onClick={onExplorerToggle}
            title={explorerOpen ? "Hide file explorer" : "Show file explorer"}
            aria-label="Toggle file explorer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} width={16} height={16}>
              <rect x="3" y="3" width="18" height="18" rx="2.5" />
              <path strokeLinecap="round" d="M12 7v4M10 9h4" />
              <path strokeLinecap="round" d="M10 15h4" />
            </svg>
          </button>
        )}

        {/* 6. More Options / Command Palette Logo (⋮) */}
        <button
          type="button"
          className="tabbar-logo-btn"
          onClick={() => openPalette(true)}
          title="Command palette (Ctrl+K)"
          aria-label="More actions"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width={15} height={15}>
            <circle cx="12" cy="5" r="1.75" />
            <circle cx="12" cy="12" r="1.75" />
            <circle cx="12" cy="19" r="1.75" />
          </svg>
        </button>
      </div>

      <style jsx>{`
        .tabbar {
          height: var(--tab-bar-height);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 8px;
          gap: 8px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          min-width: 0;
          overflow: hidden;
        }
        .tabbar-left-logos,
        .tabbar-right-logos {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }
        .tabbar-logo-btn {
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-md);
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
          user-select: none;
          padding: 0;
          position: relative;
        }
        .tabbar-logo-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .tabbar-logo-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        .tabbar-logo-btn--active {
          color: var(--text-primary);
          background: var(--bg-overlay);
        }
        .tab-badge {
          position: absolute;
          top: 0;
          right: 0;
          min-width: 13px;
          height: 13px;
          padding: 0 3px;
          background: var(--bg-overlay);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-full);
          font-size: 8.5px;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
        }
      `}</style>
    </div>
  );
}
