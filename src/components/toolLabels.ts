import { browserToolLabel } from './browserToolLabels';

/** Friendly timeline labels for agent tools that read better than raw JSON args. */
export function toolLabel(toolName: string | undefined, args: Record<string, unknown> | undefined): string | null {
  const browser = browserToolLabel(toolName, args);
  if (browser) return browser;
  if (!toolName) return null;
  const a = args ?? {};
  const s = (v: unknown, n = 60) => String(v ?? '').slice(0, n);
  switch (toolName) {
    case 'execute_code': {
      const lang = s(a.language, 12) || 'code';
      const lines = String(a.code ?? '').split('\n').length;
      return `Running ${lang} snippet (${lines} line${lines === 1 ? '' : 's'})${a.description ? `: ${s(a.description, 80)}` : ''}`;
    }
    case 'view_image': return `Looking at ${s(a.path, 80)}`;
    case 'notebook_edit': {
      const action = s(a.action, 10) || 'edit';
      return `${action.charAt(0).toUpperCase()}${action.slice(1)} cell ${s(a.cell_index, 5)} in ${s(a.path, 60)}`;
    }
    case 'run_notebook': return `Executing notebook ${s(a.path, 80)}`;
    case 'save_memory': return `Remembering: ${s(a.text, 90)}`;
    case 'spawn_agent': return `Delegating to ${s(a.kind, 10)} sub-agent${a.label ? ` "${s(a.label, 40)}"` : ''}`;
    case 'load_skill': return `Loading skill ${s(a.name, 40)}`;
    case 'web_search': return `Searching the web: ${s(a.query, 80)}`;
    case 'fetch_url': return `Reading ${s(a.url, 90)}`;
    default: return null;
  }
}
