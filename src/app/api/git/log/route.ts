import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ensureWorkspace, getWorkspaceRoot } from '@/lib/workspace';

const execFileAsync = promisify(execFile);
const MAX_ENTRIES = 20;

export const runtime = 'nodejs';

/** Recent commits for /release-notes. Read-only, fixed argument list. */
export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const projectId = params.get('projectId') || 'default';
    const requested = Number(params.get('limit') || MAX_ENTRIES);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(1, Math.floor(requested)), MAX_ENTRIES) : MAX_ENTRIES;

    await ensureWorkspace(projectId);
    const root = getWorkspaceRoot(projectId);
    const { stdout } = await execFileAsync(
      'git',
      ['log', `--max-count=${limit}`, '--format=%h|%an|%ar|%s'],
      { cwd: root, timeout: 20_000, maxBuffer: 1024 * 1024 }
    ).catch(() => ({ stdout: '' }));

    const commits = stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [sha, author, when, ...rest] = line.split('|');
        return { sha, author, when, subject: rest.join('|') };
      });
    return NextResponse.json({ commits });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
