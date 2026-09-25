import { NextRequest, NextResponse } from 'next/server';
import { execInDocker, getDockerStatus } from '@/lib/dockerService';
import { projectDb } from '@/lib/db';
import { getWorkspaceRoot } from '@/lib/workspace';
import { knownSandboxImages } from '@/lib/sandboxImage';

export const runtime = 'nodejs';

// Images the exec endpoint may run: the sandbox defaults used by
// dockerService/safeExec, SANDBOX_IMAGE, plus DOCKER_ALLOWED_IMAGES (comma list).
function allowedImages(): Set<string> {
  const set = new Set<string>(knownSandboxImages());
  for (const img of (process.env.DOCKER_ALLOWED_IMAGES || '').split(',')) {
    if (img.trim()) set.add(img.trim());
  }
  return set;
}

const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const BLOCKED_ENV_KEYS = new Set(['LD_PRELOAD', 'LD_LIBRARY_PATH', 'NODE_OPTIONS', 'PATH']);

function sanitizeEnv(env: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!env || typeof env !== 'object' || Array.isArray(env)) return out;
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (!ENV_KEY_RE.test(key) || BLOCKED_ENV_KEYS.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { command, projectId, image, network, env } = body as {
      command?: unknown; projectId?: string; image?: unknown; network?: unknown; env?: unknown;
    };

    if (image !== undefined && image !== null && image !== '' && (typeof image !== 'string' || !allowedImages().has(image))) {
      return NextResponse.json(
        { error: `image not allowed. Allowed: ${[...allowedImages()].join(', ')}` },
        { status: 400 }
      );
    }
    const safeImage = typeof image === 'string' && image ? image : undefined;

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
      image: safeImage,
      network: network === 'none' ? 'none' : 'bridge',
      extraEnv: sanitizeEnv(env),
      timeoutMs: 120_000,
    });

    return NextResponse.json({
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      image: safeImage || dockerStatus.defaultImage,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
