import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { ensureWorkspace, getWorkspaceRoot } from '@/lib/workspace';
import { isDockerMode } from '@/lib/safeExec';
import { getSandboxImage, isPolyglotImageBuilt, SANDBOX_BUILD_HINT } from '@/lib/sandboxImage';
import { loadHooks, HOOK_EVENTS } from '@/lib/hooks';
import { loadCustomCommands } from '@/lib/customCommands';
import { loadPermissionRules } from '@/lib/permissionRules';
import { loadCustomAgents } from '@/lib/customAgents';
import pkg from '../../../../../package.json';

export const runtime = 'nodejs';

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

    // Same loader as the agent loop, so /permissions shows the rules that apply
    const permissionConfig = await loadPermissionRules(root);
    const permissionRules = permissionConfig.rules.map((r) => ({
      rule: r.rule, behavior: r.behavior, source: r.source, managed: r.managed,
    }));

    // Same loader spawn_agent uses, so /agents shows exactly what is spawnable
    const agents = (await loadCustomAgents(root).catch(() => [])).map((a) => ({
      name: a.name,
      description: a.description,
      file: a.source,
      tools: a.tools,
      model: a.model,
    }));

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
      permissionRules,
      permissionFiles: permissionConfig.files,
      permissionErrors: permissionConfig.errors,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
