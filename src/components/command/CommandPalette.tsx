'use client';

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  useCommandPaletteStore,
  filterCommands,
  groupCommands,
  type Command,
} from '@/hooks/useCommandPalette';

// ─── Group display order & labels ─────────────────────────────────────────────
const GROUP_ORDER = [
  'recent',
  'navigation',
  'project',
  'editor',
  'chat',
  'view',
  'system',
];

const GROUP_LABELS: Record<string, string> = {
  recent:     'Recent',
  navigation: 'Navigation',
  project:    'Project',
  editor:     'Editor',
  chat:       'Chat',
  view:       'View',
  system:     'System',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function CommandPalette() {
  const { open, query, commands, setQuery, close } =
    useCommandPaletteStore();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef    = useRef<HTMLInputElement>(null);
  const listRef     = useRef<HTMLDivElement>(null);

  // Filter + group
  const filtered = useMemo(
    () => filterCommands(commands, query),
    [commands, query]
  );

  const grouped = useMemo(
    () => groupCommands(filtered),
    [filtered]
  );

  // Flat list for keyboard navigation
  const flatList = useMemo(
    () =>
      GROUP_ORDER.flatMap((g) => grouped.get(g) ?? []).concat(
        filtered.filter((c) => !GROUP_ORDER.includes(c.group))
      ),
    [grouped, filtered]
  );

  // Reset selection when the query changes (adjust-state-during-render)
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setSelectedIndex(0);
  }

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatList.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = flatList[selectedIndex];
        if (cmd && !cmd.disabled) {
          cmd.action();
          close();
        }
      }
      if (e.key === 'Escape') {
        close();
      }
    },
    [flatList, selectedIndex, close]
  );

  // ── Scroll selected item into view ────────────────────────────────────────
  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="palette-backdrop animate-fade-in"
        onClick={close}
        aria-hidden
      />

      {/* Palette */}
      <div
        className="palette animate-slide-up"
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
      >
        {/* ── Search input ────────────────────────────────────────────── */}
        <div className="palette-search">
          <svg className="palette-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15} aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search…"
            className="palette-input"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="palette-clear"
              onClick={() => setQuery('')}
              aria-label="Clear"
            >
              <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          <kbd className="palette-esc">Esc</kbd>
        </div>

        {/* ── Results ─────────────────────────────────────────────────── */}
        <div
          ref={listRef}
          className="palette-list"
          role="listbox"
        >
          {flatList.length === 0 ? (
            <div className="palette-empty">
              <span>No commands found for</span>
              <code>&quot;{query}&quot;</code>
            </div>
          ) : (
            GROUP_ORDER.map((groupId) => {
              const cmds = grouped.get(groupId);
              if (!cmds?.length) return null;

              return (
                <div key={groupId} className="palette-group">
                  <div className="palette-group-label">
                    {GROUP_LABELS[groupId] ?? groupId}
                  </div>

                  {cmds.map((cmd) => {
                    const flatIdx = flatList.indexOf(cmd);
                    return (
                      <PaletteItem
                        key={cmd.id}
                        command={cmd}
                        selected={flatIdx === selectedIndex}
                        index={flatIdx}
                        onSelect={() => {
                          cmd.action();
                          close();
                        }}
                        onHover={() => setSelectedIndex(flatIdx)}
                      />
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="palette-footer">
          <div className="palette-footer-hints">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>↵</kbd> select</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
          <span className="palette-count">
            {flatList.length} command{flatList.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <style jsx>{`
        .palette-backdrop {
          position: fixed;
          inset: 0;
          background: var(--bg-hover);
          z-index: 998;
        }

        .palette {
          position: fixed;
          top: 15vh;
          left: 50%;
          transform: translateX(-50%);
          width: min(640px, calc(100vw - 32px));
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          z-index: 999;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: 70vh;
        }

        .palette-search {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .palette-search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .palette-input {
          flex: 1;
          background: none;
          border: none;
          color: var(--text-primary);
          font-size: 14px;
          font-family: var(--font-sans);
          outline: none;
          min-width: 0;
        }

        .palette-input::placeholder {
          color: var(--text-muted);
        }

        .palette-clear {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 12px;
          padding: 4px;
          border-radius: var(--radius-sm);
          transition: color var(--transition-fast);
        }

        .palette-clear:hover { color: var(--text-primary); }

        .palette-esc {
          padding: 3px 6px;
          background: var(--bg-overlay);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-sm);
          font-size: 11px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          flex-shrink: 0;
        }

        .palette-list {
          overflow-y: auto;
          flex: 1;
          padding: 8px 0;
        }

        .palette-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 48px 24px;
          color: var(--text-muted);
          font-size: var(--text-sm);
        }

        .palette-empty code {
          color: var(--text-secondary);
          font-family: var(--font-mono);
          background: var(--bg-overlay);
          padding: 2px 8px;
          border-radius: var(--radius-sm);
        }

        .palette-group {
          padding-bottom: 4px;
        }

        .palette-group-label {
          padding: 8px 14px 4px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-muted);
        }

        .palette-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .palette-footer-hints {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 11px;
          color: var(--text-muted);
        }

        .palette-footer-hints kbd {
          padding: 1px 4px;
          background: var(--bg-overlay);
          border: 1px solid var(--border-base);
          border-radius: 3px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-muted);
        }

        .palette-count {
          font-size: 11px;
          color: var(--text-muted);
        }
      `}</style>
    </>
  );
}

// ─── Palette item ─────────────────────────────────────────────────────────────
function PaletteItem({
  command,
  selected,
  index,
  onSelect,
  onHover,
}: {
  command:  Command;
  selected: boolean;
  index:    number;
  onSelect: () => void;
  onHover:  () => void;
}) {
  return (
    <button
      data-index={index}
      className={`palette-item ${selected ? 'palette-item--selected' : ''} ${command.disabled ? 'palette-item--disabled' : ''}`}
      onClick={onSelect}
      onMouseEnter={onHover}
      role="option"
      aria-selected={selected}
      disabled={command.disabled}
    >
      {/* Icon */}
      {command.icon && (
        <span className="item-icon">{command.icon}</span>
      )}

      {/* Label + description */}
      <div className="item-content">
        <span className="item-label">{command.label}</span>
        {command.description && (
          <span className="item-desc">{command.description}</span>
        )}
      </div>

      {/* Shortcut */}
      {command.shortcut && (
        <kbd className="item-shortcut">{command.shortcut}</kbd>
      )}

      <style jsx>{`
        .palette-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: calc(100% - 12px);
          margin: 0 6px;
          min-height: 32px;
          padding: 6px 8px;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          transition: background var(--transition-fast);
          border-radius: var(--radius-md);
        }

        .palette-item:hover:not(:disabled) {
          background: var(--bg-hover);
        }

        .palette-item--selected {
          background: var(--bg-overlay) !important;
        }

        .palette-item:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }

        .palette-item--disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .item-icon {
          font-size: 13px;
          color: var(--text-muted);
          width: 18px;
          text-align: center;
          flex-shrink: 0;
        }

        .item-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }

        .item-label {
          font-size: 13px;
          color: var(--text-primary);
          font-weight: 400;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .item-desc {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .item-shortcut {
          padding: 1px 6px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-sm);
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text-muted);
          flex-shrink: 0;
          white-space: nowrap;
        }

      `}</style>
    </button>
  );
}
