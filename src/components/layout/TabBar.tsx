'use client';

import type { ActiveTab } from '@/app/page';

interface TabBarProps {
  active:       ActiveTab;
  onChange:     (t: ActiveTab) => void;
  changedFiles: string[];
  /** Build Mode projects (arbitrary folders) don't get a live-preview tab —
   *  there's no assumption the folder is even a runnable web app. */
  showPreview?: boolean;
}

const TABS: Array<{
  id:    ActiveTab;
  label: string;
  icon:  string;
}> = [
  { id: 'editor',   label: 'Code',     icon: '⌨' },
  { id: 'preview',  label: 'Preview',  icon: '⊡' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function TabBar({
  active,
  onChange,
  changedFiles,
  showPreview = true,
}: TabBarProps) {
  const tabs = showPreview ? TABS : TABS.filter((t) => t.id !== 'preview');
  return (
    <div className="tabbar">
      <div className="tabbar-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tabbar-tab ${active === tab.id ? 'tabbar-tab--active' : ''}`}
            onClick={() => onChange(tab.id)}
            role="tab"
            aria-selected={active === tab.id}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>

            {/* Changed files badge on Code tab */}
            {tab.id === 'editor' && changedFiles.length > 0 && (
              <span className="tab-badge">{changedFiles.length}</span>
            )}
          </button>
        ))}
      </div>



      <style jsx>{`
        .tabbar {
          height: var(--tab-bar-height);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          background: var(--bg-surface);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .tabbar-tabs {
          display: flex;
          align-items: center;
          background: var(--bg-base);
          padding: 2px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
        }

        .tabbar-tab {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          background: none;
          border: none;
          border-radius: calc(var(--radius-md) - 2px);
          color: var(--text-muted);
          font-size: var(--text-sm);
          cursor: pointer;
          transition: all var(--transition-fast);
          position: relative;
          white-space: nowrap;
        }

        .tabbar-tab:hover {
          color: var(--text-secondary);
        }

        .tabbar-tab--active {
          color: var(--text-primary) !important;
          background: var(--bg-hover) !important;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }

        .tab-icon { font-size: 11px; }
        .tab-label { font-size: 11px; font-weight: 500; }

        .tab-badge {
          min-width: 15px;
          height: 15px;
          padding: 0 3px;
          background: var(--brand);
          border-radius: var(--radius-full);
          font-size: 9px;
          font-weight: 700;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
          margin-left: 2px;
        }

        .tabbar-hints {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .kbd-hint {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: var(--text-disabled);
        }

        kbd {
          padding: 1px 4px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-base);
          border-radius: 4px;
          font-size: 9px;
          font-family: var(--font-mono);
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
