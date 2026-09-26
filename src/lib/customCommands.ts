import fs from 'fs/promises';
import path from 'path';

/**
 * Project-defined slash commands, Claude Code style: every
 * `.claude/commands/<name>.md` (or `.opencode/commands/<name>.md`) becomes
 * `/<name>`. Files in a subfolder are namespaced (`.claude/commands/db/migrate.md`
 * → `/db:migrate`). Optional frontmatter: `description`, `argument-hint`.
 * The body is the prompt; `$ARGUMENTS` and `$1`…`$9` are substituted by
 * expandCommandBody (in slashCommands.ts, shared with the browser).
 */

export interface CustomCommand {
  name: string;
  description: string;
  argumentHint?: string;
  body: string;
  /** Workspace-relative file */
  source: string;
}

export const COMMAND_ROOTS = ['.claude/commands', '.opencode/commands'] as const;

const MAX_COMMANDS = 64;
const MAX_BODY_CHARS = 20_000;
const NAME_RE = /^[\w-]+$/;

function parseFrontmatter(raw: string): { fields: Map<string, string>; body: string } {
  const fields = new Map<string, string>();
  const fm = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!fm) return { fields, body: raw.trim() };
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*?)\s*$/);
    if (m) fields.set(m[1].toLowerCase(), m[2].replace(/^["']|["']$/g, ''));
  }
  return { fields, body: raw.slice(fm[0].length).trim() };
}

async function readDir(dir: string): Promise<{ name: string; isDir: boolean }[]> {
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    return ents.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return [];
  }
}

export async function loadCustomCommands(workspace: string): Promise<CustomCommand[]> {
  const out: CustomCommand[] = [];
  const seen = new Set<string>();

  const add = async (file: string, rel: string, name: string) => {
    if (out.length >= MAX_COMMANDS || !NAME_RE.test(name.replace(':', ''))) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch {
      return;
    }
    const { fields, body } = parseFrontmatter(raw);
    if (!body) return;
    seen.add(key);
    out.push({
      name,
      description: fields.get('description') || `Project command from ${rel}`,
      argumentHint: fields.get('argument-hint') || fields.get('args') || undefined,
      body: body.slice(0, MAX_BODY_CHARS),
      source: rel,
    });
  };

  for (const root of COMMAND_ROOTS) {
    const dir = path.join(workspace, root);
    for (const e of await readDir(dir)) {
      if (e.isDir) {
        // One level of namespacing: <dir>/<name>.md → /<dir>:<name>
        if (!NAME_RE.test(e.name)) continue;
        for (const f of await readDir(path.join(dir, e.name))) {
          if (f.isDir || !f.name.endsWith('.md')) continue;
          const base = f.name.slice(0, -3);
          await add(path.join(dir, e.name, f.name), `${root}/${e.name}/${f.name}`, `${e.name}:${base}`);
        }
        continue;
      }
      if (!e.name.endsWith('.md')) continue;
      await add(path.join(dir, e.name), `${root}/${e.name}`, e.name.slice(0, -3));
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
