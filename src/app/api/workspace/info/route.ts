import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import { ensureWorkspace, getWorkspaceRoot } from '@/lib/workspace';
import { isDockerMode } from '@/lib/safeExec';
import pkg from '../../../../../package.json';

export const runtime = 'nodejs';

const MAX_AGENT_FILES = 50;

interface HookEntry {
  event: string;
  matcher?: string;
  commands: string[];
}

/** Flatten Claude Code style `hooks` config: { Event: [{ matcher, hooks: [{ type, command }] }] } */
function parseHooks(raw: unknown): HookEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== 'object') continue;
      const g = group as { matcher?: unknown; hooks?: unknown };
      const commands = Array.isArray(g.hooks)
        ? g.hooks
            .map((h) => (h && typeof h === 'object' ? (h as { command?: unknown }).command : undefined))
            .filter((c): c is string => typeof c === 'string')
        : [];
      out.push({ event, matcher: typeof g.matcher === 'string' ? g.matcher : undefined, commands });
    }
  }
  return out;
}

function frontmatterField(text: string, field: string): string | undefined {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const line = fm[1].split(/\r?\n/).find((l) => l.startsWith(`${field}:`));
  return line?.slice(field.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
}

/**
 * Read-only workspace facts for local slash commands (/hooks, /agents,
 * /doctor, /status, /add-dir). Never returns file contents beyond the
 * hooks config and agent front-matter.
 */
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId') || 'default';
    await ensureWorkspace(projectId);
    const root = getWorkspaceRoot(projectId);

    let writable = false;
    try {
      await fs.access(root, fsConstants.W_OK);
      writable = true;
    } catch {}

    let hooks: HookEntry[] = [];
    let hooksError: string | undefined;
    let hooksFile: string | null = null;
    for (const name of ['settings.json', 'settings.local.json']) {
      const file = path.join(root, '.claude', name);
      try {
        const text = await fs.readFile(file, 'utf8');
        hooksFile = hooksFile ?? `.claude/${name}`;
        hooks = hooks.concat(parseHooks((JSON.parse(text) as { hooks?: unknown }).hooks));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          hooksError = `.claude/${name}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    const agents: { name: string; description?: string; file: string }[] = [];
    try {
      const dir = path.join(root, '.claude', 'agents');
      const entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).slice(0, MAX_AGENT_FILES);
      for (const file of entries) {
        const text = await fs.readFile(path.join(dir, file), 'utf8').catch(() => '');
        agents.push({
          name: frontmatterField(text, 'name') || file.replace(/\.md$/, ''),
          description: frontmatterField(text, 'description'),
          file: `.claude/agents/${file}`,
        });
      }
    } catch {}

    return NextResponse.json({
      workspace: root,
      writable,
      sandbox: isDockerMode() ? 'docker' : 'local',
      version: pkg.version,
      hooks,
      hooksFile,
      hooksError,
      agents,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
