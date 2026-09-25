'use client';

import { useEffect, useState } from 'react';
import { useCommandPaletteStore } from '@/hooks/useCommandPalette';
import ApiKeyModal from '@/components/ApiKeyModal';
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
  activeFile,
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
  activeTab,
  onTabChange,
}: TopBarProps) {
  const [isDark, setIsDark] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [execMode, setExecMode] = useState<string>('auto');
  const [showKeyModal, setShowKeyModal] = useState(false);
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

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    const val = next ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', val);
    localStorage.setItem('oc-theme', val);
  };
  return (
    <header className="topbar">
      {/* Left: Brand logo & Workspace title */}
      <div className="topbar-left flex items-center gap-2">
        <button
          onClick={onSidebarToggle}
          className="icon-btn mr-2"
          title={sidebarOpen ? "Close Sidebar" : "Open Sidebar"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="brand-logo">
          <svg viewBox="0 0 24 24" fill="none" width={18} height={18}>
            <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="black" />
          </svg>
        </div>
        <div className="brand-text">
          <span className="brand-name">Open Code</span>
          <span className="brand-sub">Agent Workspace</span>
        </div>
        <div className="topbar-cluster flex items-center gap-1.5 shrink min-w-0">
          <select
            value={selectedModel}
            onChange={(e) => onModelChange?.(e.target.value)}
            className="model-select text-xs px-2 py-1 rounded border outline-none max-w-[110px] sm:max-w-[135px] cursor-pointer transition-colors truncate"
            title={`Active Model: ${selectedModel}`}
          >
              <optgroup label="Ollama Cloud (Free & 2M Context)">
                <option value="nemotron-3-ultra:cloud">nemotron-3-ultra:cloud (Default)</option>
                <option value="nemotron-3-super:cloud">nemotron-3-super:cloud</option>
              </optgroup>
              <optgroup label="Anthropic (Claude)">
                <option value="openrouter:anthropic/claude-3.7-sonnet">Claude 3.7 Sonnet</option>
                <option value="openrouter:anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                <option value="claude-3-5-sonnet">claude-3-5-sonnet (Direct)</option>
              </optgroup>
              <optgroup label="DeepSeek (Reasoning & Chat)">
                <option value="openrouter:deepseek/deepseek-r1">DeepSeek R1</option>
                <option value="openrouter:deepseek/deepseek-chat">DeepSeek V3</option>
                <option value="deepseek-r1">deepseek-r1 (Direct)</option>
              </optgroup>
              <optgroup label="OpenAI">
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="openrouter:openai/o3-mini">o3-mini</option>
              </optgroup>
              <optgroup label="Groq (Ultra-fast)">
                <option value="llama-3.3-70b-versatile">llama-3.3-70b</option>
                <option value="openai/gpt-oss-120b">gpt-oss-120b</option>
                <option value="qwen/qwen3.8-27b">qwen-3.8-27b</option>
              </optgroup>
          </select>

          <button
            type="button"
            onClick={() => setShowKeyModal(true)}
            className="topbar-key-btn text-[11px] px-2 py-1 rounded border border-white/10 hover:border-indigo-500/40 bg-white/5 hover:bg-indigo-500/10 text-slate-300 hover:text-indigo-300 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
            title="Configure Custom API Keys (OpenAI, Anthropic, OpenRouter, Groq, DeepSeek)"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            <span className="hidden sm:inline">Keys</span>
          </button>

          <span
            className="topbar-badge topbar-badge--context"
            title="Active model context window limit: 2 Million tokens"
          >
            <span className="hidden 2xl:inline">2M Context</span>
            <span className="inline 2xl:hidden">2M</span>
          </span>

          <span
            className={`topbar-badge ${
              dockerAvailable === null
                ? 'topbar-badge--neutral'
                : dockerAvailable
                ? 'topbar-badge--cyan'
                : 'topbar-badge--neutral'
            }`}
            title={
              dockerAvailable
                ? 'Docker Sandbox Active: Isolated container execution ready (node:20-slim)'
                : 'Docker Offline: Using Host sandbox'
            }
          >
            <span className="hidden 2xl:inline">
              {dockerAvailable === null ? '🐳 Docker…' : dockerAvailable ? '🐳 Docker: Active' : '🐳 Docker: Off'}
            </span>
            <span className="inline 2xl:hidden">
              {dockerAvailable ? '🐳 Active' : '🐳 Off'}
            </span>
          </span>

          <span
            className={`topbar-badge ${
              execMode === 'manual'
                ? 'topbar-badge--amber'
                : execMode === 'plan'
                ? 'topbar-badge--blue'
                : 'topbar-badge--orange'
            }`}
            title={`Active Execution Mode: ${execMode.toUpperCase()}. Switch mode in the chat controls or with /mode.`}
          >
            <span className="hidden lg:inline">
              {execMode === 'manual' ? '🛡️ Manual' : execMode === 'plan' ? '📋 Plan' : '⚡ Auto'}
            </span>
            <span className="inline lg:hidden">
              {execMode === 'manual' ? '🛡️' : execMode === 'plan' ? '📋' : '⚡'}
            </span>
          </span>
        </div>
      </div>

      {/* Middle: Spotlight search & Action logos cluster */}
      <div className="topbar-middle">
        <button
          type="button"
          className="global-search"
          onClick={() => openPalette(true)}
          title="Open command palette (Ctrl+K)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14} className="search-icon">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <span className="global-search-placeholder">
            Search commands, projects…
          </span>
          <span className="search-kbd">Ctrl K</span>
        </button>

        {/* Action logos beside search bar: click to open independently, click again to close/untap */}
        <div className="topbar-action-logos">
          {/* 1. Code Editor Logo (</>) */}
          <button
            type="button"
            className={`topbar-logo-btn ${editorOpen ? 'topbar-logo-btn--active' : ''}`}
            onClick={onEditorToggle}
            title={editorOpen ? "Close Code Editor (Click to untap)" : "Open Code Editor (</>)"}
            aria-label="Toggle Code Editor"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <polyline points="16 18 22 12 16 6" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="8 6 2 12 8 18" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {changedFiles && changedFiles.length > 0 && (
              <span className="logo-badge" title={`${changedFiles.length} files modified`}>
                {changedFiles.length}
              </span>
            )}
          </button>

          {/* 2. Live Web Preview Logo (🌐) - click to open side-by-side, click again to close/untap */}
          {showPreview && (
            <button
              type="button"
              className={`topbar-logo-btn ${previewOpen ? 'topbar-logo-btn--active' : ''}`}
              onClick={onPreviewToggle}
              title={previewOpen ? "Close Live Preview (Click to untap)" : "Open Live Preview (🌐) side-by-side"}
              aria-label="Toggle Live Preview"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </button>
          )}

          {/* 3. Settings Logo (⚙) - click to open side-by-side, click again to close/untap */}
          <button
            type="button"
            className={`topbar-logo-btn ${settingsOpen ? 'topbar-logo-btn--active' : ''}`}
            onClick={onSettingsToggle}
            title={settingsOpen ? "Close Settings (Click to untap)" : "Open Project Settings (⚙) side-by-side"}
            aria-label="Toggle Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={15} height={15}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          <span className="logos-divider" />

          {/* 4. Terminal Logo (>_) - click to toggle drawer */}
          <button
            type="button"
            className={`topbar-logo-btn ${terminalOpen ? 'topbar-logo-btn--active' : ''}`}
            onClick={onTerminalToggle}
            title={terminalOpen ? "Close Terminal Drawer (Click to untap)" : "Open Interactive Terminal Drawer (>_)"}
            aria-label="Toggle Terminal"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} width={14} height={14}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 17l6-6-6-6M12 19h8" />
            </svg>
          </button>

          {/* 5. File Explorer Logo ([±]) - click to open side panel, click again to close */}
          {onExplorerToggle && (
            <button
              type="button"
              className={`topbar-logo-btn ${explorerOpen ? 'topbar-logo-btn--active' : ''}`}
              onClick={onExplorerToggle}
              title={explorerOpen ? "Hide File Explorer (Click to untap)" : "Open File Explorer ([±])"}
              aria-label="Toggle File Explorer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} width={15} height={15}>
                <rect x="3" y="3" width="18" height="18" rx="2.5" />
                <path strokeLinecap="round" d="M12 7v4M10 9h4" />
                <path strokeLinecap="round" d="M10 15h4" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="topbar-right">
        {/* Live agent status badge if running */}
        {agentStatus && agentStatus !== 'done' && agentStatus !== 'error' ? (
          <div className="system-status system-status--agent-active" title={`Agent is actively ${agentStatus}`}>
            <svg className="agent-spin-icon" viewBox="0 0 16 16" fill="none" width={12} height={12}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="agent-status-label">
              ⚡ Agent {agentStatus === 'planning' ? 'Planning…' : agentStatus === 'writing' ? 'Writing…' : agentStatus === 'reading' ? 'Reading…' : agentStatus === 'running' ? 'Running…' : `${agentStatus}…`}
            </span>
          </div>
        ) : (
          /* Live backend health badge */
          <div className={`system-status ${healthy === false ? 'system-status--down' : ''}`}>
            <span className={`status-dot ${healthy === false ? 'status-dot--down' : ''}`} />
            <span>
              {healthy === null ? 'Checking…' : healthy ? 'System Online' : 'Backend Unreachable'}
            </span>
          </div>
        )}

        {/* Theme toggle — dark/light */}
        <button className="icon-btn" title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'} onClick={toggleTheme}>
          {isDark ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>

        {/* User profile avatar */}
        <div className="profile-avatar" title="User Profile">
          A
        </div>
      </div>

      <style jsx>{`
        .topbar {
          height: var(--header-height);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          gap: 12px;
          background: var(--bg-surface);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          width: 100%;
          min-width: 0;
          overflow: hidden;
        }

        .topbar-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          flex-shrink: 1;
        }

        .brand-logo {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-sm);
          background: var(--brand);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: none;
          flex-shrink: 0;
        }

        .model-select {
          background: var(--bg-base);
          color: var(--text-primary);
          border-color: var(--border-base);
        }

        .model-select:focus {
          border-color: var(--brand);
        }

        .model-select option,
        .model-select optgroup {
          background: var(--bg-surface);
          color: var(--text-primary);
        }

        .brand-text {
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }

        .brand-name {
          font-family: var(--font-brand);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.2;
          white-space: nowrap;
        }

        .brand-sub {
          font-size: 9.5px;
          color: var(--text-muted);
          white-space: nowrap;
        }

        @media (max-width: 1100px) {
          .brand-sub {
            display: none;
          }
        }

        .topbar-cluster {
          margin-left: 6px;
        }

        .topbar-badge {
          font-size: 10px;
          font-family: var(--font-mono);
          font-weight: 500;
          padding: 2.5px 7px;
          border-radius: var(--radius-sm);
          border: 1px solid transparent;
          white-space: nowrap;
          cursor: default;
          transition: all var(--transition-fast);
          display: inline-flex;
          align-items: center;
          gap: 3px;
          flex-shrink: 0;
          user-select: none;
        }

        .topbar-badge--context {
          color: #34d399;
          background: rgba(16, 185, 129, 0.1);
          border-color: rgba(16, 185, 129, 0.25);
        }

        .topbar-badge--cyan {
          color: #22d3ee;
          background: rgba(6, 182, 212, 0.1);
          border-color: rgba(6, 182, 212, 0.25);
        }

        .topbar-badge--neutral {
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.04);
          border-color: var(--border-subtle);
        }

        .topbar-badge--amber {
          color: #fbbf24;
          background: rgba(245, 158, 11, 0.1);
          border-color: rgba(245, 158, 11, 0.25);
        }

        .topbar-badge--blue {
          color: #60a5fa;
          background: rgba(59, 130, 246, 0.1);
          border-color: rgba(59, 130, 246, 0.25);
        }

        .topbar-badge--orange {
          color: #fb923c;
          background: rgba(249, 115, 22, 0.1);
          border-color: rgba(249, 115, 22, 0.25);
        }

        .topbar-middle {
          flex: 1 1 auto;
          display: flex;
          align-items: center;
          gap: 8px;
          max-width: 580px;
          min-width: 250px;
          margin: 0 10px;
        }

        .global-search {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          padding: 5px 12px;
          flex: 1;
          min-width: 160px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .global-search:hover {
          border-color: var(--border-strong);
          background: var(--bg-hover);
        }

        .search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .global-search-placeholder {
          flex: 1;
          text-align: left;
          color: var(--text-muted);
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .search-kbd {
          font-size: 9px;
          color: var(--text-muted);
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: 4px;
          padding: 1px 4px;
          flex-shrink: 0;
          font-family: var(--font-mono);
        }

        .topbar-action-logos {
          display: flex;
          align-items: center;
          gap: 4px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          padding: 3px 6px;
          border-radius: var(--radius-md);
          flex-shrink: 0;
        }

        .logos-divider {
          width: 1px;
          height: 16px;
          background: var(--border-subtle);
          margin: 0 2px;
        }

        .topbar-logo-btn {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 29px;
          height: 29px;
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          background: transparent;
          border: 1px solid transparent;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .topbar-logo-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
          border-color: var(--border-subtle);
        }

        .topbar-logo-btn--active {
          color: var(--brand) !important;
          background: var(--brand-glow) !important;
          border-color: rgba(249, 115, 22, 0.4) !important;
          box-shadow: 0 0 8px rgba(249, 115, 22, 0.25);
        }

        .logo-badge {
          position: absolute;
          top: 0px;
          right: 0px;
          background: var(--brand);
          color: white;
          font-size: 8px;
          font-weight: 700;
          font-family: var(--font-mono);
          min-width: 13px;
          height: 13px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 3px;
          line-height: 1;
        }

        .topbar-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .system-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 500;
          color: var(--text-secondary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          padding: 5px 12px;
          border-radius: 20px;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--success);
          box-shadow: 0 0 6px var(--success);
        }

        .status-dot--down {
          background: var(--error);
          box-shadow: 0 0 6px var(--error);
        }

        .system-status--down {
          color: var(--error);
          border-color: rgba(255, 69, 58, 0.3);
        }

        .system-status--agent-active {
          color: var(--brand) !important;
          background: var(--brand-glow) !important;
          border-color: var(--accent-border) !important;
          box-shadow: 0 0 12px rgba(255, 107, 0, 0.22);
          animation: status-glow 2s ease-in-out infinite;
        }

        .agent-spin-icon {
          animation: spin 0.85s linear infinite;
          flex-shrink: 0;
        }

        .agent-status-label {
          font-weight: 600;
          letter-spacing: 0.02em;
        }

        @keyframes status-glow {
          0%, 100% { box-shadow: 0 0 8px rgba(255, 107, 0, 0.2); }
          50% { box-shadow: 0 0 16px rgba(255, 107, 0, 0.4); }
        }

        @keyframes spin {
          100% { transform: rotate(360deg); }
        }

        .icon-btn {
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all var(--transition-fast);
        }

        .icon-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .profile-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: var(--bg-overlay);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--border-subtle);
        }
      `}</style>

      {/* Model Hub API Key Configuration Modal */}
      {showKeyModal && (
        <ApiKeyModal onClose={() => setShowKeyModal(false)} />
      )}
    </header>
  );
}
