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
        label:       'Go to editor',
        description: 'Open the code editor',
        group:       'navigation',
        shortcut:    '⌘1',
        keywords:    ['code', 'editor', 'file'],
        action:      () => onTabChange('editor'),
        disabled:    activeTab === 'editor',
      },
      {
        id:          'nav.preview',
        label:       'Go to preview',
        description: 'Open the live preview',
        group:       'navigation',
        shortcut:    '⌘2',
        keywords:    ['browser', 'preview', 'run'],
        action:      () => onTabChange('preview'),
        disabled:    activeTab === 'preview',
      },
      {
        id:          'nav.settings',
        label:       'Go to settings',
        description: 'Open settings panel',
        group:       'navigation',
        shortcut:    '⌘3',
        keywords:    ['config', 'settings', 'preferences'],
        action:      () => onTabChange('settings'),
        disabled:    activeTab === 'settings',
      },
      {
        id:          'nav.sidebar',
        label:       'Toggle sidebar',
        description: 'Show or hide the project sidebar',
        group:       'navigation',
        shortcut:    '⌘B',
        action:      onSidebarToggle,
      },

      // ── Project ─────────────────────────────────────────────────────────
      {
        id:          'project.new',
        label:       'New project',
        description: 'Create a new workspace',
        group:       'project',
        shortcut:    '⌘N',
        keywords:    ['create', 'new', 'workspace'],
        action:      onNewProject,
      },
      ...projects.slice(0, 5).map((p) => ({
        id:          `project.switch.${p.id}`,
        label:       `Switch to ${p.title}`,
        description: 'Open this project',
        group:       'project',
        keywords:    ['switch', 'open', 'project', p.title],
        action:      () => onProjectSelect(p),
        disabled:    activeProject?.id === p.id,
      })),

      // ── Chat ─────────────────────────────────────────────────────────────
      {
        id:          'chat.focus',
        label:       'Focus chat input',
        description: 'Move cursor to chat input',
        group:       'chat',
        shortcut:    '⌘L',
        keywords:    ['chat', 'message', 'input', 'focus'],
        action:      onFocusChat,
      },
      {
        id:          'chat.cancel',
        label:       'Cancel agent',
        description: 'Stop the current agent run',
        group:       'chat',
        shortcut:    '⌘.',
        keywords:    ['stop', 'cancel', 'abort'],
        action:      onCancelStream,
        disabled:    !isStreaming,
      },
      {
        id:          'chat.clear',
        label:       'Clear chat timeline',
        description: 'Remove all timeline events',
        group:       'chat',
        keywords:    ['clear', 'reset', 'clean'],
        action:      onClearChat,
      },

      // ── Editor ──────────────────────────────────────────────────────────
      {
        id:          'editor.save',
        label:       'Save file',
        description: activeFile ? `Save ${activeFile}` : 'Save current file',
        group:       'editor',
        shortcut:    '⌘S',
        keywords:    ['save', 'write'],
        action:      onSaveFile,
        disabled:    !activeFile,
      },
      {
        id:          'editor.revert',
        label:       'Revert file',
        description: 'Revert to last git commit',
        group:       'editor',
        shortcut:    '⌘Z',
        keywords:    ['revert', 'undo', 'restore', 'git'],
        action:      onRevertFile,
        disabled:    !activeFile,
      },
      {
        id:          'editor.diff',
        label:       'Toggle diff view',
        description: 'Compare with git HEAD',
        group:       'editor',
        shortcut:    '⌘D',
        keywords:    ['diff', 'compare', 'changes'],
        action:      onToggleDiff,
        disabled:    !activeFile,
      },

      // ── System ───────────────────────────────────────────────────────────
      {
        id:          'system.health',
        label:       'Open health check',
        description: 'View system health status',
        group:       'system',
        keywords:    ['health', 'status', 'api'],
        action:      () => window.open('/api/health', '_blank'),
      },
      {
        id:          'system.metrics',
        label:       'Open metrics',
        description: 'View Prometheus metrics',
        group:       'system',
        keywords:    ['metrics', 'prometheus', 'stats'],
        action:      () => window.open('/api/metrics', '_blank'),
      },
      {
        id:          'system.shortcuts',
        label:       'Show keyboard shortcuts',
        description: 'View all keyboard shortcuts',
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
