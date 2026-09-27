import path from 'path';

/**
 * The protected core of "Upgrade OpenCode".
 *
 * A candidate may change OpenCode, but never the authority that decides
 * whether its change is acceptable. Two layers enforce that:
 *  1. upgradeToolGuard() — called by the agent loop (main-checkout code) before
 *     every tool call in an upgrade worktree; refuses writes to protected paths
 *     and git/dependency operations the controller owns.
 *  2. The gate (gate.ts) re-checks the final diff against PROTECTED_PATHS, so a
 *     write that slipped past layer 1 (e.g. via a shell command) still fails.
 * Both run from the main checkout; the candidate's copy of this file is inert.
 */

/** Repo-relative globs a candidate may not touch. */
export const PROTECTED_PATHS = [
  'src/lib/upgrade/**',          // controller, gate, guard, store
  'src/app/api/upgrade/**',      // the only route that commits / pushes
  'tests/upgrade/**',            // the gate's own tests
  'src/lib/permissionRules.ts',  // permission policy
  'src/lib/permissions.ts',
  'vitest.config.ts',            // what "the tests" means
  'tsconfig.json',               // what "it typechecks" means
  'package.json',                // scripts + dependencies (no installs in this milestone)
  'package-lock.json',
  '.claude/**',
  '.github/**',
  '.opencode/**',
] as const;

/** Where upgrade worktrees live, relative to the main checkout. */
export const UPGRADE_WORKTREE_DIR = path.join('.claude', 'worktrees');
export const UPGRADE_WORKTREE_PREFIX = 'upgrade-';

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function globToRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

const PROTECTED_RES = PROTECTED_PATHS.map(globToRe);

/** Is this repo-relative path protected? (case-insensitive — Windows) */
export function isProtectedPath(repoRelative: string): boolean {
  const p = norm(repoRelative);
  return PROTECTED_RES.some((re) => re.test(p) || re.test(p + '/'));
}

/** The worktree root when `workspace` is (inside) an upgrade worktree of `mainRoot`, else null. */
export function upgradeWorktreeRoot(workspace: string, mainRoot = process.cwd()): string | null {
  const base = norm(path.resolve(mainRoot, UPGRADE_WORKTREE_DIR)).toLowerCase() + '/';
  const ws = norm(path.resolve(workspace));
  if (!ws.toLowerCase().startsWith(base)) return null;
  const first = ws.slice(base.length).split('/')[0];
  if (!first.startsWith(UPGRADE_WORKTREE_PREFIX)) return null;
  return ws.slice(0, base.length + first.length);
}

const PATH_ARG_KEYS = ['path', 'file_path', 'filePath', 'target', 'destination', 'dest', 'from', 'to', 'source', 'new_path', 'old_path', 'notebook_path', 'cwd'];

const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_files', 'glob_files', 'grep_files', 'view_image', 'read_many_files',
  'lsp_definition', 'lsp_references', 'lsp_hover', 'lsp_diagnostics', 'lsp_symbols',
]);

/** Shell commands the controller owns (git history, remotes) or that would
 *  mutate the shared node_modules junction. */
const FORBIDDEN_COMMANDS: { re: RegExp; why: string }[] = [
  // Any subcommand position (`git -C . checkout`, `git -c x=y commit`); may over-block rare read-only commands
  { re: /\bgit\b[^|;&\n]*?\s(commit|push|reset|checkout|switch|branch|rebase|merge|stash|worktree|tag|remote|config|update-ref|filter-branch|cherry-pick|revert|am|clean)\b/i,
    why: 'git history and branches are managed by the Upgrade controller — leave your changes uncommitted in the worktree' },
  { re: /\bgh\s+/i, why: 'pull requests are created by the Upgrade controller after the user authorizes a push' },
  { re: /\b(npm|pnpm|yarn|bun)\s+(i|install|ci|add|remove|rm|uninstall|update|up|upgrade|link)\b/i,
    why: 'dependency changes are not supported in this milestone (node_modules is shared with the main checkout)' },
  { re: /node_modules/i, why: 'node_modules is shared with the main checkout and must not be touched' },
  { re: /\bmanaged-settings\b/i, why: 'managed settings are part of the protected core' },
];

