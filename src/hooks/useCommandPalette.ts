import { create } from 'zustand';

export interface Command {
  id:          string;
  label:       string;
  description?: string;
  icon?:       string;
  group:       string;
  shortcut?:   string;
  keywords?:   string[];
  action:      () => void;
  disabled?:   boolean;
}

interface CommandPaletteStore {
  open:        boolean;
  query:       string;
  commands:    Command[];
  setOpen:     (open: boolean) => void;
  setQuery:    (query: string) => void;
  setCommands: (commands: Command[]) => void;
  toggle:      () => void;
  close:       () => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>(
  (set) => ({
    open:     false,
    query:    '',
    commands: [],

    setOpen:  (open)     => set({ open, query: '' }),
    setQuery: (query)    => set({ query }),
    setCommands: (cmds)  => set({ commands: cmds }),
    toggle:   ()         => set((s) => ({ open: !s.open, query: '' })),
    close:    ()         => set({ open: false, query: '' }),
  })
);

// ─── Filter commands by query ─────────────────────────────────────────────────
export function filterCommands(
  commands: Command[],
  query: string
): Command[] {
  if (!query.trim()) return commands;

  const q = query.toLowerCase();

  return commands
    .filter((cmd) => {
      if (cmd.disabled) return false;

      const searchable = [
        cmd.label,
        cmd.description ?? '',
        cmd.group,
        ...(cmd.keywords ?? []),
      ]
        .join(' ')
        .toLowerCase();

      return searchable.includes(q);
    })
    .sort((a, b) => {
      // Exact label match first
      const aExact = a.label.toLowerCase().startsWith(q) ? -1 : 0;
      const bExact = b.label.toLowerCase().startsWith(q) ? -1 : 0;
      return aExact - bExact;
    });
}

// ─── Group commands ───────────────────────────────────────────────────────────
export function groupCommands(
  commands: Command[]
): Map<string, Command[]> {
  const groups = new Map<string, Command[]>();

  for (const cmd of commands) {
    if (!groups.has(cmd.group)) {
      groups.set(cmd.group, []);
    }
    groups.get(cmd.group)!.push(cmd);
  }

  return groups;
}
