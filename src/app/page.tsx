'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar          from '@/components/layout/Sidebar';
import TopBar           from '@/components/layout/TopBar';
import ChatPanel        from '@/components/chat/ChatPanel';
import EditorPanel      from '@/components/editor/EditorPanel';
import PreviewPanel     from '@/components/preview/PreviewPanel';
import SettingsPanel    from '@/components/settings/SettingsPanel';
import TerminalPanel    from '@/components/terminal/TerminalPanel';
import ResizeHandle     from '@/components/layout/ResizeHandle';
import CommandPalette   from '@/components/command/CommandPalette';
import MobileLayout     from '@/components/mobile/MobileLayout';
import FileExplorer     from '@/components/FileExplorer';
import CompletionDialog from '@/components/CompletionDialog';
import ToolModal        from '@/components/ToolModal';
import ChangesReviewModal from '@/components/editor/ChangesReviewModal';
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
  const [chatWidth,      setChatWidth]      = useState(460);
  const [filesChanged,   setFilesChanged]   = useState<string[]>([]);
  const [refreshExplorerKey, setRefreshExplorerKey] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const [showToolModal,  setShowToolModal]  = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState('nemotron-3-ultra:cloud');
  const [agentStatus,   setAgentStatus]   = useState<AgentStatus>('done');
  const [previewToken,  setPreviewToken]  = useState(0);
  const [projects,      setProjects]      = useState<Project[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [explorerOpen,  setExplorerOpen]  = useState(false);
  const [editorOpen,    setEditorOpen]    = useState(true);
  const [previewOpen,   setPreviewOpen]   = useState(false);
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [terminalOpen,  setTerminalOpen]  = useState(false);
  const [isResizing,    setIsResizing]    = useState(false);
  const workspaceColumnsRef = useRef<HTMLDivElement | null>(null);

  // Listen for open review modal events from timeline or shortcuts
  useEffect(() => {
    const handleOpenReview = () => setShowReviewModal(true);
    window.addEventListener('oc-open-review-modal', handleOpenReview);
    return () => window.removeEventListener('oc-open-review-modal', handleOpenReview);
  }, []);

  const hasOpenPanels = editorOpen || previewOpen || settingsOpen || terminalOpen;

  // Sync explorer open/closed preference from localStorage (default: closed)
  useEffect(() => {
    // Deferred to a frame callback to avoid a synchronous setState in the effect body
    const id = requestAnimationFrame(() => {
      const saved = localStorage.getItem('oc-explorer-open');
      if (saved !== null) setExplorerOpen(saved === 'true');
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const toggleExplorer = useCallback(() => {
    setExplorerOpen((prev) => {
      const next = !prev;
      localStorage.setItem('oc-explorer-open', String(next));
      return next;
    });
  }, []);

  const toggleEditor = useCallback(() => {
    setEditorOpen((p) => !p);
  }, []);

  const togglePreview = useCallback(() => {
    setPreviewOpen((p) => !p);
  }, []);

  const toggleSettings = useCallback(() => {
    setSettingsOpen((p) => !p);
  }, []);

  const toggleTerminal = useCallback(() => {
    setTerminalOpen((p) => !p);
  }, []);

  const handleResizeWidth = useCallback((targetWidth: number) => {
    const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const minW = 280;
    const maxW = Math.max(minW, screenW - 280);
    setChatWidth(Math.max(minW, Math.min(maxW, targetWidth)));
  }, []);

  const handleTogglePanels = useCallback(() => {
    if (hasOpenPanels) {
      setEditorOpen(false);
      setPreviewOpen(false);
      setSettingsOpen(false);
      setTerminalOpen(false);
    } else {
      setEditorOpen(true);
      const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
      setChatWidth(Math.max(340, Math.min(640, Math.round(screenW * 0.46))));
    }
  }, [hasOpenPanels]);

  const handleEnsureOpen = useCallback(() => {
    if (!hasOpenPanels) {
      setEditorOpen(true);
    }
  }, [hasOpenPanels]);

  // Listen for external terminal toggle events
  useEffect(() => {
    const handleToggle = () => setTerminalOpen((p) => !p);
    window.addEventListener('oc-toggle-terminal', handleToggle);
    return () => window.removeEventListener('oc-toggle-terminal', handleToggle);
  }, []);

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

  const handleTabChange = useCallback((t: ActiveTab) => {
    setActiveTab(t);
    if (t === 'editor') setEditorOpen(true);
    if (t === 'preview') setPreviewOpen(true);
    if (t === 'settings') setSettingsOpen(true);
  }, []);

  // Populate the command palette (was defined but never wired up)
  useAppCommands({
    projects,
    activeProject,
    activeTab,
    activeFile,
    isStreaming,
    onTabChange:     handleTabChange,
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
      action: () => { setActiveTab('editor'); setEditorOpen(true); },
    }),
    ...crossPlatform({
      id: 'nav.preview', key: '2', label: 'Go to Preview',
      description: 'Open the live preview', group: 'navigation',
      action: () => { setActiveTab('preview'); setPreviewOpen(true); },
    }),
    ...crossPlatform({
      id: 'nav.settings', key: '3', label: 'Go to Settings',
      description: 'Open the settings panel', group: 'navigation',
      action: () => { setActiveTab('settings'); setSettingsOpen(true); },
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
    setEditorOpen(true);
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
    if (activeProject?.kind === 'build') {
      if (activeTab === 'preview') setActiveTab('editor');
      if (previewOpen) setPreviewOpen(false);
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
        agentStatus={agentStatus}
        editorOpen={editorOpen}
        onEditorToggle={toggleEditor}
        previewOpen={previewOpen}
        onPreviewToggle={togglePreview}
        settingsOpen={settingsOpen}
        onSettingsToggle={toggleSettings}
        terminalOpen={terminalOpen}
        onTerminalToggle={toggleTerminal}
        explorerOpen={explorerOpen}
        onExplorerToggle={toggleExplorer}
        showPreview={activeProject?.kind !== 'build'}
        changedFiles={filesChanged}
        activeTab={activeTab}
        onTabChange={setActiveTab}
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
              <div
                className={`workspace-columns ${isResizing ? 'workspace-columns--resizing' : ''}`}
                ref={workspaceColumnsRef}
              >
                {/* ── Column 1: Chat/Prompt Widget Column (Expands to full page when nothing else is open) ── */}
                <div
                  className={`workspace-column-left ${!hasOpenPanels ? 'workspace-column-left--full' : ''}`}
                  style={hasOpenPanels ? { width: chatWidth } : undefined}
                >
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
                    isFullWidth={!hasOpenPanels}
                  />
                </div>

                {/* Resize handle (always draggable with high-hit target & edge tab) */}
                <ResizeHandle
                  onResizeWidth={handleResizeWidth}
                  onDragStart={() => setIsResizing(true)}
                  onDragEnd={() => setIsResizing(false)}
                  onToggle={handleTogglePanels}
                  onEnsureOpen={handleEnsureOpen}
                  hasOpenPanels={hasOpenPanels}
                  containerRef={workspaceColumnsRef}
                />

                {/* ── Column 2: Main Area (Metrics + Workspace Tabs) ──────── */}
                {hasOpenPanels && (
                  <div className={`workspace-column-middle ${!explorerOpen ? 'workspace-column-middle--full' : ''}`}>
                  {/* Workspace Content view: multi-panel side-by-side display */}
                  <div className="editor-tab-workspace">
                    <div className="workspace-panels-row">
                      {/* Code Editor Panel */}
                      {editorOpen && (
                        <div className="workspace-panel-slot">
                          <div className="panel-slot-header">
                            <div className="panel-slot-title">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                                <polyline points="16 18 22 12 16 6" strokeLinecap="round" strokeLinejoin="round" />
                                <polyline points="8 6 2 12 8 18" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <span>Code</span>
                              {activeFile && (
                                <span className="panel-slot-badge">{activeFile.split('/').pop()}</span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="panel-slot-close"
                              onClick={() => setEditorOpen(false)}
                              title="Close code editor"
                              aria-label="Close Code Editor"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="panel-slot-body">
                            <EditorPanel
                              projectId={activeProject.id}
                              activeFile={activeFile}
                              onFileSelect={handleFileSelect}
                              changedFiles={filesChanged}
                            />
                          </div>
                        </div>
                      )}

                      {/* Live Web Preview Panel */}
                      {previewOpen && activeProject.kind !== 'build' && (
                        <div className="workspace-panel-slot">
                          <div className="panel-slot-header">
                            <div className="panel-slot-title">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={13} height={13}>
                                <circle cx="12" cy="12" r="10" />
                                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                              </svg>
                              <span>Live preview</span>
                            </div>
                            <button
                              type="button"
                              className="panel-slot-close"
                              onClick={() => setPreviewOpen(false)}
                              title="Close live preview"
                              aria-label="Close Live Preview"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="panel-slot-body">
                            <PreviewPanel
                              projectId={activeProject.id}
                              autoStartToken={previewToken}
                            />
                          </div>
                        </div>
                      )}

                      {/* Project Settings Panel */}
                      {settingsOpen && (
                        <div className="workspace-panel-slot">
                          <div className="panel-slot-header">
                            <div className="panel-slot-title">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={13} height={13}>
                                <circle cx="12" cy="12" r="3" />
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                              </svg>
                              <span>Settings</span>
                            </div>
                            <button
                              type="button"
                              className="panel-slot-close"
                              onClick={() => setSettingsOpen(false)}
                              title="Close settings"
                              aria-label="Close Settings"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="panel-slot-body">
                            <SettingsPanel project={activeProject} />
                          </div>
                        </div>
                      )}

                    </div>

                    {/* Interactive Terminal Drawer at the bottom */}
                    {terminalOpen && (
                      <div className="workspace-terminal-container">
                        <TerminalPanel
                          projectId={activeProject.id}
                          onClose={() => setTerminalOpen(false)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

                {/* ── Column 3: File Explorer (Right Column) ──────────────── */}
                {explorerOpen && (
                  <div className="workspace-column-right">
                    <FileExplorer
                      projectId={activeProject.id}
                      activeFile={activeFile}
                      onFileSelect={handleFileSelect}
                      refreshKey={refreshExplorerKey}
                    />
                  </div>
                )}
              </div>

              {/* ── Bottom Indication Bar (Very small status line) ──────────── */}
              <div className="app-footer">
                <div className="footer-left-group">
                  <button
                    className="status-bar-btn status-bar-btn--execute"
                    onClick={() => {
                      const inputEl = document.querySelector('.input-textarea') as HTMLTextAreaElement;
                      if (inputEl) {
                        inputEl.focus();
                      }
                    }}
                    title="Focus chat input"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" width={9} height={9}>
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                    <span>Execute</span>
                  </button>

                  <button
                    className="status-bar-btn"
                    onClick={async () => {
                      try {
                        await fetch('/api/chat/cancel', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ projectId: activeProject.id }),
                        });
                      } catch {}
                    }}
                    title="Stop agent turn"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" width={8} height={8}>
                      <rect x="5" y="5" width="14" height="14" rx="2"/>
                    </svg>
                    <span>Stop</span>
                  </button>

                  <span className="status-bar-divider" />

                  <div className="status-bar-indicator">
                    <StatusIndicator status={agentStatus} />
                    {filesChanged.length > 0 ? (
                      <button
                        className="status-bar-btn status-bar-btn--review"
                        onClick={() => setShowReviewModal(true)}
                        title="Review diffs and checkpoints"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={10} height={10}>
                          <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
                        </svg>
                        <span>{filesChanged.length} file{filesChanged.length === 1 ? '' : 's'} changed · Diffs</span>
                      </button>
                    ) : (
                      <button
                        className="status-bar-btn"
                        onClick={() => setShowReviewModal(true)}
                        title="Checkpoints and rollback history"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={10} height={10}>
                          <circle cx="12" cy="12" r="4"/>
                          <line x1="1.05" y1="12" x2="7" y2="12"/>
                          <line x1="17.01" y1="12" x2="22.96" y2="12"/>
                        </svg>
                        <span>Checkpoints</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="footer-right-group">
                  <a
                    href={`/api/download?projectId=${activeProject.id}`}
                    className="status-bar-btn"
                    download
                    title="Export project as ZIP"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={10} height={10}>
                      <path d="M12 3v13M7 12l5 5 5-5M5 21h14"/>
                    </svg>
                    <span>Export</span>
                  </a>

                  <button
                    className="status-bar-btn"
                    onClick={() => setShowToolModal(true)}
                    title="Configure tools and MCP"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={10} height={10}>
                      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
                    </svg>
                    <span>Tools</span>
                  </button>
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

      {/* Multi-File Visual Diff & Checkpoint Rollback Reviewer */}
      {showReviewModal && activeProject && (
        <ChangesReviewModal
          projectId={activeProject.id}
          changedFiles={filesChanged}
          onClose={() => setShowReviewModal(false)}
          onRollbackComplete={() => {
            setRefreshExplorerKey((k) => k + 1);
            setFilesChanged([]);
          }}
        />
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
          transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1), flex 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .workspace-column-left--full {
          flex: 1 1 0px !important;
          min-width: 0 !important;
          width: auto !important;
          padding: 12px 6px 12px 12px !important;
        }

        .workspace-columns--resizing .workspace-column-left,
        .workspace-columns--resizing .workspace-column-middle {
          transition: none !important;
          user-select: none !important;
          pointer-events: none !important;
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

        .workspace-column-middle--full {
          padding: 12px 12px 12px 0;
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
          min-width: 0;
          min-height: 0;
          height: 100%;
        }

        .workspace-panels-row {
          flex: 1;
          display: flex;
          flex-direction: row;
          min-width: 0;
          min-height: 0;
          overflow-x: auto;
          overflow-y: hidden;
          background: var(--border-subtle);
          gap: 1px;
        }

        .workspace-panel-slot {
          flex: 1 1 0px;
          min-width: 320px;
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          background: var(--bg-deep);
          overflow: hidden;
          position: relative;
        }

        .panel-slot-header {
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          user-select: none;
        }

        .panel-slot-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
        }

        .panel-slot-badge {
          font-size: 9.5px;
          font-family: var(--font-mono);
          color: var(--text-muted);
          padding: 1px 5px;
          border-radius: 3px;
        }

        .panel-slot-close {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
          padding: 2px 5px;
          border-radius: 3px;
          transition: all var(--transition-fast);
        }

        .panel-slot-close:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .panel-slot-body {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          position: relative;
        }

        .workspace-terminal-container {
          height: 240px;
          min-height: 160px;
          max-height: 50%;
          flex-shrink: 0;
          border-top: 1px solid var(--border-subtle);
          overflow: hidden;
        }

        /* Subtle IDE-style bottom indication bar */
        .app-footer {
          height: 24px;
          min-height: 24px;
          max-height: 24px;
          border-top: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          flex-shrink: 0;
          font-size: 11px;
          user-select: none;
          z-index: 10;
        }

        .footer-left-group,
        .footer-right-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-bar-divider {
          width: 1px;
          height: 12px;
          background: var(--border-subtle);
          margin: 0 2px;
        }

        .status-bar-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10.5px;
          font-weight: 500;
          line-height: 1;
          padding: 2.5px 7px;
          border-radius: var(--radius-sm, 4px);
          cursor: pointer;
          border: 1px solid transparent;
          text-decoration: none;
          transition: all var(--transition-fast);
          color: var(--text-muted);
          background: transparent;
        }

        .status-bar-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .status-bar-btn--execute {
          color: var(--text-secondary);
        }

        .status-bar-indicator {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 10.5px;
        }

        .status-bar-note {
          font-size: 10px;
          color: var(--text-muted);
          font-family: var(--font-mono);
        }

      `}</style>
    </div>
  );
}

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const min  = 60_000;
  const hour = 60 * min;
  const day  = 24 * hour;
  if (diff < min)       return 'just now';
  if (diff < hour)      return `${Math.floor(diff / min)}m ago`;
  if (diff < day)       return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day)   return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
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
      .catch(() => {})
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
          <h1 className="welcome-title font-serif-display">What are we building today?</h1>
          <p className="welcome-desc">
            {mode === 'app'
              ? 'Start a new project, or pick up where you left off.'
              : 'Point the agent at an existing folder on disk.'}
          </p>

          {/* Mode toggle */}
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-tab ${mode === 'app' ? 'mode-tab--active' : ''}`}
              onClick={() => setMode('app')}
            >
              New app
            </button>
            <button
              type="button"
              className={`mode-tab ${mode === 'build' ? 'mode-tab--active' : ''}`}
              onClick={() => setMode('build')}
            >
              Existing folder
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
              <div className="welcome-projects-label">Recent projects</div>
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
                    {p.kind === 'build' && <span className="wp-build-badge">folder</span>}
                    <span className="wp-date">{formatRelativeDate(p.updatedAt)}</span>
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
          max-width: 520px;
          padding: 56px 0 8px;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          text-align: left;
        }

        .welcome-title {
          font-size: 34px;
          font-weight: 400;
          line-height: 1.2;
          color: var(--text-primary);
          margin-bottom: 8px;
        }

        .welcome-desc {
          font-size: 14px;
          color: var(--text-muted);
          line-height: 1.5;
          margin-bottom: 24px;
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
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent);
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
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          margin-bottom: 10px;
          text-align: left;
        }

        .build-mode-notice code {
          font-family: var(--font-mono);
          color: var(--text-secondary);
          background: var(--bg-hover);
          padding: 1px 4px;
          border-radius: 3px;
        }

        .wp-build-badge {
          font-size: 11px;
          color: var(--text-muted);
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
          background: var(--bg-overlay);
          border-color: var(--border-strong);
          color: var(--text-primary);
          font-weight: 500;
        }

        .welcome-btn {
          width: 100%;
          background: var(--accent);
          border: none;
          border-radius: var(--radius-md);
          color: var(--bg-surface);
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
          background: var(--accent-dim);
        }

        .welcome-btn:focus-visible,
        .mode-tab:focus-visible,
        .template-chip:focus-visible,
        .welcome-project-item:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
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
          font-size: 12px;
          color: var(--text-muted);
          font-weight: 500;
          margin-bottom: 8px;
        }

        .welcome-projects-list {
          display: flex;
          flex-direction: column;
          gap: 0;
          max-height: 240px;
          overflow-y: auto;
        }

        .welcome-project-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          height: 32px;
          padding: 0 8px;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 13px;
          text-align: left;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .welcome-project-item:hover {
          background: var(--bg-hover);
        }

        .wp-icon {
          width: 16px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .wp-name {
          flex: 1;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .wp-date {
          font-size: 11px;
          color: var(--text-muted);
          margin-left: auto;
          margin-right: 8px;
          flex-shrink: 0;
        }

        .wp-arrow {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid var(--border-strong);
          border-top-color: var(--bg-surface);
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
