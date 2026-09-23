'use client';

import { useEffect } from 'react';
import {
  useCommandPaletteStore,
  type Command,
} from '@/hooks/useCommandPalette';
import { shortcutRegistry, formatShortcut } from '@/lib/shortcuts';
import type { ActiveTab } from '@/app/page';
import type { Project } from '@/types';

interface AppCommandsOpts {
  projects:        Project[];
  activeProject:   Project | null;
  activeTab:       ActiveTab;
  activeFile:      string | null;
  isStreaming:     boolean;
  onTabChange:     (t: ActiveTab) => void;
  onProjectSelect: (p: Project | null) => void;
  onSidebarToggle: () => void;
  onNewProject:    () => void;
  onCancelStream:  () => void;
  onClearChat:     () => void;
  onFocusChat:     () => void;
  onSaveFile:      () => void;
  onRevertFile:    () => void;
  onToggleDiff:    () => void;
}

export function useAppCommands(opts: AppCommandsOpts) {
  const { setCommands } = useCommandPaletteStore();

  useEffect(() => {
    const {
      projects,
      activeProject,
      activeTab,
      activeFile,
      isStreaming,
      onTabChange,
      onProjectSelect,
      onSidebarToggle,
      onNewProject,
      onCancelStream,
      onClearChat,
      onFocusChat,
      onSaveFile,
      onRevertFile,
      onToggleDiff,
    } = opts;

    const commands: Command[] = [
      // ── Navigation ─────────────────────────────────────────────────────
      {
        id:          'nav.editor',
        label:       'Go to Editor',
        description: 'Open the code editor',
        icon:        '⌨',
        group:       'navigation',
        shortcut:    '⌘1',
        keywords:    ['code', 'editor', 'file'],
        action:      () => onTabChange('editor'),
        disabled:    activeTab === 'editor',
      },
      {
        id:          'nav.preview',
        label:       'Go to Preview',
        description: 'Open the live preview',
        icon:        '⊡',
        group:       'navigation',
        shortcut:    '⌘2',
        keywords:    ['browser', 'preview', 'run'],
        action:      () => onTabChange('preview'),
        disabled:    activeTab === 'preview',
      },
      {
        id:          'nav.settings',
        label:       'Go to Settings',
        description: 'Open settings panel',
        icon:        '⚙',
        group:       'navigation',
        shortcut:    '⌘3',
        keywords:    ['config', 'settings', 'preferences'],
        action:      () => onTabChange('settings'),
        disabled:    activeTab === 'settings',
      },
      {
        id:          'nav.sidebar',
        label:       'Toggle Sidebar',
        description: 'Show or hide the project sidebar',
        icon:        '☰',
        group:       'navigation',
        shortcut:    '⌘B',
        action:      onSidebarToggle,
      },

      // ── Project ─────────────────────────────────────────────────────────
      {
        id:          'project.new',
        label:       'New Project',
        description: 'Create a new workspace',
        icon:        '+',
        group:       'project',
        shortcut:    '⌘N',
        keywords:    ['create', 'new', 'workspace'],
        action:      onNewProject,
      },
      ...projects.slice(0, 5).map((p) => ({
        id:          `project.switch.${p.id}`,
        label:       `Switch to: ${p.title}`,
        description: 'Open this project',
        icon:        '●',
        group:       'project',
        keywords:    ['switch', 'open', 'project', p.title],
        action:      () => onProjectSelect(p),
        disabled:    activeProject?.id === p.id,
      })),

      // ── Chat ─────────────────────────────────────────────────────────────
      {
        id:          'chat.focus',
        label:       'Focus Chat Input',
        description: 'Move cursor to chat input',
        icon:        '💬',
        group:       'chat',
        shortcut:    '⌘L',
        keywords:    ['chat', 'message', 'input', 'focus'],
        action:      onFocusChat,
      },
      {
        id:          'chat.cancel',
        label:       'Cancel Agent',
        description: 'Stop the current agent run',
        icon:        '■',
        group:       'chat',
        shortcut:    '⌘.',
        keywords:    ['stop', 'cancel', 'abort'],
        action:      onCancelStream,
        disabled:    !isStreaming,
      },
      {
        id:          'chat.clear',
        label:       'Clear Chat Timeline',
        description: 'Remove all timeline events',
        icon:        '🗑',
        group:       'chat',
        keywords:    ['clear', 'reset', 'clean'],
        action:      onClearChat,
      },

      // ── Editor ──────────────────────────────────────────────────────────
      {
        id:          'editor.save',
        label:       'Save File',
        description: activeFile ? `Save ${activeFile}` : 'Save current file',
        icon:        '💾',
        group:       'editor',
        shortcut:    '⌘S',
        keywords:    ['save', 'write'],
        action:      onSaveFile,
        disabled:    !activeFile,
      },
      {
        id:          'editor.revert',
        label:       'Revert File',
        description: 'Revert to last git commit',
        icon:        '↩',
        group:       'editor',
        shortcut:    '⌘Z',
        keywords:    ['revert', 'undo', 'restore', 'git'],
        action:      onRevertFile,
        disabled:    !activeFile,
      },
      {
        id:          'editor.diff',
        label:       'Toggle Diff View',
        description: 'Compare with git HEAD',
        icon:        '⟷',
        group:       'editor',
        shortcut:    '⌘D',
        keywords:    ['diff', 'compare', 'changes'],
        action:      onToggleDiff,
        disabled:    !activeFile,
      },

      // ── System ───────────────────────────────────────────────────────────
      {
        id:          'system.health',
        label:       'Open Health Check',
        description: 'View system health status',
        icon:        '♥',
        group:       'system',
        keywords:    ['health', 'status', 'api'],
        action:      () => window.open('/api/health', '_blank'),
      },
      {
        id:          'system.metrics',
        label:       'Open Metrics',
        description: 'View Prometheus metrics',
        icon:        '📊',
        group:       'system',
        keywords:    ['metrics', 'prometheus', 'stats'],
        action:      () => window.open('/api/metrics', '_blank'),
      },
      {
        id:          'system.shortcuts',
        label:       'Show Keyboard Shortcuts',
        description: 'View all keyboard shortcuts',
        icon:        '⌨',
        group:       'system',
        keywords:    ['shortcuts', 'hotkeys', 'help', 'keyboard'],
        action:      () => {
          // Registered ids come in .ctrl/.meta pairs — show one per base id
          const seen = new Set<string>();
          const lines = shortcutRegistry
            .getAll()
            .filter((s) => {
              const baseId = s.id.replace(/\.(ctrl|meta)$/, '');
              if (seen.has(baseId)) return false;
              seen.add(baseId);
              return true;
            })
            .map((s) => `${formatShortcut(s).padEnd(10)} ${s.label}`);
          window.alert(`Keyboard shortcuts\n\n${lines.join('\n')}`);
        },
      },
    ];

    setCommands(commands);
  }, [
    opts.projects.map((p) => p.id).join(','),
    opts.activeProject?.id,
    opts.activeTab,
    opts.activeFile,
    opts.isStreaming,
  ]);
}
