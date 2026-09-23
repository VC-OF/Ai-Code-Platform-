import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ensureWorkspace, getWorkspaceRoot } from '@/lib/workspace';

const execFileAsync = promisify(execFile);
const MAX_MESSAGE_LENGTH = 200;

export const runtime = 'nodejs';

async function git(root: string, args: string[]) {
  return execFileAsync('git', args, { cwd: root, timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
}

export async function GET(req: NextRequest) {
  try {
    const projectId = new URL(req.url).searchParams.get('projectId') || 'default';
    await ensureWorkspace(projectId);
    const root = getWorkspaceRoot(projectId);
    const [{ stdout: status }, { stdout: graph }, { stdout: remote }] = await Promise.all([
      git(root, ['status', '--short', '--branch']),
      git(root, ['log', '--graph', '--decorate', '--all', '--max-count=40', '--format=%h|%an|%ar|%s']),
      git(root, ['remote', '-v']),
    ]);

    const lines = status.split(/\r?\n/).filter(Boolean);
    const branchLine = lines.find((line) => line.startsWith('##')) || '## no branch';
    const changes = lines
      .filter((line) => !line.startsWith('##'))
      .map((line) => ({ code: line.slice(0, 2), path: line.slice(3).trim() }));

    return NextResponse.json({
      branch: branchLine.replace(/^##\s*/, ''),
      changes,
      graph: graph.split(/\r?\n/).filter(Boolean),
      remote: remote.split(/\r?\n/).filter(Boolean).filter((line) => line.endsWith('(fetch)')),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = body.projectId || 'default';
    const action = body.action;
    await ensureWorkspace(projectId);
    const root = getWorkspaceRoot(projectId);

    if (action === 'commit') {
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message || message.length > MAX_MESSAGE_LENGTH || /[\r\n]/.test(message)) {
        return NextResponse.json({ error: `Commit message is required and must be under ${MAX_MESSAGE_LENGTH} characters.` }, { status: 400 });
      }
      await git(root, ['add', '-A']);
      const result = await git(root, [
        '-c', 'user.name=Open Code User',
        '-c', 'user.email=local@opencode.local',
        'commit', '-m', message,
      ]);
      return NextResponse.json({ ok: true, output: `${result.stdout}${result.stderr}` });
    }

    if (action === 'push') {
      const result = await git(root, ['push']);
      return NextResponse.json({ ok: true, output: `${result.stdout}${result.stderr}` });
    }

    return NextResponse.json({ error: 'Unsupported source control action.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
