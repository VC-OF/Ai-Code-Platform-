'use client';

import { useEffect, useState } from 'react';
import { groupModelOptions } from '@/lib/modelOptions';
import { useCommandPaletteStore } from '@/hooks/useCommandPalette';
import ApiKeyModal from '@/components/ApiKeyModal';
import ArtifactsDrawer from '@/components/artifacts/ArtifactsDrawer';
import KnowledgeModal from '@/components/knowledge/KnowledgeModal';
import type { Project } from '@/types';
import type { AgentStatus } from '@/components/StatusIndicator';
import type { ActiveTab } from '@/app/page';

interface TopBarProps {
  project?:          Project | null;
  activeFile?:       string | null;
  sidebarOpen?:      boolean;
  onSidebarToggle?:  () => void;
  selectedModel?:    string;
  onModelChange?:    (m: string) => void;
  agentStatus?:      AgentStatus;
  editorOpen?:       boolean;
  onEditorToggle?:   () => void;
  previewOpen?:      boolean;
  onPreviewToggle?:  () => void;
  settingsOpen?:     boolean;
  onSettingsToggle?: () => void;
  terminalOpen?:     boolean;
  onTerminalToggle?: () => void;
  explorerOpen?:     boolean;
  onExplorerToggle?: () => void;
  showPreview?:      boolean;
  changedFiles?:     string[];
  activeTab?:        ActiveTab;
  onTabChange?:      (t: ActiveTab) => void;
}

