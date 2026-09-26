import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import os from 'os';
import path from 'path';

/**
 * Memory files (Claude Code compatible): project instructions loaded into
 * the system prompt, plus per-directory CLAUDE.md / AGENTS.md surfaced
 * lazily when read_file enters that directory.
 */

export interface MemoryFile {
  /** Display label, e.g. "CLAUDE.md" or "~/.claude/CLAUDE.md" */
  name: string;
  path: string;
  content: string;
  scope: 'project' | 'user';
}

/** Loaded from the workspace root, in this order. */
export const PROJECT_MEMORY_FILES = ['AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md'];
/** Looked for in subdirectories by read_file. */
export const DIRECTORY_MEMORY_FILES = ['CLAUDE.md', 'AGENTS.md'];

const MAX_IMPORT_DEPTH = 5;
const MAX_DIR_MEMORY_CHARS = 20_000;
const IMPORT_LINE = /^\s*@(\S+)\s*$/;

function homeDir(home?: string): string {
  return home ?? os.homedir();
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function realOrSelf(p: string): string {
  try { return realpathSync(p); } catch { return path.resolve(p); }
}

function readText(p: string): string | undefined {
  try {
    if (!statSync(p).isFile()) return undefined;
    return readFileSync(p, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Replace `@path` lines with the referenced file's content. Paths resolve
 * relative to the importing file (`~/` = home), must stay inside one of
 * `roots`, recurse up to 5 levels, and cycles are skipped. Unresolvable
 * imports are left as written.
 */
export function expandImports(
  content: string,
  filePath: string,
  roots: string[],
  opts: { home?: string; depth?: number; seen?: Set<string> } = {}
): string {
  const depth = opts.depth ?? 0;
  const seen = opts.seen ?? new Set([realOrSelf(filePath)]);
  const realRoots = roots.map(realOrSelf);
  return content.split(/\r?\n/).map((line) => {
    const m = line.match(IMPORT_LINE);
    if (!m || depth >= MAX_IMPORT_DEPTH) return line;
    const ref = m[1];
    const target = ref.startsWith('~/')
      ? path.join(homeDir(opts.home), ref.slice(2))
      : path.resolve(path.dirname(filePath), ref);
    const real = realOrSelf(target);
    if (!realRoots.some((r) => isInside(r, real))) return line;
    if (seen.has(real)) return line;
    const text = readText(real);
    if (text === undefined) return line;
    const nextSeen = new Set(seen).add(real);
    return expandImports(text, real, roots, { home: opts.home, depth: depth + 1, seen: nextSeen }).replace(/\s+$/, '');
  }).join('\n');
}

/** Every memory file that applies to `workspace`, imports expanded. */
export function loadMemoryFiles(workspace: string, opts: { home?: string } = {}): MemoryFile[] {
  const home = homeDir(opts.home);
  const roots = [workspace, path.join(home, '.claude')];
  const out: MemoryFile[] = [];
  const add = (name: string, full: string, scope: MemoryFile['scope']) => {
    const text = readText(full);
    if (text === undefined || !text.trim()) return;
    out.push({ name, path: full, scope, content: expandImports(text, full, roots, { home }) });
  };
  for (const rel of PROJECT_MEMORY_FILES) add(rel, path.join(workspace, rel), 'project');
  add('~/.claude/CLAUDE.md', path.join(home, '.claude', 'CLAUDE.md'), 'user');
  add('~/.open-code/AGENTS.md', path.join(home, '.open-code', 'AGENTS.md'), 'user');
  return out;
}

/**
 * CLAUDE.md / AGENTS.md files in the directories between the workspace root
 * (exclusive — those are in the system prompt) and `relPath`'s directory
 * that are not yet in `loaded`. Marks the returned ones as loaded.
 */
export function directoryMemoryFor(
  workspace: string,
  relPath: string,
  loaded: Set<string>
): { name: string; content: string }[] {
  const dir = path.posix.dirname(relPath.replace(/\\/g, '/').replace(/^\.\/+/, ''));
  if (!dir || dir === '.' || dir.startsWith('..') || path.isAbsolute(dir)) return [];
  const parts = dir.split('/').filter(Boolean);
  const out: { name: string; content: string }[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join('/');
    for (const file of DIRECTORY_MEMORY_FILES) {
      const name = `${sub}/${file}`;
      if (loaded.has(name)) continue;
      const full = path.join(workspace, sub, file);
      if (!existsSync(full) || !isInside(realOrSelf(workspace), realOrSelf(full))) continue;
      const text = readText(full);
      loaded.add(name);
      if (!text?.trim()) continue;
      const content = expandImports(text, full, [workspace]);
      out.push({
        name,
        content: content.length > MAX_DIR_MEMORY_CHARS ? `${content.slice(0, MAX_DIR_MEMORY_CHARS)}\n…[truncated]` : content,
      });
    }
  }
  return out;
}

export function formatDirectoryMemory(entries: { name: string; content: string }[]): string {
  return entries.map((e) => `[Directory memory from ${e.name}]\n${e.content.trim()}`).join('\n\n');
}
