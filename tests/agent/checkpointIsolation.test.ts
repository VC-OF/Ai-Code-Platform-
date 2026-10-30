import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { gitCheckpoint } from '@/lib/agentLoop/checkpoint';
import { workspaceGitEnv } from '@/lib/workspace';

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('git checkpoints in a workspace without its own repo', () => {
  it('creates a repo for the workspace instead of committing into the enclosing one', async () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-outer-'));
    try {
      git(outer, ['init', '-q']);
      fs.writeFileSync(path.join(outer, 'platform.txt'), 'uncommitted platform change');
      const ws = path.join(outer, 'workspaces', 'default');
      fs.mkdirSync(ws, { recursive: true });
      fs.writeFileSync(path.join(ws, 'app.js'), 'console.log(1)');

      const sha = await gitCheckpoint(ws, 1);

      expect(fs.existsSync(path.join(ws, '.git'))).toBe(true);
      expect(git(ws, ['rev-parse', 'HEAD'])).toBe(sha);
      // The enclosing repo has no commits and its change is still unstaged
      expect(() => git(outer, ['rev-parse', 'HEAD'])).toThrow();
      expect(git(outer, ['diff', '--cached', '--name-only'])).toBe('');
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  });

  it('workspaceGitEnv stops git from finding a parent repo', () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-outer-'));
    try {
      git(outer, ['init', '-q']);
      const ws = path.join(outer, 'ws');
      fs.mkdirSync(ws);
      expect(() =>
        execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: ws, env: workspaceGitEnv(ws), stdio: 'pipe' })
      ).toThrow();
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  });
});