export default function TopBar({
  project,
  sidebarOpen,
  onSidebarToggle,
  selectedModel,
  onModelChange,
  agentStatus,
  editorOpen = true,
  onEditorToggle,
  previewOpen = false,
  onPreviewToggle,
  settingsOpen = false,
  onSettingsToggle,
  terminalOpen = false,
  onTerminalToggle,
  explorerOpen = false,
  onExplorerToggle,
  showPreview = true,
  changedFiles = [],
}: TopBarProps) {
  const [isDark, setIsDark] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [execMode, setExecMode] = useState<string>('auto');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const openPalette = useCommandPaletteStore((s) => s.setOpen);

  // Sync execution mode from localStorage
  useEffect(() => {
    const updateMode = () => {
      setExecMode(localStorage.getItem('oc-execution-mode') || 'auto');
    };
    updateMode();
    const interval = setInterval(updateMode, 1500);
    return () => clearInterval(interval);
  }, []);

  // Apply saved theme on mount (external-system sync from localStorage)
  useEffect(() => {
    const saved = localStorage.getItem('oc-theme') ?? 'light';
    const dark = saved !== 'light';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, []);

  // Live backend health & docker status
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch('/api/health')
        .then((r) => r.json())
        .then((d) => !cancelled && setHealthy(d?.status === 'healthy'))
        .catch(() => !cancelled && setHealthy(false));

      fetch('/api/docker/status')
        .then((r) => r.json())
        .then((d) => !cancelled && setDockerAvailable(d?.available === true))
        .catch(() => !cancelled && setDockerAvailable(false));
    };
    check();
    const t = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const applyTheme = (dark: boolean) => {
    setIsDark(dark);
    const val = dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', val);
    localStorage.setItem('oc-theme', val);
  };
  const toggleTheme = () => applyTheme(!isDark);

  // Slash commands: /theme sets the theme, /login and /logout open the keys modal
  useEffect(() => {
    const onTheme = (e: Event) => {
      const theme = (e as CustomEvent<{ theme?: string }>).detail?.theme;
      if (theme === 'dark' || theme === 'light') {
        setIsDark(theme === 'dark');
      }
    };
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<{ target?: string }>).detail?.target === 'keys') setShowKeyModal(true);
    };
    window.addEventListener('oc-theme-change', onTheme);
    window.addEventListener('oc-open', onOpen);
    return () => {
      window.removeEventListener('oc-theme-change', onTheme);
      window.removeEventListener('oc-open', onOpen);
    };
  }, []);
  const agentActive = !!agentStatus && agentStatus !== 'done' && agentStatus !== 'error';
  const agentLabel =
    agentStatus === 'planning' ? 'Planning…'
    : agentStatus === 'writing' ? 'Writing…'
    : agentStatus === 'reading' ? 'Reading…'
    : agentStatus === 'running' ? 'Running…'
    : `${agentStatus ?? ''}…`;
  const modeLabel = execMode === 'manual' ? 'Manual' : execMode === 'plan' ? 'Plan' : 'Auto';

  return (
    <header className="topbar">
      {/* Left: sidebar toggle, project name, model */}
      <div className="topbar-left">
        <button
          type="button"
          onClick={onSidebarToggle}
          className="icon-btn"
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={16} height={16}>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
        <span className="project-name" title={project?.title ?? 'Open Code'}>
          {project?.title ?? 'Open Code'}
        </span>

        <select
          value={selectedModel}
          onChange={(e) => onModelChange?.(e.target.value)}
          className="model-select"
          title={`Model: ${selectedModel}`}
          aria-label="Model"
        >
          {groupModelOptions().map(([group, options]) => (
            <optgroup key={group} label={group}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <button type="button" onClick={() => setShowKeyModal(true)} className="ghost-btn" title="API keys">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
          <span className="ghost-label">Keys</span>
        </button>
        <button type="button" onClick={() => setShowArtifacts(true)} className="ghost-btn" title="Project artifacts">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <span className="ghost-label">Artifacts</span>
        </button>
        <button type="button" onClick={() => setShowKnowledge(true)} className="ghost-btn" title="Knowledge items">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
            <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
          </svg>
          <span className="ghost-label">Knowledge</span>
        </button>
      </div>

      {/* Middle: command palette trigger */}
      <div className="topbar-middle">
        <button
          type="button"
          className="global-search"
          onClick={() => openPalette(true)}
          title="Open command palette (Ctrl+K)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13} className="search-icon">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <span className="global-search-placeholder">Search commands and projects</span>
          <kbd className="search-kbd">Ctrl K</kbd>
        </button>
      </div>

      {/* Right: panel toggles, status, theme */}
      <div className="topbar-right">
        <span className="meta-text" title={`Execution mode: ${modeLabel}. Switch in the chat controls or with /mode.`}>
          {modeLabel}
        </span>
        <span
          className="meta-text meta-hide-md"
          title={dockerAvailable ? 'Docker sandbox available' : 'Docker unavailable, using host sandbox'}
        >
          {dockerAvailable === null ? 'Docker…' : dockerAvailable ? 'Docker' : 'Host sandbox'}
        </span>

        {agentActive ? (
          <span className="system-status" title={`Agent is ${agentStatus}`} role="status">
            <span className="status-dot status-dot--working" />
            <span>{agentLabel}</span>
          </span>
        ) : (
          <span className="system-status" role="status">
            <span className={`status-dot ${healthy === false ? 'status-dot--down' : healthy ? 'status-dot--ok' : ''}`} />
            <span>{healthy === null ? 'Checking…' : healthy ? 'Online' : 'Backend unreachable'}</span>
          </span>
        )}

        <span className="divider" />

        <button
          type="button"
          className={`icon-btn ${editorOpen ? 'icon-btn--on' : ''}`}
          onClick={onEditorToggle}
          title={editorOpen ? 'Close code editor' : 'Open code editor'}
          aria-label="Toggle code editor"
          aria-pressed={editorOpen}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
            <polyline points="16 18 22 12 16 6" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="8 6 2 12 8 18" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {changedFiles.length > 0 && (
            <span className="logo-badge" title={`${changedFiles.length} files modified`}>
              {changedFiles.length}
            </span>
          )}
        </button>

        {showPreview && (
          <button
            type="button"
            className={`icon-btn ${previewOpen ? 'icon-btn--on' : ''}`}
            onClick={onPreviewToggle}
            title={previewOpen ? 'Close live preview' : 'Open live preview'}
            aria-label="Toggle live preview"
            aria-pressed={previewOpen}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </button>
        )}

        <button
          type="button"
          className={`icon-btn ${terminalOpen ? 'icon-btn--on' : ''}`}
          onClick={onTerminalToggle}
          title={terminalOpen ? 'Close terminal' : 'Open terminal'}
          aria-label="Toggle terminal"
          aria-pressed={terminalOpen}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 17l6-6-6-6M12 19h8" />
          </svg>
        </button>

        {onExplorerToggle && (
          <button
            type="button"
            className={`icon-btn ${explorerOpen ? 'icon-btn--on' : ''}`}
            onClick={onExplorerToggle}
            title={explorerOpen ? 'Hide file explorer' : 'Show file explorer'}
            aria-label="Toggle file explorer"
            aria-pressed={explorerOpen}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
          </button>
        )}

        <button
          type="button"
          className={`icon-btn ${settingsOpen ? 'icon-btn--on' : ''}`}
          onClick={onSettingsToggle}
          title={settingsOpen ? 'Close settings' : 'Project settings'}
          aria-label="Toggle settings"
          aria-pressed={settingsOpen}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        <button
          type="button"
          className="icon-btn"
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle theme"
          onClick={toggleTheme}
        >
          {isDark ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>

        <div className="profile-avatar" title="Profile">A</div>
      </div>

      <style jsx>{`
        .topbar {
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 8px 0 8px;
          gap: 12px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          width: 100%;
          min-width: 0;
          overflow: hidden;
          font-family: var(--font-sans);
          font-size: 13px;
        }
        .topbar-left {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          flex-shrink: 1;
        }
        .project-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 220px;
          margin: 0 8px 0 4px;
        }
        .model-select {
          height: 28px;
          max-width: 150px;
          padding: 0 6px;
          font-size: 12px;
          color: var(--text-secondary);
          background: transparent;
          border: 1px solid transparent;
          border-radius: var(--radius-md);
          cursor: pointer;
          outline: none;
          text-overflow: ellipsis;
        }
        .model-select:hover {
          background: var(--bg-hover);
        }
        .model-select option,
        .model-select optgroup {
          background: var(--bg-surface);
          color: var(--text-primary);
        }
        .ghost-btn {
          height: 28px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0 8px;
          font-size: 12px;
          color: var(--text-secondary);
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          flex-shrink: 0;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .ghost-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .topbar-middle {
          flex: 0 1 360px;
          display: flex;
          min-width: 160px;
        }
        .global-search {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          height: 28px;
          padding: 0 8px 0 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: border-color var(--transition-fast);
        }
        .global-search:hover {
          border-color: var(--border-base);
        }
        .search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .global-search-placeholder {
          flex: 1;
          text-align: left;
          color: var(--text-muted);
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .search-kbd {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 0 4px;
          flex-shrink: 0;
        }
        .topbar-right {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }
        .meta-text {
          font-size: 12px;
          color: var(--text-muted);
          padding: 0 6px;
          white-space: nowrap;
          cursor: default;
        }
        .system-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-secondary);
          padding: 0 8px;
          white-space: nowrap;
        }
        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-disabled);
          flex-shrink: 0;
        }
        .status-dot--ok {
          background: var(--success);
        }
        .status-dot--down {
          background: var(--error);
        }
        .status-dot--working {
          background: var(--accent);
        }
        .divider {
          width: 1px;
          height: 16px;
          background: var(--border-subtle);
          margin: 0 4px;
        }
        .icon-btn {
          position: relative;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: var(--radius-md);
          flex-shrink: 0;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .icon-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }
        .icon-btn--on {
          color: var(--text-primary);
          background: var(--bg-overlay);
        }
        .logo-badge {
          position: absolute;
          top: 1px;
          right: 1px;
          min-width: 13px;
          height: 13px;
          padding: 0 3px;
          border-radius: 999px;
          background: var(--bg-overlay);
          border: 1px solid var(--border-base);
          color: var(--text-secondary);
          font-size: 8.5px;
          font-family: var(--font-mono);
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .profile-avatar {
          width: 24px;
          height: 24px;
          margin-left: 4px;
          border-radius: 50%;
          background: var(--bg-overlay);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 500;
          flex-shrink: 0;
        }
        .icon-btn:focus-visible,
        .ghost-btn:focus-visible,
        .global-search:focus-visible,
        .model-select:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        @media (max-width: 1280px) {
          .ghost-label,
          .meta-hide-md {
            display: none;
          }
        }
        @media (max-width: 1024px) {
          .meta-text,
          .project-name {
            display: none;
          }
        }
      `}</style>

      {showKeyModal && <ApiKeyModal onClose={() => setShowKeyModal(false)} />}

      {showArtifacts && project?.id && (
        <ArtifactsDrawer
          projectId={project.id}
          isOpen={showArtifacts}
          onClose={() => setShowArtifacts(false)}
        />
      )}

      {showKnowledge && project?.id && (
        <KnowledgeModal
          projectId={project.id}
          isOpen={showKnowledge}
          onClose={() => setShowKnowledge(false)}
        />
      )}
    </header>
  );
}
