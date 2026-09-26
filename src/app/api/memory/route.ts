import { NextRequest, NextResponse } from 'next/server';
import { projectDb } from '@/lib/db';
import { loadMemoryFiles } from '@/lib/memoryFiles';
import { estimateTokens } from '@/lib/contextManager';

export const runtime = 'nodejs';

/** Memory files loaded into the system prompt for a project (for /memory). */
export async function GET(req: NextRequest) {
  const projectId = new URL(req.url).searchParams.get('projectId');
  // Only resolve via projectId — never a client-supplied path
  const project = projectId ? projectDb.getById(projectId) : undefined;
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const files = loadMemoryFiles(project.workspace).map((f) => ({
    name: f.name,
    scope: f.scope,
    content: f.content,
    tokens: estimateTokens(f.content),
  }));
  return NextResponse.json({ files });
}
