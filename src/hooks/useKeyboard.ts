import { useEffect, useRef } from 'react';
import {
  shortcutRegistry,
  type Shortcut,
} from '@/lib/shortcuts';

// ── Register shortcuts for a component ───────────────────────────────────────
export function useShortcuts(shortcuts: Shortcut[]) {
  const shortcutsRef = useRef(shortcuts);

  // Keep the ref current without writing it during render
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  });

  useEffect(() => {
    const unregister = shortcutRegistry.registerMany(
      shortcutsRef.current
    );
    return unregister;
  }, []); // Register once
}

// ── Global keyboard listener ──────────────────────────────────────────────────
export function useGlobalKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      shortcutRegistry.handle(e);
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);
}

// ── Single shortcut hook ──────────────────────────────────────────────────────
export function useHotkey(
  key: string,
  modifiers: Shortcut['modifiers'],
  action: () => void,
  opts: { global?: boolean; enabled?: boolean } = {}
) {
  const actionRef = useRef(action);

  useEffect(() => {
    actionRef.current = action;
  });

  useEffect(() => {
    if (opts.enabled === false) return;

    const handler = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable;

      if (isInput && !opts.global) return;

      const matches =
        e.key.toLowerCase() === key.toLowerCase() &&
        modifiers.every((mod) => {
          if (mod === 'meta')  return e.metaKey;
          if (mod === 'ctrl')  return e.ctrlKey;
          if (mod === 'alt')   return e.altKey;
          if (mod === 'shift') return e.shiftKey;
          return false;
        });

      if (matches) {
        e.preventDefault();
        actionRef.current();
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [key, modifiers.join(','), opts.global, opts.enabled]);
}
