/** Friendly timeline labels for the built-in browser_* agent tools. */
export function browserToolLabel(toolName: string | undefined, args: Record<string, unknown> | undefined): string | null {
  if (!toolName || !toolName.startsWith('browser_')) return null;
  const a = args ?? {};
  const s = (v: unknown, n = 60) => String(v ?? '').slice(0, n);
  switch (toolName) {
    case 'browser_open': return a.url ? `Opening ${s(a.url, 80)}` : 'Opening the preview in the browser';
    case 'browser_snapshot': return 'Reading the page';
    case 'browser_click': return `Clicking ${s(a.ref)}`;
    case 'browser_type': return `Typing "${s(a.text, 40)}" into ${s(a.ref)}${a.submit ? ' and submitting' : ''}`;
    case 'browser_press': return `Pressing ${s(a.key)}`;
    case 'browser_select': return `Selecting ${Array.isArray(a.values) ? a.values.join(', ').slice(0, 60) : ''} in ${s(a.ref)}`;
    case 'browser_scroll': return `Scrolling ${s(a.direction) || 'down'}`;
    case 'browser_wait': return a.text ? `Waiting for "${s(a.text, 40)}"` : `Waiting ${s(a.ms) || '1000'}ms`;
    case 'browser_console': return 'Checking browser console';
    case 'browser_screenshot': return `Taking a${a.fullPage ? ' full-page' : ''} screenshot`;
    case 'browser_close': return 'Closing the browser';
    default: return null;
  }
}
