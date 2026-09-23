import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  validateBuildModePath,
  createBuildModeProject,
  deleteProject,
} from '@/lib/projects';
import { getWorkspaceRoot } from '@/lib/workspace';

describe('Build Mode', () => {
  const createdIds: string[] = [];
  const createdFolders: string[] = [];

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await deleteProject(id).catch(() => {});
    }
    for (const dir of createdFolders.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('validateBuildModePath — denylist', () => {
    it('rejects relative paths', async () => {
      await expect(validateBuildModePath('some/relative/path')).rejects.toThrow(/absolute/);
    });

    it('rejects empty input', async () => {
      await expect(validateBuildModePath('  ')).rejects.toThrow(/required/);
    });

    it('rejects a filesystem root', async () => {
      const root = process.platform === 'win32' ? 'C:\\' : '/';
      await expect(validateBuildModePath(root)).rejects.toThrow(/filesystem root/);
    });

    it("rejects the platform's own directory", async () => {
      await expect(validateBuildModePath(process.cwd())).rejects.toThrow(/platform's own directory/);
    });

    it('rejects the bare home directory root', async () => {
      await expect(validateBuildModePath(os.homedir())).rejects.toThrow(/home directory root/);
    });

    it('rejects known system directories', async () => {
      if (process.platform === 'win32') {
        await expect(validateBuildModePath('C:\\Windows')).rejects.toThrow(/system directory/);
      } else {
        await expect(validateBuildModePath('/etc')).rejects.toThrow(/system directory/);
      }
    });

    it('rejects a folder that does not exist', async () => {
      await expect(
        validateBuildModePath(path.join(os.tmpdir(), 'oc-does-not-exist-' + Date.now()))
      ).rejects.toThrow(/does not exist/);
    });

    it('rejects a path that is a file, not a directory', async () => {
      const file = path.join(os.tmpdir(), 'oc-file-' + Date.now() + '.txt');
      await fs.writeFile(file, 'x');
      try {
        await expect(validateBuildModePath(file)).rejects.toThrow(/Not a directory/);
      } finally {
        await fs.rm(file, { force: true });
      }
    });

    it('accepts a real, allowed folder', async () => {
      const dir = path.join(os.tmpdir(), 'oc-buildmode-ok-' + Date.now());
      await fs.mkdir(dir, { recursive: true });
      createdFolders.push(dir);
      await expect(validateBuildModePath(dir)).resolves.toBe(path.resolve(dir));
    });
  });

  describe('createBuildModeProject', () => {
    it('wires getWorkspaceRoot to the real external folder, not workspaces/<id>', async () => {
      const dir = path.join(os.tmpdir(), 'oc-buildmode-wire-' + Date.now());
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'existing.txt'), 'pre-existing content');
      createdFolders.push(dir);

      const project = await createBuildModeProject(dir, 'Wire Test');
      createdIds.push(project.id);

      expect(project.kind).toBe('build');
      expect(getWorkspaceRoot(project.id)).toBe(path.resolve(dir));
      expect(getWorkspaceRoot(project.id)).not.toContain('workspaces');

      // Pre-existing content untouched, AGENTS.md added, git initialized
      const existing = await fs.readFile(path.join(dir, 'existing.txt'), 'utf8');
      expect(existing).toBe('pre-existing content');
      const hasAgents = await fs.access(path.join(dir, 'AGENTS.md')).then(() => true).catch(() => false);
      const hasGit = await fs.access(path.join(dir, '.git')).then(() => true).catch(() => false);
      expect(hasAgents).toBe(true);
      expect(hasGit).toBe(true);
    });

    it('never overwrites an existing AGENTS.md or re-inits an existing git repo', async () => {
      const dir = path.join(os.tmpdir(), 'oc-buildmode-preserve-' + Date.now());
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'AGENTS.md'), 'MY OWN CONVENTIONS — DO NOT OVERWRITE');
      createdFolders.push(dir);

      const project = await createBuildModeProject(dir, 'Preserve Test');
      createdIds.push(project.id);

      const agentsContent = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
      expect(agentsContent).toBe('MY OWN CONVENTIONS — DO NOT OVERWRITE');
    });

    it('reopening the same folder reuses the project instead of erroring', async () => {
      const dir = path.join(os.tmpdir(), 'oc-buildmode-reopen-' + Date.now());
      await fs.mkdir(dir, { recursive: true });
      createdFolders.push(dir);

      const first = await createBuildModeProject(dir, 'First');
      createdIds.push(first.id);
      const second = await createBuildModeProject(dir, 'Ignored title');

      expect(second.id).toBe(first.id);
    });

    it('defaults the title to the folder name when none is given', async () => {
      const dir = path.join(os.tmpdir(), 'oc-buildmode-notitle-' + Date.now());
      await fs.mkdir(dir, { recursive: true });
      createdFolders.push(dir);

      const project = await createBuildModeProject(dir);
      createdIds.push(project.id);

      expect(project.title).toBe(path.basename(dir));
    });
  });
});
