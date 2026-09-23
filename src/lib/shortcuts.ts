// ─── Types ────────────────────────────────────────────────────────────────────
export type ShortcutModifier = 'meta' | 'ctrl' | 'alt' | 'shift';

export interface Shortcut {
  id:          string;
  key:         string;
  modifiers:   ShortcutModifier[];
  label:       string;
  description: string;
  group:       ShortcutGroup;
  global?:     boolean;   // Works even when input focused
  condition?:  () => boolean;
  action:      () => void;
}

export type ShortcutGroup =
  | 'navigation'
  | 'editor'
  | 'chat'
  | 'project'
  | 'view'
  | 'system';

// ─── Format shortcut for display ─────────────────────────────────────────────
export function formatShortcut(shortcut: Shortcut): string {
  if (typeof window === 'undefined') return '';
  const isMac = navigator.platform.includes('Mac');
  const parts: string[] = [];

  for (const mod of shortcut.modifiers) {
    if (mod === 'meta')  parts.push(isMac ? '⌘' : 'Ctrl');
    if (mod === 'ctrl')  parts.push(isMac ? '⌃' : 'Ctrl');
    if (mod === 'alt')   parts.push(isMac ? '⌥' : 'Alt');
    if (mod === 'shift') parts.push(isMac ? '⇧' : 'Shift');
  }

  parts.push(shortcut.key.toUpperCase());
  return parts.join('');
}

// ─── Match event to shortcut ──────────────────────────────────────────────────
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: Shortcut
): boolean {
  const key = event.key.toLowerCase();
  const def = shortcut.key.toLowerCase();

  if (key !== def) return false;

  for (const mod of shortcut.modifiers) {
    if (mod === 'meta'  && !event.metaKey)  return false;
    if (mod === 'ctrl'  && !event.ctrlKey)  return false;
    if (mod === 'alt'   && !event.altKey)   return false;
    if (mod === 'shift' && !event.shiftKey) return false;
  }

  // Make sure no extra modifiers pressed
  if (!shortcut.modifiers.includes('meta')  && event.metaKey)  return false;
  if (!shortcut.modifiers.includes('ctrl')  && event.ctrlKey)  return false;
  if (!shortcut.modifiers.includes('alt')   && event.altKey)   return false;
  if (!shortcut.modifiers.includes('shift') && event.shiftKey) return false;

  return true;
}

// ─── Registry ─────────────────────────────────────────────────────────────────
class ShortcutRegistry {
  private shortcuts = new Map<string, Shortcut>();
  private listeners = new Set<() => void>();

  register(shortcut: Shortcut): () => void {
    this.shortcuts.set(shortcut.id, shortcut);
    this.notify();
    return () => {
      this.shortcuts.delete(shortcut.id);
      this.notify();
    };
  }

  registerMany(shortcuts: Shortcut[]): () => void {
    const unsubscribers = shortcuts.map((s) => this.register(s));
    return () => unsubscribers.forEach((fn) => fn());
  }

  getAll(): Shortcut[] {
    return [...this.shortcuts.values()];
  }

  getByGroup(group: ShortcutGroup): Shortcut[] {
    return this.getAll().filter((s) => s.group === group);
  }

  handle(event: KeyboardEvent): boolean {
    const isInput =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target as HTMLElement)?.isContentEditable;

    for (const shortcut of this.shortcuts.values()) {
      // Skip non-global shortcuts when typing in inputs
      if (isInput && !shortcut.global) continue;

      if (!matchesShortcut(event, shortcut)) continue;
      if (shortcut.condition && !shortcut.condition()) continue;

      event.preventDefault();
      event.stopPropagation();
      shortcut.action();
      return true;
    }
    return false;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }
}

export const shortcutRegistry = new ShortcutRegistry();
