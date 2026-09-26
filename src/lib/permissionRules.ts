import fs from 'fs/promises';
import path from 'path';

/**
 * Claude Code-compatible permission rules from the workspace settings files
 * plus a machine-wide managed file:
 *
 *   { "permissions": { "allow": ["Bash(npm test:*)"], "deny": ["Read(.env)"], "ask": ["run_command(git push*)"] } }
 *
 * Rules are `Tool` or `Tool(specifier)`. Claude Code tool names map onto
 * ours (Bash → run_command, Edit → edit_file/…, Write → create_file,
 * Read → read_file, WebFetch → fetch_url); native names work directly and
 * may use `*` globs (`mcp_github_*`). Precedence: deny > ask > allow, and a
 * managed deny is checked first so no workspace file can relax it.
 */

export type RuleBehavior = 'allow' | 'deny' | 'ask';
export type PermissionDecision = RuleBehavior | 'default';

export interface PermissionRule {
  /** The rule as written, e.g. `Bash(npm test:*)` */
  rule: string;
  behavior: RuleBehavior;
  tool: string;
  specifier?: string;
  /** Settings file the rule came from */
  source: string;
  managed: boolean;
}

export interface PermissionRules {
  rules: PermissionRule[];
  files: string[];
  errors: string[];
}

export interface DecisionResult {
  decision: PermissionDecision;
  rule?: PermissionRule;
}

export const EMPTY_PERMISSION_RULES: PermissionRules = { rules: [], files: [], errors: [] };

export const PERMISSION_SETTINGS_FILES = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.opencode/settings.json',
] as const;

const TOOL_ALIASES: Record<string, string[]> = {
  Bash:     ['run_command'],
  Edit:     ['edit_file', 'replace_lines', 'append_file', 'notebook_edit'],
  Write:    ['create_file'],
  Read:     ['read_file'],
  WebFetch: ['fetch_url'],
};

const PATH_TOOLS = new Set(['edit_file', 'replace_lines', 'append_file', 'notebook_edit', 'create_file', 'read_file', 'delete_file', 'view_image']);

export function managedSettingsPath(): string {
  if (process.env.OPEN_CODE_MANAGED_SETTINGS) return process.env.OPEN_CODE_MANAGED_SETTINGS;
  return process.platform === 'win32'
    ? 'C:\\ProgramData\\OpenCode\\managed-settings.json'
    : '/etc/open-code/managed-settings.json';
}

/** `Bash(npm test:*)` → { tool: 'Bash', specifier: 'npm test:*' } */
export function parseRule(text: string): { tool: string; specifier?: string } | null {
  const m = text.trim().match(/^([\w*.-]+)(?:\(([\s\S]*)\))?$/);
  if (!m) return null;
  const spec = m[2]?.trim();
  return { tool: m[1], specifier: spec ? spec : undefined };
}

export function parsePermissions(raw: unknown, source: string, managed: boolean, errors: string[] = []): PermissionRule[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: PermissionRule[] = [];
  for (const behavior of ['allow', 'deny', 'ask'] as const) {
    const list = (raw as Record<string, unknown>)[behavior];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { errors.push(`${source}: permissions.${behavior} must be an array`); continue; }
    for (const item of list) {
      const parsed = typeof item === 'string' ? parseRule(item) : null;
      if (!parsed) { errors.push(`${source}: invalid rule ${JSON.stringify(item)}`); continue; }
      out.push({ rule: String(item).trim(), behavior, ...parsed, source, managed });
    }
  }
  return out;
}

