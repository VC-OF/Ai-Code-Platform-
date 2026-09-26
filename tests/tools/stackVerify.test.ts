import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  detectStacks, findProjectDirs, hasPythonTests, lintPlan, testPlan,
  parseTestCounts, resolveCommandTimeoutMs, safePattern,
} from '@/lib/stackVerify';
import {
  getSandboxImage, resetSandboxImageCache, knownSandboxImages,
  POLYGLOT_SANDBOX_IMAGE, FALLBACK_SANDBOX_IMAGE,
} from '@/lib/sandboxImage';
import { HOST_ALLOWED_BINS } from '@/lib/permissions';
import { safeExec } from '@/lib/safeExec';
import { validateTool } from '@/lib/toolValidator';
import { createWorkspace, type TestWorkspace } from '../helpers/workspace';

// createWorkspace runs git init — slow under a parallel full-suite run on Windows
vi.setConfig({ testTimeout: 30_000 });

let ws: TestWorkspace | null = null;
afterEach(async () => { await ws?.cleanup(); ws = null; });

describe('stack detection', () => {
  it('treats a manifest-less folder with pytest tests as a python project', async () => {
    ws = await createWorkspace({
      'results/analysis.py': 'print(1)\n',
      'tests/test_analysis.py': 'def test_ok():\n    assert 1 + 1 == 2\n',
    });
    const dirs = await findProjectDirs(ws.root);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toMatchObject({ rel: '.', stacks: ['python'] });
    const plan = await testPlan('python', ws.root, false);
    expect('candidates' in plan).toBe(true);
  });

  it('detects each stack from its manifest', async () => {
    ws = await createWorkspace({
      'Cargo.toml': '[package]\nname="x"', 'go.mod': 'module x', 'pom.xml': '<project/>',
      'requirements.txt': '', 'package.json': '{}',
    });
    expect((await detectStacks(ws.root)).sort()).toEqual(['go', 'maven', 'node', 'python', 'rust']);
  });

  it('detects gradle and loose python files', async () => {
    ws = await createWorkspace({ 'build.gradle.kts': '', 'main.py': 'print(1)' });
    expect(await detectStacks(ws.root)).toEqual(['gradle', 'python']);
  });

  it('finds first-level subprojects in a fullstack monorepo', async () => {
    ws = await createWorkspace({
      'client/package.json': '{}',
      'server/requirements.txt': 'flask',
      'apps/api/go.mod': 'module api',
      'scripts/tool.py': 'print(1)', // no manifest → ignored
      'node_modules/x/package.json': '{}',
    });
    const dirs = await findProjectDirs(ws.root);
    const map = Object.fromEntries(dirs.map((d) => [d.rel, d.stacks]));
    expect(map).toEqual({ client: ['node'], server: ['python'], 'apps/api': ['go'] });
  });

  it('does not re-run cargo/go workspace members from subdirs', async () => {
    ws = await createWorkspace({ 'Cargo.toml': '[workspace]', 'crates/a/Cargo.toml': '' , 'web/Cargo.toml': '', 'web/package.json': '{}' });
    const dirs = await findProjectDirs(ws.root);
    expect(dirs.map((d) => [d.rel, d.stacks])).toEqual([['.', ['rust']], ['web', ['node']]]);
  });

  it('finds python tests', async () => {
    ws = await createWorkspace({ 'pkg/test_core.py': '' });
    expect(await hasPythonTests(ws.root)).toBe(true);
    await ws.cleanup();
    ws = await createWorkspace({ 'main.py': '' });
    expect(await hasPythonTests(ws.root)).toBe(false);
  });
});

describe('check plans', () => {
  it('rust lint prefers clippy then cargo check', () => {
    const plan = lintPlan('rust', true);
    expect(plan.candidates.map((c) => c.command)).toEqual(['cargo clippy --all-targets -q', 'cargo check -q']);
    expect(plan.timeoutMs).toBe(600_000);
  });

  it('python lint prefers ruff then compileall', () => {
    expect(lintPlan('python', false).candidates.map((c) => c.command)).toEqual(['ruff check .', 'python -m compileall -q .']);
  });

  it('go / maven commands', async () => {
    expect(lintPlan('go', true).candidates[0].command).toBe('go vet ./...');
    expect(lintPlan('maven', true).candidates[0].command).toBe('mvn -q -B -DskipTests compile');
    ws = await createWorkspace({ 'go.mod': 'module x' });
    const t = await testPlan('go', ws.root, true);
    expect('candidates' in t && t.candidates[0].command).toBe('go test ./...');
  });

  it('python tests skip without tests and use a .venv with a manifest in docker', async () => {
    ws = await createWorkspace({ 'main.py': '' });
    expect(await testPlan('python', ws.root, true)).toHaveProperty('skipped');
    await ws.cleanup();
    ws = await createWorkspace({ 'requirements.txt': '', 'tests/test_a.py': '' });
    const t = await testPlan('python', ws.root, true);
    if (!('candidates' in t)) throw new Error('expected plan');
    expect(t.candidates[0].command).toContain('python3 -m venv .venv');
    expect(t.candidates[0].command).toContain('.venv/bin/python -m pytest -q');
    expect(t.skipExitCodes).toContain(5);
  });

  it('rejects unsafe test patterns', () => {
    expect(safePattern('test_foo')).toBe('test_foo');
    expect(safePattern('a; rm -rf /')).toBeUndefined();
  });

  it('parses runner summaries', () => {
    expect(parseTestCounts('rust', 'test result: ok. 3 passed; 0 failed; 0 ignored\ntest result: ok. 1 passed; 1 failed;'))
      .toEqual({ total: 5, failed: 1 });
    expect(parseTestCounts('python', '2 passed, 1 failed in 0.1s')).toEqual({ total: 3, failed: 1 });
  });
});

