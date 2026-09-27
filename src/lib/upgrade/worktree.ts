import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { UPGRADE_WORKTREE_DIR, UPGRADE_WORKTREE_PREFIX } from './guard';

/**
 * Git plumbing for upgrade worktrees. The main checkout is never modified:
 * candidates live in .claude/worktrees/upgrade-<id> on branch
 * opencode-upgrade/<id>; a detached base worktree (upgrade-<id>-base) is used
 * to measure the base commit's tests. node_modules is a junction to the main
 * checkout's, so it is unlinked before any worktree is removed.
 */

export const IDENTITY = ['-c', 'user.name=Open Code Upgrade', '-c', 'user.email=upgrade@opencode.local'];

export function git(cwd: string, args: string[], opts: { maxBuffer?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(' ')}: ${(stderr || err.message).trim()}`));
      else resolve(stdout.replace(/\s+$/, ''));
    });
  });
}

export function worktreeDir(mainRoot: string, name: string): string {
  return path.join(mainRoot, UPGRADE_WORKTREE_DIR, `${UPGRADE_WORKTREE_PREFIX}${name}`);
}

function linkNodeModules(mainRoot: string, dir: string): void {
  const target = path.join(mainRoot, 'node_modules');
  const link = path.join(dir, 'node_modules');
  if (!fs.existsSync(target) || fs.existsSync(link)) return;
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

/** Remove the node_modules link without following it into the main checkout. */
function unlinkNodeModules(dir: string): void {
  const link = path.join(dir, 'node_modules');
  try {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink()) fs.unlinkSync(link);
    // A real directory here was not created by us — leave it; removal below uses git
  } catch {}
}

export async function createCandidateWorktree(mainRoot: string, id: string, base: string, branch: string): Promise<string> {
  const dir = worktreeDir(mainRoot, id);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await git(mainRoot, ['worktree', 'add', '-b', branch, dir, base]);
  linkNodeModules(mainRoot, dir);
  return dir;
}

/** Detached checkout of `base` for measuring the baseline; reused if present. */
export async function ensureBaseWorktree(mainRoot: string, id: string, base: string): Promise<string> {
  const dir = worktreeDir(mainRoot, `${id}-base`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(mainRoot, ['worktree', 'add', '--detach', dir, base]);
  }
  linkNodeModules(mainRoot, dir);
  return dir;
}

export async function removeWorktree(mainRoot: string, dir: string): Promise<void> {
  if (!fs.existsSync(dir)) {
    await git(mainRoot, ['worktree', 'prune']).catch(() => {});
    return;
  }
  unlinkNodeModules(dir);
  await git(mainRoot, ['worktree', 'remove', '--force', dir]).catch(() => {});
  unlinkNodeModules(dir);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  await git(mainRoot, ['worktree', 'prune']).catch(() => {});
}

export interface CandidateDiff {
  /** Unified diff base → working tree (tracked + new files) */
  diff: string;
  files: { path: string; status: string; additions: number; deletions: number }[];
}

/** Stage everything in the worktree (index only) and diff it against `base`. */
export async function candidateDiff(dir: string, base: string): Promise<CandidateDiff> {
  await git(dir, ['add', '-A']);
  const [diff, numstat, nameStatus] = await Promise.all([
    git(dir, ['diff', '--cached', base]),
    git(dir, ['diff', '--cached', '--numstat', base]),
    git(dir, ['diff', '--cached', '--name-status', base]),
  ]);
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [a, d, p] = line.split('\t');
    stats.set(p, { additions: Number(a) || 0, deletions: Number(d) || 0 });
  }
  // No rename detection: a moved file shows as D + A, so a "moved" test file
  // is still visible to the deletion check
  const files = nameStatus.split('\n').filter(Boolean).map((line) => {
    const [status, p] = line.split('\t');
    return { path: p, status: status[0], ...(stats.get(p) ?? { additions: 0, deletions: 0 }) };
  });
  return { diff, files };
}
