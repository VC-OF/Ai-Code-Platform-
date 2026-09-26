import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

/**
 * Worktree isolation for editing sub-agents: the child runs in
 * `<workspace>/.open-code/worktrees/<id>` on branch `oc-agent-<id>` (based
 * on the parent's HEAD), so parallel agents cannot clobber each other's
 * files. Afterwards its changes are committed on that branch for the parent
 * to merge; a worktree without changes is removed together with its branch.
 */

export interface AgentWorktree {
  id: string;
  path: string;
  branch: string;
  /** Commit the branch started from */
  base: string;
}

export interface WorktreeOutcome {
  changed: boolean;
  branch?: string;
  diffStat?: string;
  /** Text appended to the sub-agent's report */
  note: string;
}

const IDENTITY = ['-c', 'user.name=Open Code Agent', '-c', 'user.email=agent@opencode.local'];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
}

function ensureExcluded(workspace: string): void {
  try {
    const file = path.join(git(workspace, ['rev-parse', '--git-common-dir']), 'info', 'exclude');
    const abs = path.isAbsolute(file) ? file : path.join(workspace, file);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    if (current.split(/\r?\n/).includes('.open-code/')) return;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${current}${current && !current.endsWith('\n') ? '\n' : ''}.open-code/\n`);
  } catch {
    // Not fatal
  }
}

/** Null when the workspace is not a git repo with at least one commit. */
export function createAgentWorktree(workspace: string): AgentWorktree | null {
  let base: string;
  try {
    base = git(workspace, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
  ensureExcluded(workspace);
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(workspace, '.open-code', 'worktrees', id);
  const branch = `oc-agent-${id}`;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(workspace, ['worktree', 'add', dir, '-b', branch, 'HEAD']);
  return { id, path: dir, branch, base };
}

function removeWorktree(workspace: string, wt: AgentWorktree, deleteBranch: boolean): void {
  try { git(workspace, ['worktree', 'remove', '--force', wt.path]); } catch {}
  try { fs.rmSync(wt.path, { recursive: true, force: true }); } catch {}
  try { git(workspace, ['worktree', 'prune']); } catch {}
  if (deleteBranch) {
    try { git(workspace, ['branch', '-D', wt.branch]); } catch {}
  }
}

/** Commit the agent's work on its branch (or drop the worktree if it did nothing). */
export function finishAgentWorktree(workspace: string, wt: AgentWorktree): WorktreeOutcome {
  try {
    git(wt.path, ['add', '-A']);
    if (git(wt.path, ['status', '--porcelain'])) {
      git(wt.path, [...IDENTITY, 'commit', '-m', `sub-agent ${wt.branch}: delegated changes`]);
    }
    const ahead = Number(git(wt.path, ['rev-list', '--count', `${wt.base}..HEAD`]));
    if (!ahead) {
      removeWorktree(workspace, wt, true);
      return { changed: false, note: '(Worktree isolation: the sub-agent made no changes; its worktree and branch were removed.)' };
    }
    const diffStat = git(workspace, ['diff', '--stat', `${wt.base}..${wt.branch}`]);
    // The branch keeps the work; the checkout itself is no longer needed
    removeWorktree(workspace, wt, false);
    return {
      changed: true,
      branch: wt.branch,
      diffStat,
      note:
        `(Worktree isolation: the changes are committed on branch \`${wt.branch}\` (based on ${wt.base.slice(0, 8)}), NOT in your workspace. ` +
        `Review them with \`git diff HEAD...${wt.branch}\` and merge with run_command \`git merge ${wt.branch}\`.)\n` +
        `Diff stat:\n${diffStat}`,
    };
  } catch (err) {
    return {
      changed: false,
      branch: wt.branch,
      note: `(Worktree isolation: finalizing ${wt.path} failed: ${err instanceof Error ? err.message : String(err)} — inspect branch ${wt.branch}.)`,
    };
  }
}
