import { NextRequest } from 'next/server';
import { agentManager } from '@/lib/agentManager';
import { projectDb } from '@/lib/db';
import { workspaceLocks } from '@/lib/workspaceLock';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min Vercel timeout

// ─── POST /api/chat ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let projectId = '';

  try {
    const body = await req.json();
    projectId  = body.projectId as string;
    const messages = body.messages as { role: 'system' | 'user' | 'assistant'; content: string }[];
    const activeFilePath: string | undefined = body.activeFilePath;
    const model: string | undefined = body.model;

    if (!projectId) {
      return Response.json({ error: 'projectId is required' }, { status: 400 });
    }

    // Check project exists
    let project = projectDb.getById(projectId);
    if (!project) {
      const { getProject } = await import("@/lib/projects");
      const localProject = await getProject(projectId);
      if (localProject) {
        const { getWorkspaceRoot } = await import("@/lib/workspace");
        projectDb.create({
          id: projectId,
          name: localProject.title,
          workspace: getWorkspaceRoot(projectId),
          description: null
        });
        project = projectDb.getById(projectId);
      }
    }
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    // Check if there is already a running agent
    const existingAgent = agentManager.getRunningAgent(projectId);
    if (existingAgent) {
      const stream = agentManager.subscribeClient(projectId);
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Check workspace lock
    if (workspaceLocks.get(projectId).isLocked()) {
      return Response.json(
        { error: 'Project is busy. Another request is in progress.' },
        { status: 409 }
      );
    }

    // Start background agent loop and return subscription stream
    const stream = agentManager.startAgent(projectId, messages || [], activeFilePath, model);

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: errMsg }, { status: 500 });
  }
}

