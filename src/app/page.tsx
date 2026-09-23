'use client';

import { useState, useCallback, useEffect } from 'react';
import Sidebar          from '@/components/layout/Sidebar';
import TopBar           from '@/components/layout/TopBar';
import ChatPanel        from '@/components/chat/ChatPanel';
import EditorPanel      from '@/components/editor/EditorPanel';
import PreviewPanel     from '@/components/preview/PreviewPanel';
import SettingsPanel    from '@/components/settings/SettingsPanel';
import TabBar           from '@/components/layout/TabBar';
import ResizeHandle     from '@/components/layout/ResizeHandle';
import CommandPalette   from '@/components/command/CommandPalette';
import MobileLayout     from '@/components/mobile/MobileLayout';
import FileExplorer     from '@/components/FileExplorer';
import CompletionDialog from '@/components/CompletionDialog';
import ToolModal        from '@/components/ToolModal';
import PublicApiGallery, { type BuildProductSpec } from '@/components/PublicApiGallery';
import { useIsMobile }  from '@/hooks/useMobile';
import { useGlobalKeyboard, useShortcuts } from '@/hooks/useKeyboard';
import { useAppCommands } from '@/components/command/useAppCommands';
import { useCommandPaletteStore } from '@/hooks/useCommandPalette';
import { StatusIndicator, type AgentStatus } from '@/components/StatusIndicator';
import type { Project }  from '@/types';
import type { Shortcut } from '@/lib/shortcuts';

// Register each shortcut for both Ctrl (Windows/Linux) and Meta (macOS)
function crossPlatform(
  base: Omit<Shortcut, 'id' | 'modifiers'> & { id: string; key: string }
): Shortcut[] {
  return (['ctrl', 'meta'] as const).map((mod) => ({
    ...base,
    id: `${base.id}.${mod}`,
    modifiers: [mod],
  }));
}

export type ActiveTab = 'editor' | 'preview' | 'settings';