async function readRules(file: string, label: string, managed: boolean, into: PermissionRules): Promise<void> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      into.errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  into.files.push(label);
  try {
    const parsed = JSON.parse(text) as { permissions?: unknown };
    into.rules.push(...parsePermissions(parsed.permissions, label, managed, into.errors));
  } catch (err) {
    into.errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Managed file first, then the workspace files; missing files are fine. */
export async function loadPermissionRules(workspace: string, managedFile = managedSettingsPath()): Promise<PermissionRules> {
  const out: PermissionRules = { rules: [], files: [], errors: [] };
  if (managedFile) await readRules(managedFile, managedFile, true, out);
  for (const rel of PERMISSION_SETTINGS_FILES) await readRules(path.join(workspace, rel), rel, false, out);
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** `*` anywhere-glob (commands, tool names). */
function simpleGlob(pattern: string, value: string): boolean {
  const re = pattern.split('*').map(escapeRe).join('[\\s\\S]*');
  return new RegExp(`^${re}$`).test(value);
}

function normalizePath(p: string, workspace?: string): string {
  let s = p.replace(/\\/g, '/');
  if (workspace) {
    const ws = workspace.replace(/\\/g, '/').replace(/\/+$/, '');
    if (s.toLowerCase().startsWith(ws.toLowerCase() + '/')) s = s.slice(ws.length + 1);
  }
  return s.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

/** gitignore-ish: `**` crosses directories, `*` does not; a slash-less pattern also matches the basename. */
export function pathGlob(pattern: string, filePath: string, workspace?: string): boolean {
  const pat = normalizePath(pattern);
  const file = normalizePath(filePath, workspace);
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*' && pat[i + 1] === '*') {
      i++;
      if (pat[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += escapeRe(c);
  }
  const rx = new RegExp(`^${re}$`);
  if (rx.test(file)) return true;
  // A directory pattern covers everything under it
  if (new RegExp(`^${re}/`).test(file)) return true;
  return !pat.includes('/') && rx.test(file.split('/').pop() ?? '');
}

/** `npm test:*` = prefix at a word boundary; `cargo *` = glob; otherwise exact. */
export function commandMatches(spec: string, command: string): boolean {
  const cmd = command.trim().replace(/\s+/g, ' ');
  if (spec.endsWith(':*')) {
    const prefix = spec.slice(0, -2).trim().replace(/\s+/g, ' ');
    return cmd === prefix || cmd.startsWith(prefix + ' ');
  }
  if (spec.includes('*')) return simpleGlob(spec.trim().replace(/\s+/g, ' '), cmd);
  return cmd === spec.trim().replace(/\s+/g, ' ');
}

function domainMatches(spec: string, url: string): boolean {
  const domain = spec.replace(/^domain:/, '').trim().toLowerCase();
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  if (domain.startsWith('*.')) return host.endsWith(domain.slice(1));
  return host === domain || host.endsWith('.' + domain);
}

function toolMatches(ruleTool: string, toolName: string): boolean {
  const aliases = TOOL_ALIASES[ruleTool];
  if (aliases) return aliases.includes(toolName);
  return ruleTool.includes('*') ? simpleGlob(ruleTool, toolName) : ruleTool === toolName;
}

export function ruleMatches(rule: PermissionRule, toolName: string, args: Record<string, unknown>, workspace?: string): boolean {
  if (!toolMatches(rule.tool, toolName)) return false;
  const spec = rule.specifier;
  if (!spec || spec === '*') return true;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  if (toolName === 'run_command') {
    const cmd = str(args.command);
    return cmd !== undefined && commandMatches(spec, cmd);
  }
  if (toolName === 'fetch_url' || toolName === 'http_request') {
    const url = str(args.url);
    if (url === undefined) return false;
    return spec.startsWith('domain:') ? domainMatches(spec, url) : simpleGlob(spec, url);
  }
  if (PATH_TOOLS.has(toolName)) {
    const p = str(args.path) ?? str(args.file_path);
    return p !== undefined && pathGlob(spec, p, workspace);
  }
  // Other tools: glob against the most identifying string argument
  const target = str(args.command) ?? str(args.path) ?? str(args.url) ?? str(args.kind) ?? str(args.name);
  return target !== undefined && simpleGlob(spec, target);
}

export function decide(
  rules: PermissionRules | PermissionRule[],
  toolName: string,
  args: Record<string, unknown>,
  workspace?: string,
): DecisionResult {
  const list = Array.isArray(rules) ? rules : rules.rules;
  const find = (pred: (r: PermissionRule) => boolean) =>
    list.find((r) => pred(r) && ruleMatches(r, toolName, args, workspace));
  const hit =
    find((r) => r.managed && r.behavior === 'deny') ??
    find((r) => r.behavior === 'deny') ??
    find((r) => r.behavior === 'ask') ??
    find((r) => r.behavior === 'allow');
  return hit ? { decision: hit.behavior, rule: hit } : { decision: 'default' };
}
