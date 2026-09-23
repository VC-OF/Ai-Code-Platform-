import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';

export interface WorkspaceFiles {
  [relativePath: string]: string;
}

export interface TestWorkspace {
  root: string;
  projectId: string;
  resolve: (p: string) => string;
  read: (p: string) => Promise<string>;
  write: (p: string, content: string) => Promise<void>;
  exists: (p: string) => Promise<boolean>;
  cleanup: () => Promise<void>;
}

// ─── Create isolated test workspace ─────────────────────────────────────────
export async function createWorkspace(
  files: WorkspaceFiles = {}
): Promise<TestWorkspace> {
  const projectId = `test-project-${crypto.randomUUID()}`;
  // OS temp dir, not ./workspaces — keeps test dirs away from the app tree
  // (and from anything scanning it, a source of Windows EBUSY flakes)
  const root = path.join(os.tmpdir(), 'ai-code-platform-tests', projectId);

  await fs.mkdir(root, { recursive: true });

  // Write initial files
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  // Initialize git
  execSync('git init', { cwd: root, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', {
    cwd: root,
    stdio: 'pipe',
  });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'pipe' });

  if (Object.keys(files).length > 0) {
    execSync('git add -A', { cwd: root, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: root, stdio: 'pipe' });
  }

  return {
    root,
    projectId,

    resolve(relPath: string) {
      return path.join(root, relPath);
    },

    async read(relPath: string) {
      return fs.readFile(path.join(root, relPath), 'utf-8');
    },

    async write(relPath: string, content: string) {
      const fullPath = path.join(root, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
    },

    async exists(relPath: string) {
      return fs
        .access(path.join(root, relPath))
        .then(() => true)
        .catch(() => false);
    },

    async cleanup() {
      const maxRetries = 5;
      for (let i = 0; i < maxRetries; i++) {
        try {
          await fs.rm(root, { recursive: true, force: true });
          return;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if ((code === 'EBUSY' || code === 'EPERM') && i < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 150 * (i + 1)));
          } else {
            // Transient Windows locks (AV scans etc.) shouldn't fail a test
            // whose assertions already passed — leave the temp dir behind
            console.warn(`[test cleanup] could not remove ${root}: ${code}`);
            return;
          }
        }
      }
    },
  };
}

// ─── Create workspace with Node project ─────────────────────────────────────
export async function createNodeWorkspace(): Promise<TestWorkspace> {
  return createWorkspace({
    'package.json': JSON.stringify(
      {
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          lint: 'eslint src',
          test: 'vitest run',
          typecheck: 'tsc --noEmit',
        },
        devDependencies: {
          typescript: '^5.0.0',
          vitest: '^1.0.0',
        },
      },
      null,
      2
    ),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          strict: true,
        },
        include: ['src'],
      },
      null,
      2
    ),
    'src/index.ts': `export function add(a: number, b: number): number {
  return a + b;
}
`,
    'src/index.test.ts': `import { describe, it, expect } from 'vitest';
import { add } from './index';

describe('add', () => {
  it('adds two numbers', () => {
    expect(add(1, 2)).toBe(3);
  });
});
`,
  });
}