export interface GuardVerdict { allowed: boolean; reason?: string }

/**
 * Called before each tool call. Allows everything outside upgrade worktrees.
 * `workspace` is the tool's workspace root (the worktree).
 */
export function upgradeToolGuard(
  workspace: string,
  toolName: string,
  args: Record<string, unknown>,
  mainRoot = process.cwd(),
): GuardVerdict {
  const root = upgradeWorktreeRoot(workspace, mainRoot);
  if (!root) return { allowed: true };

  if (toolName === 'run_command' || toolName === 'run_background') {
    const cmd = String(args.command ?? '');
    for (const f of FORBIDDEN_COMMANDS) {
      if (f.re.test(cmd)) return { allowed: false, reason: `Upgrade mode: ${f.why}` };
    }
    for (const g of PROTECTED_PATHS) {
      const literal = g.replace(/\/\*\*$/, '');
      if (cmd.replace(/\\/g, '/').toLowerCase().includes(literal.toLowerCase()) && /(>|\b(rm|del|mv|cp|sed\s+-i|tee|Set-Content|Out-File|Remove-Item|Move-Item|Copy-Item|touch|echo)\b)/i.test(cmd)) {
        return { allowed: false, reason: `Upgrade mode: \`${g}\` is part of the protected core and cannot be modified` };
      }
    }
    return { allowed: true };
  }

  if (READ_ONLY_TOOLS.has(toolName)) return { allowed: true };

  const paths: string[] = [];
  for (const k of PATH_ARG_KEYS) {
    const v = args[k];
    if (typeof v === 'string' && v) paths.push(v);
  }
  if (Array.isArray(args.edits)) {
    for (const e of args.edits) {
      const p = (e as Record<string, unknown>)?.path ?? (e as Record<string, unknown>)?.file_path;
      if (typeof p === 'string') paths.push(p);
    }
  }
  for (const p of paths) {
    const abs = path.resolve(root, p);
    const rel = norm(path.relative(root, abs));
    if (rel.startsWith('../') || rel === '..') {
      return { allowed: false, reason: `Upgrade mode: ${p} is outside the upgrade worktree` };
    }
    if (rel === 'node_modules' || rel.startsWith('node_modules/')) {
      return { allowed: false, reason: 'Upgrade mode: node_modules is shared with the main checkout and must not be touched' };
    }
    if (isProtectedPath(rel)) {
      return { allowed: false, reason: `Upgrade mode: ${rel} is part of the protected core (${PROTECTED_PATHS.join(', ')}) and cannot be modified` };
    }
  }
  return { allowed: true };
}

/** Test files: deleting one, or adding skip/only markers, fails the gate. */
export function isTestFile(p: string): boolean {
  const n = norm(p);
  return /(^|\/)tests?\//i.test(n) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(n);
}

const SKIP_MARKERS = /\b(?:it|test|describe|suite|bench)\s*\.\s*(?:skip|only|todo|skipIf|runIf)\b|\bx(?:it|describe|test)\s*\(|\bf(?:it|describe)\s*\(/;

/** Added lines (from a unified diff) that disable or focus tests. */
export function findSkipMarkers(diff: string): { file: string; line: string }[] {
  const hits: { file: string; line: string }[] = [];
  let file = '';
  for (const l of diff.split(/\r?\n/)) {
    if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, ''); continue; }
    if (!file || !isTestFile(file)) continue;
    if (l.startsWith('+') && !l.startsWith('+++') && SKIP_MARKERS.test(l)) hits.push({ file, line: l.slice(1).trim().slice(0, 160) });
  }
  return hits;
}