describe('sandbox image resolution', () => {
  const saved = process.env.SANDBOX_IMAGE;
  beforeEach(() => { resetSandboxImageCache(); delete process.env.SANDBOX_IMAGE; });
  afterEach(() => { if (saved === undefined) delete process.env.SANDBOX_IMAGE; else process.env.SANDBOX_IMAGE = saved; resetSandboxImageCache(); });

  it('SANDBOX_IMAGE wins', () => {
    process.env.SANDBOX_IMAGE = 'custom:1';
    expect(getSandboxImage(() => true)).toBe('custom:1');
    expect(knownSandboxImages()).toContain('custom:1');
  });
  it('uses the polyglot image when built', () => {
    expect(getSandboxImage(() => true)).toBe(POLYGLOT_SANDBOX_IMAGE);
  });
  it('falls back to node:20 and caches the check', () => {
    let calls = 0;
    const checker = () => { calls++; return false; };
    expect(getSandboxImage(checker)).toBe(FALLBACK_SANDBOX_IMAGE);
    getSandboxImage(checker);
    expect(calls).toBe(1);
  });
});

describe('host allowlist', () => {
  it('includes polyglot toolchains', () => {
    for (const b of ['python3', 'pip', 'uv', 'pytest', 'ruff', 'cargo', 'go', 'java', 'mvn', 'gradle', 'dotnet', 'make', 'sqlite3']) {
      expect(HOST_ALLOWED_BINS as readonly string[]).toContain(b);
    }
  });
  it('still blocks dangerous patterns for new bins', async () => {
    if (process.env.SANDBOX_MODE === 'docker') return; // host-mode validation only
    const cwd = process.cwd();
    await expect(safeExec('python -c print(1)', cwd)).rejects.toThrow(/inline code/);
    await expect(safeExec('cargo build && rm x', cwd)).rejects.toThrow();
    await expect(safeExec('go run main.go | cat', cwd)).rejects.toThrow();
    await expect(safeExec('ruby -e 1', cwd)).rejects.toThrow();
    await expect(safeExec('python3 /etc/passwd', cwd)).rejects.toThrow();
  });
});

describe('run_command timeout', () => {
  it('validates timeout_seconds', () => {
    expect(validateTool('run_command', { command: 'ls', timeout_seconds: 120 }).ok).toBe(true);
    expect(validateTool('run_command', { command: 'ls', timeout_seconds: 0 }).ok).toBe(false);
    expect(validateTool('run_command', { command: 'ls', timeout_seconds: 901 }).ok).toBe(false);
  });
  it('resolves defaults', () => {
    expect(resolveCommandTimeoutMs('ls')).toBe(60_000);
    expect(resolveCommandTimeoutMs('cargo build --release')).toBe(300_000);
    expect(resolveCommandTimeoutMs('ls', 900)).toBe(900_000);
    expect(resolveCommandTimeoutMs('ls', 5000)).toBe(900_000);
  });

  it('never gives installs/builds less than 300s, even inside a cd chain', () => {
    expect(resolveCommandTimeoutMs('npm install', 120)).toBe(300_000);
    expect(resolveCommandTimeoutMs('cd client && npm install')).toBe(300_000);
    expect(resolveCommandTimeoutMs('cd server && npm i express', 60)).toBe(300_000);
    expect(resolveCommandTimeoutMs('npx vitest run')).toBe(300_000);
    expect(resolveCommandTimeoutMs('python3 -m venv .venv && .venv/bin/pip install -e .')).toBe(300_000);
    expect(resolveCommandTimeoutMs('mvn test', 600)).toBe(600_000);
    expect(resolveCommandTimeoutMs('ls -la', 10)).toBe(10_000);
  });
});
