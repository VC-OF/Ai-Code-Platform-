import { NextRequest, NextResponse } from 'next/server';
import { execInDocker, getDockerStatus } from '@/lib/dockerService';
import { projectDb } from '@/lib/db';
import { getWorkspaceRoot } from '@/lib/workspace';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { command, projectId, image, network, env } = body;

    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: 'command is required' }, { status: 400 });
    }

    const dockerStatus = await getDockerStatus();
    if (!dockerStatus.available) {
      return NextResponse.json(
        { error: 'Docker is not available: ' + (dockerStatus.error || 'daemon unreachable') },
        { status: 503 }
      );
    }

    let workspaceRoot = process.cwd();
    if (projectId) {
      const proj = projectDb.getById(projectId);
      workspaceRoot = proj ? proj.workspace : getWorkspaceRoot(projectId);
    }

    const result = await execInDocker(command, workspaceRoot, {
      image,
      network: network === 'none' ? 'none' : 'bridge',
      extraEnv: env,
      timeoutMs: 120_000,
    });

    return NextResponse.json({
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      image: image || dockerStatus.defaultImage,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
