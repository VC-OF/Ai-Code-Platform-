'use client';

import { useEffect, useState } from 'react';
import { useCommandPaletteStore } from '@/hooks/useCommandPalette';
import type { Project } from '@/types';

interface TopBarProps {
  project?:       Project | null;
  activeFile?:    string | null;
  sidebarOpen?:    boolean;
  onSidebarToggle?: () => void;
  selectedModel?: string;
  onModelChange?: (m: string) => void;
}

export default function TopBar({
  project,
  activeFile,
  sidebarOpen,
  onSidebarToggle,
  selectedModel,
  onModelChange,
}: TopBarProps) {
  const [isDark, setIsDark] = useState(true);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const openPalette = useCommandPaletteStore((s) => s.setOpen);

  // Apply saved theme on mount (external-system sync from localStorage)
  useEffect(() => {
    const saved = localStorage.getItem('oc-theme') ?? 'dark';
    const dark = saved !== 'light';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, []);

  // Live backend health for the status badge (was a hardcoded "Online")
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      fetch('/api/health')
        .then((r) => r.json())
        .then((d) => !cancelled && setHealthy(d?.status === 'healthy'))
        .catch(() => !cancelled && setHealthy(false));
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
        <div className="ml-4 flex items-center gap-2">
          <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">Model:</span>
          <select
            value={selectedModel}
            onChange={(e) => onModelChange?.(e.target.value)}
            className="bg-zinc-800/80 text-zinc-200 text-xs px-2 py-1 rounded border border-zinc-700 outline-none w-56 cursor-pointer focus:border-indigo-500 transition-colors"
          >
              <optgroup label="Groq Models">
                <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                <option value="meta-llama/llama-4-scout-17b-16e-instruct">meta-llama/llama-4-scout-17b-16e-instruct</option>
                <option value="qwen/qwen3-32b">qwen/qwen3-32b</option>
                <option value="qwen/qwen3.6-27b">qwen/qwen3.6-27b</option>
                <option value="openai/gpt-oss-120b">openai/gpt-oss-120b</option>
                <option value="openai/gpt-oss-20b">openai/gpt-oss-20b</option>
                <option value="groq/compound">groq/compound</option>
                <option value="groq/compound-mini">groq/compound-mini</option>
                <option value="allam-2-7b">allam-2-7b</option>
              </optgroup>
              <optgroup label="Ollama Cloud Models">
                <option value="minimax-m3:cloud">minimax-m3:cloud</option>
                <option value="qwen3-coder-next:cloud">qwen3-coder-next:cloud</option>
                <option value="glm-5.2:cloud">glm-5.2:cloud</option>
              </optgroup>
              <optgroup label="Local Ollama Models">
                <option value="deepseek-r1:latest">deepseek-r1:latest</option>
                <option value="deepseek-r1:8b">deepseek-r1:8b</option>
                <option value="llama3.1:latest">llama3.1:latest</option>
              </optgroup>
              <optgroup label="OpenRouter (needs OPENROUTER_API_KEY)">
                <option value="openrouter:meta-llama/llama-3.3-70b-instruct:free">llama-3.3-70b (free)</option>
                <option value="openrouter:qwen/qwen-2.5-coder-32b-instruct:free">qwen-2.5-coder-32b (free)</option>
                <option value="openrouter:deepseek/deepseek-chat-v3-0324:free">deepseek-v3 (free)</option>
              </optgroup>
              <optgroup label="LM Studio (local)">
                <option value="lmstudio:local-model">currently loaded model</option>
              </optgroup>
          </select>
        </div>
      </div>

      {/* Middle: Spotlight search — opens the command palette */}
      <div className="topbar-middle">
        <button
          type="button"
          className="global-search"
          onClick={() => openPalette(true)}
          title="Open command palette"
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
      </div>

      {/* Right: Actions */}
      <div className="topbar-right">
        {/* Live backend health badge */}
        <div className={`system-status ${healthy === false ? 'system-status--down' : ''}`}>
          <span className={`status-dot ${healthy === false ? 'status-dot--down' : ''}`} />
          <span>
            {healthy === null ? 'Checking…' : healthy ? 'System Online' : 'Backend Unreachable'}
          </span>
        </div>

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
          padding: 0 24px;
          background: rgba(18, 18, 23, 0.45);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          width: 100%;
        }

        .topbar-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand-logo {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-sm);
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(255, 255, 255, 0.2);
        }

        .brand-text {
          display: flex;
          flex-direction: column;
        }

        .brand-name {
          font-family: var(--font-brand);
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.2;
        }

        .brand-sub {
          font-size: 10px;
          color: var(--text-muted);
        }

        .topbar-middle {
          flex: 1;
          max-width: 440px;
          margin: 0 24px;
        }

        .global-search {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 6px 12px;
          width: 100%;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .global-search:hover {
          border-color: rgba(255, 255, 255, 0.15);
          background: rgba(255, 255, 255, 0.06);
        }

        .search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .global-search-placeholder {
          flex: 1;
          text-align: left;
          color: var(--text-muted);
          font-size: 11.5px;
        }

        .search-kbd {
          font-size: 9.5px;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          border-radius: 4px;
          padding: 1px 4px;
          flex-shrink: 0;
          font-family: var(--font-mono);
        }

        .topbar-right {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .system-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 500;
          color: var(--text-secondary);
          background: rgba(255, 255, 255, 0.03);
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
          background: rgba(255, 255, 255, 0.05);
        }

        .profile-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--border-subtle);
        }
      `}</style>
    </header>
  );
}