export default function App() {
  const [activeProject,  setActiveProject]  = useState<Project | null>(null);
  const [activeTab,      setActiveTab]      = useState<ActiveTab>('editor');
  const [activeFile,     setActiveFile]     = useState<string | null>(null);
  const [sidebarOpen,    setSidebarOpen]    = useState(true);
  const [chatWidth,      setChatWidth]      = useState(360);
  const [filesChanged,   setFilesChanged]   = useState<string[]>([]);
  const [refreshExplorerKey, setRefreshExplorerKey] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const [showToolModal,  setShowToolModal]  = useState(false);
  const [selectedModel, setSelectedModel] = useState('llama-3.3-70b-versatile');
  const [agentStatus,   setAgentStatus]   = useState<AgentStatus>('done');
  const [previewToken,  setPreviewToken]  = useState(0);
  const [projects,      setProjects]      = useState<Project[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  // Media query mobile detector
  const isMobile = useIsMobile('md');

  // Register global shortcuts handler
  useGlobalKeyboard();

  const paletteToggle = useCommandPaletteStore((s) => s.toggle);


  // Project list for the command palette's quick-switcher
  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []))
      .catch(() => {});
  }, [activeProject?.id]);

  const isStreaming = agentStatus !== 'done' && agentStatus !== 'error';

  const cancelAgent = useCallback(() => {
    // The URL is kept in sync with the active project (see effect below),
    // so shortcut actions registered once can read it at call time
    const projectId = new URLSearchParams(window.location.search).get('projectId');
    if (!projectId) return;
    fetch('/api/chat/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    }).catch(() => {});
  }, []);

  const focusChat = useCallback(() => {
    (document.querySelector('.input-textarea') as HTMLTextAreaElement)?.focus();
  }, []);

  // Editor actions run against the editor tab's toolbar buttons
  const clickEditorButton = useCallback((selector: string) => {
    setActiveTab('editor');
    setTimeout(() => {
      (document.querySelector(selector) as HTMLButtonElement)?.click();
    }, 120);
  }, []);

  // Populate the command palette (was defined but never wired up)
  useAppCommands({
    projects,
    activeProject,
    activeTab,
    activeFile,
    isStreaming,
    onTabChange:     setActiveTab,
    onProjectSelect: setActiveProject,
    onSidebarToggle: () => setSidebarOpen((p) => !p),
    onNewProject:    () => {
      setActiveProject(null);
      setSidebarOpen(true);
      setTimeout(() => {
        (document.querySelector('.sidebar-new-btn') as HTMLButtonElement)?.click();
      }, 120);
    },
    onCancelStream:  cancelAgent,
    onClearChat:     () => window.dispatchEvent(new CustomEvent('oc-clear-chat')),
    onFocusChat:     focusChat,
    onSaveFile:      () => clickEditorButton('.save-btn'),
    onRevertFile:    () => clickEditorButton('.revert-btn'),
    onToggleDiff:    () => clickEditorButton('.editor-actions .action-btn'),
  });

  // Real keyboard shortcuts (the registry existed but nothing registered any)
  useShortcuts([
    ...crossPlatform({
      id: 'palette.toggle', key: 'k', label: 'Command Palette',
      description: 'Open the command palette', group: 'system',
      global: true, action: () => paletteToggle(),
    }),
    ...crossPlatform({
      id: 'nav.editor', key: '1', label: 'Go to Editor',
      description: 'Open the code editor', group: 'navigation',
      action: () => setActiveTab('editor'),
    }),
    ...crossPlatform({
      id: 'nav.preview', key: '2', label: 'Go to Preview',
      description: 'Open the live preview', group: 'navigation',
      action: () => setActiveTab('preview'),
    }),
    ...crossPlatform({
      id: 'nav.settings', key: '3', label: 'Go to Settings',
      description: 'Open the settings panel', group: 'navigation',
      action: () => setActiveTab('settings'),
    }),
    ...crossPlatform({
      id: 'nav.sidebar', key: 'b', label: 'Toggle Sidebar',
      description: 'Show or hide the sidebar', group: 'view',
      action: () => setSidebarOpen((p) => !p),
    }),
    ...crossPlatform({
      id: 'chat.focus', key: 'l', label: 'Focus Chat',
      description: 'Focus the chat input', group: 'chat',
      global: true, action: focusChat,
    }),
    ...crossPlatform({
      id: 'chat.cancel', key: '.', label: 'Cancel Agent',
      description: 'Stop the running agent turn', group: 'chat',
      global: true, action: cancelAgent,
    }),
  ]);

  const handleFilesChanged = useCallback((files: string[]) => {
    setFilesChanged(files);
    setRefreshExplorerKey((k) => k + 1);
    // Boot (or reload) the preview so the user sees the result — Build Mode
    // projects have no preview panel (arbitrary folders aren't assumed to
    // be runnable web apps), so skip it there
    if (activeProject?.kind !== 'build') {
      setPreviewToken((t) => t + 1);
    }
  }, [activeProject?.kind]);

  const handleAgentDone = useCallback(
    (info: { reason: string; filesChanged: string[] }) => {
      if (info.reason === 'completed' && info.filesChanged.length > 0) {
        setShowCompletion(true);
      }
    },
    []
  );

  const handleFileSelect = useCallback((path: string) => {
    setActiveFile(path);
    setActiveTab('editor');
  }, []);

  // Auto-load project from URL search parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlProjId = params.get('projectId');
    if (urlProjId && !activeProject) {
      fetch('/api/projects')
        .then((r) => r.json())
        .then((data) => {
          const list = data.projects || [];
          const found = list.find((p: Project) => p.id === urlProjId);
          if (found) {
            setActiveProject(found);
          }
        })
        .catch((err) => console.error('Error auto-loading project:', err));
    }
  }, []);

  // Build Mode projects have no preview panel — bounce off it if a
  // previously-open app-mode tab selection carries over. Adjust-during-render
  // (not an effect) so the correction lands in the same commit as the
  // project switch instead of flashing the hidden tab for one frame.
  const [prevProjectKind, setPrevProjectKind] = useState(activeProject?.kind);
  if (activeProject?.kind !== prevProjectKind) {
    setPrevProjectKind(activeProject?.kind);
    if (activeProject?.kind === 'build' && activeTab === 'preview') {
      setActiveTab('editor');
    }
  }

  // Sync activeProject state with URL query parameters
  useEffect(() => {
    if (activeProject) {
      const url = new URL(window.location.href);
      url.searchParams.set('projectId', activeProject.id);
      window.history.replaceState(null, '', url.pathname + url.search);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete('projectId');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }, [activeProject]);

  if (isMobile) {
    return (
      <MobileLayout
        activeProject={activeProject}
        onProjectSelect={setActiveProject}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeFile={activeFile}
        onFileSelect={handleFileSelect}
        filesChanged={filesChanged}
        onFilesChanged={handleFilesChanged}
      />
    );
  }

  return (
    <div className="app-shell">
      {/* ── Top Bar (Full Width Header) ─────────────────────────────────── */}
      <TopBar
        project={activeProject}
        activeFile={activeFile}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={() => setSidebarOpen((p) => !p)}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />

      <div className="app-body">
        {/* ── Sidebar (Left) ───────────────────────────────────────────── */}
        <Sidebar
          open={sidebarOpen}
          activeProject={activeProject}
          onProjectSelect={setActiveProject}
        />

        {/* ── Workspace Area (Multi-Column Grid) ────────────────────────── */}
        <div className="workspace-container">
          {activeProject ? (
            <div className="workspace-main">
              <div className="workspace-columns">
                {/* ── Column 1: Chat/Prompt Widget Column ─────────────────── */}
                <div className="workspace-column-left" style={{ width: chatWidth }}>
                  <ChatPanel
                    projectId={activeProject.id}
                    activeFilePath={activeFile ?? undefined}
                    onFilesChanged={handleFilesChanged}
                    onFileSelect={handleFileSelect}
                    selectedModel={selectedModel}
                    onStatusChange={setAgentStatus}
                    onAgentDone={handleAgentDone}
                    initialPrompt={pendingPrompt}
                    onClearInitialPrompt={() => setPendingPrompt(null)}
                  />
                </div>

                {/* Resize handle */}
                <ResizeHandle
                  onResize={(delta) =>
                    setChatWidth((w) =>
                      Math.max(300, Math.min(500, w + delta))
                    )
                  }
                />

                {/* ── Column 2: Main Area (Metrics + Workspace Tabs) ──────── */}
                <div className="workspace-column-middle">
                  {/* Tab Switcher & Content view */}
                  <div className="editor-tab-workspace">
                    <TabBar
                      active={activeTab}
                      onChange={setActiveTab}
                      changedFiles={filesChanged}
                      showPreview={activeProject.kind !== 'build'}
                    />

                    <div className="panel-area">
                      {activeTab === 'editor' && (
                        <EditorPanel
                          projectId={activeProject.id}
                          activeFile={activeFile}
                          onFileSelect={handleFileSelect}
                          changedFiles={filesChanged}
                        />
                      )}
                      {activeTab === 'preview' && activeProject.kind !== 'build' && (
                        <PreviewPanel
                          projectId={activeProject.id}
                          autoStartToken={previewToken}
                        />
                      )}
                      {activeTab === 'settings' && (
                        <SettingsPanel project={activeProject} />
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Column 3: File Explorer (Right Column) ──────────────── */}
                <div className="workspace-column-right">
                  <FileExplorer
                    projectId={activeProject.id}
                    activeFile={activeFile}
                    onFileSelect={handleFileSelect}
                    refreshKey={refreshExplorerKey}
                  />
                </div>
              </div>

              {/* ── Bottom Execution / Control Footer Bar ──────────────────── */}
              <div className="app-footer">
                {/* Execution Controls */}
                <div className="footer-left-controls">
                  <div className="footer-section-label">EXECUTION CONTROLS</div>
                  <div className="footer-row-btns">
                    <button
                      className="footer-btn footer-btn--execute"
                      onClick={() => {
                        const inputEl = document.querySelector('.input-textarea') as HTMLTextAreaElement;
                        if (inputEl) {
                          inputEl.focus();
                        }
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width={11} height={11}>
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                      Execute
                    </button>
                    <button
                      className="footer-btn footer-btn--ghost"
                      onClick={async () => {
                        try {
                          await fetch('/api/chat/cancel', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ projectId: activeProject.id }),
                          });
                        } catch {}
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width={10} height={10}>
                        <rect x="5" y="5" width="14" height="14" rx="2"/>
                      </svg>
                      Stop
                    </button>
                  </div>
                </div>

                {/* Live agent status */}
                <div className="footer-middle-progress">
                  <div className="footer-section-label">AGENT STATUS</div>
                  <div className="progress-row">
                    <StatusIndicator status={agentStatus} />
                    {filesChanged.length > 0 && (
                      <span className="files-changed-note">
                        {filesChanged.length} file{filesChanged.length === 1 ? '' : 's'} changed this turn
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="footer-right-actions">
                  <div className="footer-section-label">QUICK ACTIONS</div>
                  <div className="footer-row-btns">
                    <a
                      href={`/api/download?projectId=${activeProject.id}`}
                      className="footer-btn footer-btn--ghost"
                      download
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={10} height={10}>
                        <path d="M12 3v13M7 12l5 5 5-5M5 21h14"/>
                      </svg>
                      Export
                    </a>
                    <button
                      className="footer-btn footer-btn--ghost"
                      onClick={() => setShowToolModal(true)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={10} height={10}>
                        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
                      </svg>
                      Tools
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <WelcomeScreen
              onProjectSelect={(project, prompt) => {
                setActiveProject(project);
                if (prompt) {
                  setPendingPrompt(prompt);
                }
              }}
            />
          )}
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette />

      {/* Completion Dialog — appears after agent finishes */}
      {showCompletion && activeProject && (
        <CompletionDialog
          projectId={activeProject.id}
          onDismiss={() => setShowCompletion(false)}
          onOpenPreview={() => setActiveTab('preview')}
        />
      )}

      {/* Tool Configuration Modal */}
      {showToolModal && (
        <ToolModal onClose={() => setShowToolModal(false)} />
      )}

      <style jsx>{`
        .app-shell {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          background: var(--bg-base);
        }

        .app-body {
          flex: 1;
          display: flex;
          overflow: hidden;
          min-height: 0;
        }

        .workspace-container {
          flex: 1;
          display: flex;
          overflow: hidden;
          min-width: 0;
          min-height: 0;
          background: var(--bg-base);
        }

        .workspace-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          overflow: hidden;
        }

        .workspace-columns {
          flex: 1;
          display: flex;
          min-width: 0;
          min-height: 0;
          overflow: hidden;
        }

        .workspace-column-left {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-height: 0;
          padding: 12px 0 12px 12px;
        }

        .workspace-column-middle {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0;
          min-width: 0;
          min-height: 0;
          overflow: hidden;
          padding: 12px 0;
        }

        .workspace-column-right {
          width: 260px;
          flex-shrink: 0;
          height: 100%;
          min-height: 0;
          padding: 12px 12px 12px 0;
        }

        /* Editor / Workspace pane */
        .editor-tab-workspace {
          flex: 1;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          overflow: hidden;
          background: var(--bg-deep);
        }

        .panel-area {
          flex: 1;
          overflow: hidden;
        }

        /* Footer execution bar */
        .app-footer {
          height: var(--dock-height);
          border-top: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          flex-shrink: 0;
        }

        .footer-left-controls,
        .footer-middle-progress,
        .footer-right-actions {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .footer-middle-progress {
          flex: 1;
          max-width: 460px;
          margin: 0 24px;
        }

        .footer-section-label {
          font-size: 8.5px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          font-weight: 600;
        }

        .footer-row-btns {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .footer-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 500;
          border-radius: var(--radius-md);
          padding: 6px 12px;
          cursor: pointer;
          border: 1px solid transparent;
          text-decoration: none;
          transition: all var(--transition-fast);
        }

        .footer-btn--execute {
          background: var(--brand);
          color: #fffaf7;
          border: none;
        }

        .footer-btn--execute:hover {
          background: var(--brand-dim);
        }

        .footer-btn--ghost {
          background: var(--bg-elevated);
          border-color: var(--border-subtle);
          color: var(--text-primary);
        }

        .footer-btn--ghost:hover {
          background: var(--bg-hover);
          border-color: var(--border-base);
        }

        .footer-btn:active {
          transform: scale(0.97);
        }

        /* Live status middle styling */
        .progress-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .files-changed-note {
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 500;
        }

      `}</style>
    </div>
  );
}

// ─── Welcome screen ───────────────────────────────────────────────────────────
function WelcomeScreen({
  onProjectSelect,
}: {
  onProjectSelect: (p: Project, initialPrompt?: string) => void;
}) {
  const [mode,     setMode]     = useState<'app' | 'build'>('app');
  const [name,     setName]     = useState('');
  const [template, setTemplate] = useState('react-vite');
  const [buildPath, setBuildPath] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []))
      .finally(() => setFetching(false));
  }, []);

  const canCreate = mode === 'app' ? !!name.trim() : !!buildPath.trim();

  const create = async () => {
    if (!canCreate) return;
    setLoading(true);
    setError('');
    try {
      const body =
        mode === 'app'
          ? { title: name.trim(), template }
          : { mode: 'build', path: buildPath.trim(), title: name.trim() || undefined };

      const res = await fetch('/api/projects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create project');
      onProjectSelect(data.project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleBuildApiProduct = async (spec: BuildProductSpec) => {
    setLoading(true);
    setError('');
    try {
      // 1. Create project with given title and template
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: spec.title,
          template: spec.template || 'react-vite',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create project');

      // 2. Save API key in project encrypted settings if supplied
      if (spec.apiKey && spec.apiKey.trim()) {
        try {
          await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key: spec.keyEnv || 'VITE_API_KEY',
              value: spec.apiKey.trim(),
              projectId: data.project.id,
            }),
          });
        } catch (settingsErr) {
          console.warn('Failed to save project API key setting:', settingsErr);
        }
      }

      // 3. Switch to project with initial prompt for agent
      onProjectSelect(data.project, spec.prompt);
    } catch (e) {
      setError((e as Error).message || 'Failed to initialize API product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        {/* ── Hero card ────────────────────────────────────────────── */}
        <div className="welcome-card">
          {/* Icon */}
          <div className="welcome-icon">
            <svg viewBox="0 0 24 24" fill="none" width={28} height={28}>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"/>
            </svg>
          </div>

          <h1 className="welcome-title">
            {mode === 'app' ? 'Start your first project' : 'Open an existing codebase'}
          </h1>
          <p className="welcome-desc">
            {mode === 'app'
              ? 'Point the agent at a repository and it will plan changes, edit files, and create checkpoints — nothing touches your main branch until you approve.'
              : 'Build Mode points the agent directly at a real folder on disk — any existing codebase, not just app-builder projects. No template, no live preview assumed.'}
          </p>

          {/* Mode toggle */}
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-tab ${mode === 'app' ? 'mode-tab--active' : ''}`}
              onClick={() => setMode('app')}
            >
              App Builder
            </button>
            <button
              type="button"
              className={`mode-tab ${mode === 'build' ? 'mode-tab--active' : ''}`}
              onClick={() => setMode('build')}
            >
              Build Mode
            </button>
          </div>

          {/* Create form */}
          {mode === 'app' ? (
            <>
              <input
                type="text"
                placeholder="Project name…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                className="welcome-input"
                autoFocus
              />
              <div className="template-row">
                {[
                  { id: 'react-vite',  label: 'React app' },
                  { id: 'static-site', label: 'Static site' },
                  { id: 'blank',       label: 'Blank' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`template-chip ${template === t.id ? 'template-chip--active' : ''}`}
                    onClick={() => setTemplate(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <input
                type="text"
                placeholder="C:\Users\you\my-project or /home/you/my-project"
                value={buildPath}
                onChange={(e) => setBuildPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                className="welcome-input"
                autoFocus
              />
              <input
                type="text"
                placeholder="Project name (defaults to folder name)…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                className="welcome-input"
              />
              <p className="build-mode-notice">
                The agent gets direct read/write access to this real folder and
                can run allowlisted shell commands in it. For stronger isolation,
                set <code>SANDBOX_MODE=docker</code> in <code>.env.local</code>.
              </p>
            </>
          )}

          <button
            onClick={create}
            disabled={!canCreate || loading}
            className="welcome-btn"
          >
            {loading ? <span className="spinner" /> : mode === 'app' ? 'Create project' : 'Open folder'}
          </button>

          {error && <p className="welcome-error">{error}</p>}

          {/* Existing projects */}
          {!fetching && projects.length > 0 && (
            <div className="welcome-projects">
              <div className="welcome-projects-label">Or open an existing project</div>
              <div className="welcome-projects-list">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onProjectSelect(p)}
                    className="welcome-project-item"
                  >
                    <div className="wp-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                      </svg>
                    </div>
                    <span className="wp-name">{p.title}</span>
                    {p.kind === 'build' && <span className="wp-build-badge">Build</span>}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13} className="wp-arrow">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <PublicApiGallery onBuildProduct={handleBuildApiProduct} />
      </div>

      <style jsx>{`
        .welcome {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          overflow-y: auto;
          min-height: 0;
          padding: 36px 24px 64px;
          width: 100%;
        }

        .welcome-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 28px;
          width: 100%;
          max-width: 980px;
        }

        .welcome-card {
          width: 100%;
          max-width: 460px;
          border-radius: var(--radius-xl);
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          box-shadow: var(--shadow-md);
          padding: 32px 28px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          position: relative;
          overflow: hidden;
        }

        .welcome-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(400px 200px at 50% 0%, var(--brand-glow), transparent 70%);
          pointer-events: none;
        }

        .welcome-icon {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: var(--brand-glow);
          border: 1px solid var(--accent-border);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--brand);
          margin-bottom: 16px;
          position: relative;
        }

        .welcome-title {
          font-family: var(--font-brand);
          font-size: 19px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 8px;
          letter-spacing: -0.1px;
          position: relative;
        }

        .welcome-desc {
          font-size: 12.5px;
          color: var(--text-secondary);
          line-height: 1.6;
          max-width: 360px;
          margin-bottom: 20px;
          position: relative;
        }

        .welcome-input {
          width: 100%;
          background: var(--bg-base);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          padding: 10px 14px;
          font-size: 13px;
          color: var(--text-primary);
          outline: none;
          margin-bottom: 10px;
          font-family: var(--font-sans);
          position: relative;
          transition: all var(--transition-fast);
        }

        .welcome-input:focus {
          border-color: var(--brand);
          box-shadow: 0 0 0 1px var(--brand);
        }

        .welcome-input::placeholder {
          color: var(--text-muted);
        }

        .mode-toggle {
          display: flex;
          gap: 2px;
          width: 100%;
          padding: 3px;
          margin-bottom: 16px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }

        .mode-tab {
          flex: 1;
          padding: 7px 10px;
          background: transparent;
          border: none;
          border-radius: calc(var(--radius-md) - 2px);
          color: var(--text-muted);
          font-size: 11.5px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .mode-tab:hover { color: var(--text-primary); }

        .mode-tab--active {
          background: var(--bg-surface);
          color: var(--text-primary);
          font-weight: 600;
          box-shadow: var(--shadow-sm);
        }

        .build-mode-notice {
          width: 100%;
          font-size: 10.5px;
          line-height: 1.5;
          color: var(--text-muted);
          background: rgba(255, 159, 10, 0.06);
          border: 1px solid rgba(255, 159, 10, 0.2);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          margin-bottom: 10px;
          text-align: left;
        }

        .build-mode-notice code {
          font-family: var(--font-mono);
          color: var(--text-secondary);
          background: rgba(255, 255, 255, 0.06);
          padding: 1px 4px;
          border-radius: 3px;
        }

        .wp-build-badge {
          font-size: 8.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--warning, #ff9f0a);
          background: rgba(255, 159, 10, 0.1);
          border: 1px solid rgba(255, 159, 10, 0.25);
          border-radius: var(--radius-full);
          padding: 1px 6px;
          flex-shrink: 0;
        }

        .template-row {
          display: flex;
          gap: 6px;
          width: 100%;
          margin-bottom: 12px;
        }

        .template-chip {
          flex: 1;
          padding: 8px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          font-size: 12px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .template-chip:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
          border-color: var(--border-base);
        }

        .template-chip--active {
          background: var(--brand-glow);
          border-color: var(--accent-border);
          color: var(--brand);
          font-weight: 600;
        }

        .welcome-btn {
          width: 100%;
          background: var(--brand);
          border: none;
          border-radius: var(--radius-md);
          color: #fffaf7;
          font-weight: 600;
          font-size: 13px;
          padding: 10px 14px;
          cursor: pointer;
          margin-bottom: 6px;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all var(--transition-fast);
        }

        .welcome-btn:hover:not(:disabled) {
          background: var(--brand-dim);
        }

        .welcome-btn:active:not(:disabled) {
          transform: scale(0.98);
        }

        .welcome-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .welcome-error {
          font-size: 11.5px;
          color: var(--coral);
          margin-top: 4px;
        }

        .welcome-projects {
          width: 100%;
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid var(--border-subtle);
          text-align: left;
        }

        .welcome-projects-label {
          font-size: 9.5px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          font-weight: 600;
          margin-bottom: 8px;
        }

        .welcome-projects-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 180px;
          overflow-y: auto;
        }

        .welcome-project-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 8px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 12.5px;
          text-align: left;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .welcome-project-item:hover {
          background: var(--bg-hover);
          border-color: var(--border-base);
        }

        .wp-icon {
          width: 24px;
          height: 24px;
          border-radius: 5px;
          background: rgba(255, 255, 255, 0.04);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        .wp-name {
          flex: 1;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .wp-arrow {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin-slow 0.8s linear infinite;
        }

        @keyframes spin-slow {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
