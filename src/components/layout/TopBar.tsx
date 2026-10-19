'use client';

import { useEffect, useState } from 'react';
import { groupModelOptions } from '@/lib/modelOptions';
import { useCommandPaletteStore } from '@/hooks/useCommandPalette';
import ApiKeyModal from '@/components/ApiKeyModal';
import ArtifactsDrawer from '@/components/artifacts/ArtifactsDrawer';
import KnowledgeModal from '@/components/knowledge/KnowledgeModal';
import ComponentPaletteModal from '@/components/palette/ComponentPaletteModal';
import AuthModal from '@/components/auth/AuthModal';
import ShareModal from '@/components/ShareModal';
import ModeToggle from '@/components/layout/ModeToggle';
import type { SafeUser } from '@/lib/auth';
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
  liveOpen?:         boolean;
  onLiveToggle?:     () => void;
  openChatOpen?:     boolean;
  onOpenChatToggle?: () => void;
  mainView?:         'code' | 'chat';
  onMainViewChange?: (view: 'code' | 'chat') => void;
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
  liveOpen = false,
  onLiveToggle,
  openChatOpen = false,
  onOpenChatToggle,
  mainView = 'code',
  onMainViewChange,
}: TopBarProps) {
  const [isDark, setIsDark] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [execMode, setExecMode] = useState<string>('auto');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<SafeUser | null>(null);
  const [privateMode, setPrivateModeState] = useState(false);
  const openPalette = useCommandPaletteStore((s) => s.setOpen);

  // Sync auth state from /api/auth/me & custom events
  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setCurrentUser(data.user);
      })
      .catch(() => {});

    const handleAuthChange = (e: Event) => {
      const detail = (e as CustomEvent<{ user?: SafeUser | null }>).detail;
      setCurrentUser(detail.user ?? null);
    };
    window.addEventListener('oc-auth-changed', handleAuthChange);
    return () => window.removeEventListener('oc-auth-changed', handleAuthChange);
  }, []);

  // Sync private mode from localStorage & custom events
  useEffect(() => {
    try {
      const saved = localStorage.getItem('opencode_private_mode');
      if (saved !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPrivateModeState(saved === 'true');
      }
    } catch {}

    const handleModeChange = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof detail?.enabled === 'boolean') {
        setPrivateModeState(detail.enabled);
      }
    };
    window.addEventListener('oc-private-mode-changed', handleModeChange);
    return () => window.removeEventListener('oc-private-mode-changed', handleModeChange);
  }, []);

  const togglePrivateMode = () => {
    const next = !privateMode;
    setPrivateModeState(next);
    try {
      localStorage.setItem('opencode_private_mode', String(next));
      window.dispatchEvent(new CustomEvent('oc-private-mode-changed', { detail: { enabled: next } }));
      void fetch('/api/private-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      }).catch(() => {});
    } catch {}
  };

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
      {/* Left: sidebar toggle, back/forward history, segmented mode toggle, session title */}
      <div className="topbar-left">
        <button
          type="button"
          onClick={onSidebarToggle}
          className="icon-btn icon-btn--sidebar"
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={16} height={16}>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>

        <div className="history-nav-group">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') window.history.back();
            }}
            className="icon-btn icon-btn--history"
            title="Go back"
            aria-label="Back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') window.history.forward();
            }}
            className="icon-btn icon-btn--history"
            title="Go forward"
            aria-label="Forward"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <ModeToggle
          activeMode={mainView}
          onModeChange={(mode) => onMainViewChange?.(mode)}
        />

        <span className="project-name" title={project ? project.title : 'New session'}>
          {project ? project.title : 'New session'}
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
        <button type="button" onClick={() => setShowPalette(true)} className="ghost-btn" title="UI Component Palette">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
          <span className="ghost-label">UI Palette</span>
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
        <button
          type="button"
          className={`mode-btn ${execMode === 'manual' ? 'mode-btn--manual' : execMode === 'plan' ? 'mode-btn--plan' : ''}`}
          onClick={() => {
            const nextMode = execMode === 'auto' ? 'manual' : execMode === 'manual' ? 'plan' : 'auto';
            setExecMode(nextMode);
            localStorage.setItem('oc-execution-mode', nextMode);
            window.dispatchEvent(new CustomEvent('oc-execution-mode-changed', { detail: { mode: nextMode } }));
          }}
          title={`Execution Mode: ${modeLabel}. Click to switch: Auto (unattended) → Manual (interactive tool approvals) → Plan (read-only).`}
          aria-label={`Execution mode ${modeLabel}`}
        >
          <span className="mode-dot" />
          <span>{modeLabel}</span>
        </button>
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

        {/* What's new link */}
        <button
          type="button"
          className="ghost-btn whats-new-btn"
          onClick={() => window.dispatchEvent(new CustomEvent('oc-open', { detail: { target: 'upgrade' } }))}
          title="What's new in this release"
        >
          <span>What&apos;s new</span>
        </button>

        {/* Panel Toggles Group: Terminal, Browser, Files */}
        <div className="panel-toggles-cluster">
          <button
            type="button"
            className={`panel-toggle-btn ${terminalOpen ? 'panel-toggle-btn--active' : ''}`}
            onClick={onTerminalToggle}
            title={terminalOpen ? 'Close terminal' : 'Open terminal'}
            aria-label="Toggle terminal"
            aria-pressed={terminalOpen}
          >
            <span className="panel-toggle-font">&gt;_</span>
          </button>

          {showPreview && (
            <button
              type="button"
              className={`panel-toggle-btn ${previewOpen ? 'panel-toggle-btn--active' : ''}`}
              onClick={onPreviewToggle}
              title={previewOpen ? 'Close live browser preview' : 'Open live browser preview'}
              aria-label="Toggle live browser preview"
              aria-pressed={previewOpen}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={14} height={14}>
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </button>
          )}

          {onExplorerToggle && (
            <button
              type="button"
              className={`panel-toggle-btn ${explorerOpen ? 'panel-toggle-btn--active' : ''}`}
              onClick={onExplorerToggle}
              title={explorerOpen ? 'Hide files panel' : 'Show files panel'}
              aria-label="Toggle files panel"
              aria-pressed={explorerOpen}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={14} height={14}>
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
            </button>
          )}
        </div>

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

        <button
          type="button"
          className={`icon-btn icon-btn--openchat ${openChatOpen ? 'icon-btn--on' : ''}`}
          onClick={onOpenChatToggle}
          title={openChatOpen ? 'Close Open Chat beside Open Code' : 'Dock Open Chat beside Open Code'}
          aria-label="Toggle Open Chat beside Open Code"
          aria-pressed={openChatOpen}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>

        {/* Private Mode Toggle */}
        <button
          type="button"
          className={`icon-btn ${privateMode ? 'icon-btn--private-on' : ''}`}
          onClick={togglePrivateMode}
          title={privateMode ? 'Private Mode ON (Local isolation active, private tools enabled, external telemetry suppressed)' : 'Private Mode OFF (Click to enable local isolation & private tools)'}
          aria-label="Toggle Private Mode"
          aria-pressed={privateMode}
          style={privateMode ? {
            color: '#10b981',
            borderColor: 'rgba(16, 185, 129, 0.4)',
            background: 'rgba(16, 185, 129, 0.12)',
            boxShadow: '0 0 10px rgba(16, 185, 129, 0.25)',
          } : undefined}
        >
          <svg viewBox="0 0 24 24" fill={privateMode ? 'rgba(16, 185, 129, 0.25)' : 'none'} stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          {privateMode && (
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              padding: '0 4px',
              borderRadius: '3px',
              background: '#10b981',
              color: '#000',
              marginLeft: '2px',
              lineHeight: '14px',
            }}>
              PVT
            </span>
          )}
        </button>

        {/* Gemini Live Button */}
        <button
          type="button"
          className={`icon-btn icon-btn--gemini-live ${liveOpen ? 'icon-btn--on' : ''}`}
          onClick={onLiveToggle}
          title={liveOpen ? 'Close Gemini Live' : 'Open Gemini Live (real-time voice & screen pair programming)'}
          aria-label="Toggle Gemini Live"
          aria-pressed={liveOpen}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width={14} height={14}>
            <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
          </svg>
          <span className="live-btn-label">Live</span>
        </button>

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

        {/* Share Button (when project is active) */}
        {project?.id && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowShareModal(true)}
            title="Share project & public link"
            aria-label="Share project"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>
        )}

        {/* Profile / Auth Button */}
        <button
          type="button"
          className="profile-btn"
          title={currentUser ? `${currentUser.name} (${currentUser.email})` : 'Sign In / Account Profile'}
          aria-label="Account profile"
          onClick={() => setShowAuthModal(true)}
        >
          <div className={`profile-avatar ${currentUser ? 'profile-avatar--logged-in' : ''}`}>
            {currentUser ? currentUser.name.charAt(0).toUpperCase() : 'A'}
          </div>
        </button>
      </div>

      <style jsx>{`
        .topbar {
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 8px 0 8px;
          gap: 12px;
          background: var(--bg-base);
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
        .icon-btn--openchat {
          color: #38bdf8;
        }
        .icon-btn--openchat:hover {
          color: #7dd3fc;
        }
        .icon-btn--openchat.icon-btn--on {
          background: rgba(56, 189, 248, 0.15);
          border: 1px solid rgba(56, 189, 248, 0.4);
          color: #38bdf8;
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
          font-size: 11px;
          color: var(--text-muted);
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
          flex: 1 1 240px;
          max-width: 320px;
          display: flex;
          min-width: 120px;
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
        .mode-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 500;
          font-family: var(--font-mono);
          padding: 2px 8px;
          margin-right: 4px;
          border-radius: var(--radius-sm);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all var(--transition-fast);
        }
        .mode-btn:hover {
          color: var(--text-primary);
          border-color: var(--border-base);
        }
        .mode-btn .mode-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #3b82f6;
        }
        .mode-btn--manual {
          color: #f59e0b;
          border-color: rgba(245, 158, 11, 0.4);
          background: rgba(245, 158, 11, 0.08);
        }
        .mode-btn--manual .mode-dot {
          background: #f59e0b;
        }
        .mode-btn--plan {
          color: #a855f7;
          border-color: rgba(168, 85, 247, 0.4);
          background: rgba(168, 85, 247, 0.08);
        }
        .mode-btn--plan .mode-dot {
          background: #a855f7;
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
        .icon-btn--gemini-live {
          width: auto;
          padding: 0 8px;
          gap: 5px;
          background: linear-gradient(135deg, rgba(2, 132, 199, 0.15), rgba(139, 92, 246, 0.15));
          border: 1px solid rgba(56, 189, 248, 0.35);
          color: #38bdf8;
        }
        .icon-btn--gemini-live:hover {
          background: linear-gradient(135deg, rgba(2, 132, 199, 0.25), rgba(139, 92, 246, 0.25));
          border-color: rgba(56, 189, 248, 0.6);
          color: #7dd3fc;
          box-shadow: 0 0 10px rgba(56, 189, 248, 0.3);
        }
        .live-btn-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.3px;
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
        .profile-btn {
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          display: flex;
          align-items: center;
          outline: none;
        }
        .profile-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          border-radius: 50%;
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
          transition: transform 0.15s ease;
        }
        .profile-btn:hover .profile-avatar {
          transform: scale(1.08);
        }
        .profile-avatar--logged-in {
          background: linear-gradient(135deg, #3b82f6, #8b5cf6) !important;
          color: #fff !important;
          font-weight: 700;
          box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
        }
        .history-nav-group {
          display: flex;
          align-items: center;
          gap: 1px;
          margin-right: 4px;
        }
        .icon-btn--history {
          width: 24px;
          height: 24px;
          color: var(--text-muted);
        }
        .icon-btn--history:hover {
          color: var(--text-primary);
        }
        .whats-new-btn {
          font-size: 11px;
          color: var(--text-muted);
          padding: 0 8px;
          height: 26px;
        }
        .whats-new-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }
        .panel-toggles-cluster {
          display: flex;
          align-items: center;
          gap: 2px;
          background: rgba(0, 0, 0, 0.03);
          padding: 2px;
          border-radius: 8px;
          border: 1px solid var(--border-subtle);
        }
        :global(html:not([data-theme="light"])) .panel-toggles-cluster {
          background: rgba(255, 255, 255, 0.04);
        }
        .panel-toggle-btn {
          width: 26px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 6px;
          color: var(--text-muted);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .panel-toggle-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }
        .panel-toggle-btn--active {
          background: var(--accent-soft) !important;
          color: var(--brand) !important;
        }
        :global(html:not([data-theme="light"])) .panel-toggle-btn--active {
          background: var(--accent-soft) !important;
          color: var(--brand) !important;
        }
        .panel-toggle-font {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
        }
        .icon-btn:focus-visible,
        .ghost-btn:focus-visible,
        .global-search:focus-visible,
        .model-select:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        @media (max-width: 1560px) {
          .ghost-label,
          .meta-hide-md {
            display: none;
          }
        }
        @media (max-width: 1180px) {
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

      {showPalette && project?.id && (
        <ComponentPaletteModal
          projectId={project.id}
          isOpen={showPalette}
          onClose={() => setShowPalette(false)}
          onSelectPrompt={(prompt) => {
            window.dispatchEvent(new CustomEvent('oc-inject-prompt', { detail: { prompt } }));
          }}
        />
      )}

      {showAuthModal && (
        <AuthModal
          user={currentUser}
          onClose={() => setShowAuthModal(false)}
          onUserChange={(u) => setCurrentUser(u)}
        />
      )}

      {showShareModal && project && (
        <ShareModal
          project={project}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </header>
  );
}
