// Git checkpoints taken before and after an agent turn edits files
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { workspaceGitEnv } from '../workspace';

const execFileAsync = promisify(execFile);


/** Build output, dependency and cache dirs never belong in checkpoints —
 *  `git add -A` on target/, node_modules/ or .venv/ made every checkpoint
 *  slow and bloated the repo. Uses .git/info/exclude (local-only), so the
 *  project's own .gitignore is left untouched. */
export const CHECKPOINT_EXCLUDES = [
  'node_modules/', '.npm-cache/', '.next/', 'dist/', 'build/', 'coverage/',
  'target/', '.venv/', 'venv/', '__pycache__/', '.pytest_cache/', '.ruff_cache/',
  '.mypy_cache/', '*.egg-info/', '.local/', '.cache/', '.gradle/', '*.class',
  '.open-code/',
];
const EXCLUDE_MARKER = '# open-code checkpoint excludes';

export function ensureCheckpointExcludes(workspace: string): void {
  try {
    const file = path.join(workspace, '.git', 'info', 'exclude');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (current.includes(EXCLUDE_MARKER)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, `${current}${sep}${EXCLUDE_MARKER}\n${CHECKPOINT_EXCLUDES.join('\n')}\n`);
  } catch {
    // Not fatal: the checkpoint just includes more files
  }
}


// Async so a large `git add -A` doesn't block the server's event loop
export async function gitCheckpoint(workspace: string, turnIndex: number, phase = 'start'): Promise<string> {
  const git = (args: string[]) =>
    execFileAsync('git', args, { cwd: workspace, env: workspaceGitEnv(workspace), maxBuffer: 10 * 1024 * 1024 });
  // A workspace without its own repo (e.g. workspaces/default) gets one here;
  // otherwise these commands would commit into whatever repo encloses it
  if (!fs.existsSync(path.join(workspace, '.git'))) await git(['init']);
  ensureCheckpointExcludes(workspace);
  await git(['add', '-A']);
  // Explicit identity so checkpoints work without global git config
  await git([
    '-c', 'user.name=Open Code Agent', '-c', 'user.email=agent@opencode.local',
    'commit', '-m', `checkpoint: turn ${turnIndex} ${phase}`, '--allow-empty',
  ]);
  return (await git(['rev-parse', 'HEAD'])).stdout.trim();
}
