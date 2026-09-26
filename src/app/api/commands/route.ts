import { NextRequest, NextResponse } from 'next/server';
import { loadCustomCommands } from '@/lib/customCommands';
import { projectDb } from '@/lib/db';
import { getWorkspaceRoot } from '@/lib/workspace';

export const runtime = 'nodejs';

/** Project slash commands from .claude/commands/*.md (see customCommands.ts). */
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    // Resolve via projectId only — never a client-supplied path
    const workspace = projectDb.getById(projectId)?.workspace ?? getWorkspaceRoot(projectId);
    const commands = await loadCustomCommands(workspace);
    return NextResponse.json({ commands });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
