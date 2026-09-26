import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import { ensureWorkspace, getWorkspaceRoot } from '@/lib/workspace';
import { isDockerMode } from '@/lib/safeExec';
import { getSandboxImage, isPolyglotImageBuilt, SANDBOX_BUILD_HINT } from '@/lib/sandboxImage';
import { loadHooks, HOOK_EVENTS } from '@/lib/hooks';
import { loadCustomCommands } from '@/lib/customCommands';
import pkg from '../../../../../package.json';

export const runtime = 'nodejs';

const MAX_AGENT_FILES = 50;

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

    // Same loader the agent loop uses, so /hooks shows exactly what will run
    const hookConfig = await loadHooks(root);
    const hooks = hookConfig.hooks.map((h) => ({
      event: h.event,
      matcher: h.matcher,
      commands: h.commands.map((c) => c.command),
      source: h.source,
      supported: (HOOK_EVENTS as string[]).includes(h.event),
    }));
    const hooksFile = hookConfig.files[0] ?? null;
    const hooksError = hookConfig.errors.length ? hookConfig.errors.join('; ') : undefined;
    const commands = (await loadCustomCommands(root).catch(() => [])).map((c) => ({
      name: c.name,
      description: c.description,
      source: c.source,
    }));

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
      sandboxImage: isDockerMode() ? getSandboxImage() : null,
      polyglotImageBuilt: isDockerMode() ? isPolyglotImageBuilt() : null,
      sandboxHint: isDockerMode() && !isPolyglotImageBuilt() ? SANDBOX_BUILD_HINT : undefined,
      version: pkg.version,
      hooks,
      hooksFile,
      hooksFiles: hookConfig.files,
      hooksError,
      agents,
      commands,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
