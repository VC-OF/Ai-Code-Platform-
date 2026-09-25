import { NextRequest, NextResponse } from 'next/server';
import { loadSkills, skillGroup, formatSkillListing } from '@/lib/skills';
import { estimateTokens } from '@/lib/contextManager';
import { projectDb } from '@/lib/db';
import { getWorkspaceRoot } from '@/lib/workspace';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    // Only resolve via projectId — an arbitrary client-supplied path would
    // let callers read SKILL files from anywhere on disk
    let workspaceRoot = '';

    if (!workspaceRoot && projectId) {
      const project = projectDb.getById(projectId);
      if (project) {
        workspaceRoot = project.workspace;
      } else {
        workspaceRoot = getWorkspaceRoot(projectId);
      }
    }

    if (!workspaceRoot) {
      workspaceRoot = process.cwd();
    }

    const skills = await loadSkills(workspaceRoot, { includeGlobal: true });

    return NextResponse.json({
      count: skills.length,
      workspaceRoot,
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        source: s.source,
        group: skillGroup(s),
        listingTokens: estimateTokens(formatSkillListing(s)),
        instructionTokens: estimateTokens(s.instructions),
        preview: s.instructions.slice(0, 300) + (s.instructions.length > 300 ? '…' : ''),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
