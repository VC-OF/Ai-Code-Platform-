'use client';

import { useState, useCallback } from 'react';
import MobileHeader  from './MobileHeader';
import MobileNav     from './MobileNav';
import MobileDrawer  from './MobileDrawer';
import Sidebar       from '@/components/layout/Sidebar';
import ChatPanel     from '@/components/chat/ChatPanel';
import EditorPanel   from '@/components/editor/EditorPanel';
import PreviewPanel  from '@/components/preview/PreviewPanel';
import SettingsPanel from '@/components/settings/SettingsPanel';
import CommandPalette from '@/components/command/CommandPalette';
import { useCommandPaletteStore } from '@/hooks/useCommandPalette';
import type { Project } from '@/types';
import type { ActiveTab } from '@/app/page';

interface MobileLayoutProps {
  activeProject:   Project | null;
  onProjectSelect: (p: Project | null) => void;
  activeTab:       ActiveTab;
  onTabChange:     (t: ActiveTab) => void;
  activeFile:      string | null;
  onFileSelect:    (path: string) => void;
  filesChanged:    string[];
  onFilesChanged:  (files: string[]) => void;
}

export default function MobileLayout({
  activeProject,
  onProjectSelect,
  activeTab,
  onTabChange,
  activeFile,
  onFileSelect,
  filesChanged,
  onFilesChanged,
}: MobileLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const { toggle: togglePalette } = useCommandPaletteStore();

  const handleProjectSelect = useCallback((p: Project | null) => {
    onProjectSelect(p);
    setMenuOpen(false);
  }, [onProjectSelect]);

  const handleFileSelect = useCallback((path: string) => {
    onFileSelect(path);
    setChatOpen(false);
  }, [onFileSelect]);

  return (
    <div className="mobile-shell">
      {/* Header */}
      <MobileHeader
        project={activeProject}
        status="done"
        onMenuOpen={() => setMenuOpen(true)}
        onPaletteOpen={togglePalette}
      />

      {/* Main Area */}
      <main className="mobile-main">
        {activeProject ? (
          <div className="mobile-content">
            {activeTab === 'editor' && (
              <EditorPanel
                projectId={activeProject.id}
                activeFile={activeFile}
                onFileSelect={handleFileSelect}
                changedFiles={filesChanged}
              />
            )}
            {activeTab === 'preview' && (
              <PreviewPanel projectId={activeProject.id} />
            )}
            {activeTab === 'settings' && (
              <SettingsPanel project={activeProject} />
            )}

            {/* Floating Chat Button */}
            <button
              className="chat-fab"
              onClick={() => setChatOpen(true)}
              aria-label="Open chat"
              title="Open chat"
            >
              <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="mobile-empty">
            <Sidebar
              open={true}
              activeProject={activeProject}
              onProjectSelect={handleProjectSelect}
              onToggle={() => {}}
            />
          </div>
        )}
      </main>

      {/* Navigation */}
      {activeProject && (
        <MobileNav
          active={activeTab}
          onChange={onTabChange}
          badge={filesChanged.length}
        />
      )}

      {/* Left Drawer (Menu / Sidebar) */}
      <MobileDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Projects"
        side="left"
      >
        <Sidebar
          open={true}
          activeProject={activeProject}
          onProjectSelect={handleProjectSelect}
          onToggle={() => setMenuOpen(false)}
        />
      </MobileDrawer>

      {/* Bottom Drawer (ChatPanel) */}
      <MobileDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        title="Chat"
        side="bottom"
      >
        <div style={{ height: '70vh' }}>
          <ChatPanel
            projectId={activeProject?.id ?? ''}
            activeFilePath={activeFile ?? undefined}
            onFilesChanged={onFilesChanged}
            onFileSelect={handleFileSelect}
          />
        </div>
      </MobileDrawer>

      {/* Command Palette */}
      <CommandPalette />

      <style jsx>{`
        .mobile-shell {
          display: flex;
          flex-direction: column;
          height: 100vh;
          height: 100dvh;
          overflow: hidden;
          background: var(--bg-base);
        }

        .mobile-main {
          flex: 1;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .mobile-content {
          flex: 1;
          position: relative;
          overflow: hidden;
        }

        .mobile-empty {
          flex: 1;
          padding: var(--space-4);
          display: flex;
          flex-direction: column;
          background: var(--bg-surface);
        }

        .chat-fab {
          position: fixed;
          bottom: calc(var(--tab-bar-height) + 24px);
          right: 20px;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: var(--accent);
          color: var(--bg-surface);
          border: none;
          box-shadow: var(--shadow-md);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 50;
        }

        .chat-fab:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
