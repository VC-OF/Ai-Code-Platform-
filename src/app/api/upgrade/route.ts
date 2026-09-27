import { NextRequest, NextResponse } from 'next/server';
import { upgradeStore } from '@/lib/upgrade/store';
import { git } from '@/lib/upgrade/worktree';
import {
  startUpgrade, retryAnalysis, developUpgrade, rerunGate, commitUpgrade, pushUpgrade, discardUpgrade,
  upgradeLog, isBusy,
} from '@/lib/upgrade/controller';

export const runtime = 'nodejs';

function detail(id: string) {
  const rec = upgradeStore.get(id);
  if (!rec) return null;
  return {
    upgrade: rec,
    busy: isBusy(id),
    changes: upgradeStore.changes(id),
    tests: upgradeStore.tests(id).map((t) => ({ ...t, output: t.output.slice(-4000) })),
    review: upgradeStore.latestReview(id) ?? null,
    log: upgradeLog(id),
  };
}

/** GET /api/upgrade → history + current base; ?id= → one upgrade; ?id=&diff=1 → its diff */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const d = detail(id);
    if (!d) return NextResponse.json({ error: 'Upgrade not found' }, { status: 404 });
    if (req.nextUrl.searchParams.get('diff')) {
      const rec = d.upgrade;
      const diff = rec.candidate_commit
        ? await git(process.cwd(), ['diff', rec.base_commit, rec.candidate_commit]).catch((e) => String(e))
        : await git(rec.worktree, ['diff', '--cached', rec.base_commit]).catch((e) => String(e));
      return NextResponse.json({ diff });
    }
    return NextResponse.json(d);
  }
  const [head, branch] = await Promise.all([
    git(process.cwd(), ['rev-parse', 'HEAD']).catch(() => ''),
    git(process.cwd(), ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
  ]);
  return NextResponse.json({ upgrades: upgradeStore.list(), base: { commit: head, branch } });
}

/** POST { action: 'start', goal } | { action: 'analyze'|'develop'|'gate'|'commit'|'discard', id } | { action: 'push', id, branch, commit } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.action) {
      case 'start': return NextResponse.json({ upgrade: await startUpgrade(String(body.goal ?? '')) });
      case 'analyze': return NextResponse.json({ upgrade: retryAnalysis(String(body.id)) });
      case 'develop': return NextResponse.json({ upgrade: developUpgrade(String(body.id)) });
      case 'gate': return NextResponse.json({ upgrade: rerunGate(String(body.id)) });
      case 'commit': return NextResponse.json({ upgrade: await commitUpgrade(String(body.id)) });
      case 'push': return NextResponse.json({ upgrade: await pushUpgrade(String(body.id), { branch: body.branch, commit: body.commit }) });
      case 'discard': return NextResponse.json({ upgrade: await discardUpgrade(String(body.id)) });
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
