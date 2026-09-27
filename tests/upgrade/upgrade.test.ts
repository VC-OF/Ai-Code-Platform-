import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { isProtectedPath, upgradeToolGuard, upgradeWorktreeRoot, findSkipMarkers, isTestFile } from '@/lib/upgrade/guard';
import { combine, compareTests, parseVitestJson, countTsErrors, runFile, runCmd } from '@/lib/upgrade/gate';
import { parseAnalysis, parseReview } from '@/lib/upgrade/parse';
import { createCandidateWorktree, candidateDiff, removeWorktree } from '@/lib/upgrade/worktree';

const MAIN = path.resolve('/repo/main');
const WT = path.join(MAIN, '.claude', 'worktrees', 'upgrade-upg-20260927-001');

describe('protected paths', () => {
  it('protects the gate, policy and test definitions', () => {
    for (const p of ['src/lib/upgrade/gate.ts', 'src/app/api/upgrade/route.ts', 'tests/upgrade/x.test.ts', 'vitest.config.ts', 'package.json', 'src/lib/permissionRules.ts', '.github/workflows/ci.yml', 'SRC/LIB/UPGRADE/guard.ts']) {
      expect(isProtectedPath(p), p).toBe(true);
    }
  });
  it('leaves ordinary source editable', () => {
    for (const p of ['src/lib/agentLoop.ts', 'src/lib/tools.ts', 'src/components/chat/ChatPanel.tsx', 'tests/tools/appTools.test.ts', 'README.md']) {
      expect(isProtectedPath(p), p).toBe(false);
    }
  });
});

describe('upgradeWorktreeRoot', () => {
  it('recognises upgrade worktrees and their subfolders', () => {
    expect(upgradeWorktreeRoot(WT, MAIN)?.toLowerCase()).toBe(WT.replace(/\\/g, '/').toLowerCase());
    expect(upgradeWorktreeRoot(path.join(WT, 'src', 'lib'), MAIN)?.toLowerCase()).toBe(WT.replace(/\\/g, '/').toLowerCase());
  });
  it('ignores normal projects and sub-agent worktrees', () => {
    expect(upgradeWorktreeRoot(path.join(MAIN, 'workspaces', 'proj_1'), MAIN)).toBeNull();
    expect(upgradeWorktreeRoot(path.join(MAIN, '.claude', 'worktrees', 'agent-abc'), MAIN)).toBeNull();
  });
});

describe('upgradeToolGuard', () => {
  const guard = (tool: string, args: Record<string, unknown>) => upgradeToolGuard(WT, tool, args, MAIN);

  it('does nothing outside upgrade worktrees', () => {
    expect(upgradeToolGuard(path.join(MAIN, 'workspaces', 'p'), 'create_file', { path: 'vitest.config.ts' }, MAIN).allowed).toBe(true);
  });
  it('blocks writes to protected files, including multi_edit and relative tricks', () => {
    expect(guard('edit_file', { path: 'src/lib/upgrade/gate.ts' }).allowed).toBe(false);
    expect(guard('create_file', { path: './vitest.config.ts' }).allowed).toBe(false);
    expect(guard('multi_edit', { edits: [{ path: 'src/lib/tools.ts' }, { path: 'src/lib/upgrade/guard.ts' }] }).allowed).toBe(false);
    expect(guard('delete_file', { path: 'src/lib/../lib/upgrade/store.ts' }).allowed).toBe(false);
  });
  it('blocks paths outside the worktree and node_modules', () => {
    expect(guard('create_file', { path: '../../../src/lib/x.ts' }).allowed).toBe(false);
    expect(guard('edit_file', { path: 'node_modules/next/index.js' }).allowed).toBe(false);
  });
  it('allows ordinary edits and reads of protected files', () => {
    expect(guard('edit_file', { path: 'src/lib/agentLoop.ts' }).allowed).toBe(true);
    expect(guard('read_file', { path: 'src/lib/upgrade/gate.ts' }).allowed).toBe(true);
  });
  it('blocks controller-owned git, gh and dependency installs', () => {
    for (const cmd of ['git commit -am x', 'git push origin HEAD', 'git -C . checkout main', 'gh pr create', 'npm install lodash', 'pnpm add x', 'rm -rf node_modules']) {
      expect(guard('run_command', { command: cmd }).allowed, cmd).toBe(false);
    }
    expect(guard('run_command', { command: 'echo x > vitest.config.ts' }).allowed).toBe(false);
  });
  it('allows verification commands', () => {
    for (const cmd of ['npx vitest run tests/tools', 'npx tsc --noEmit', 'git diff', 'git status', 'npm run test']) {
      expect(guard('run_command', { command: cmd }).allowed, cmd).toBe(true);
    }
  });
});

describe('test tampering detection', () => {
  it('classifies test files', () => {
    expect(isTestFile('tests/lib/a.ts')).toBe(true);
    expect(isTestFile('src/lib/file-utils.test.ts')).toBe(true);
    expect(isTestFile('src/lib/tools.ts')).toBe(false);
  });
  it('finds added skip/only/todo markers only in test files', () => {
    const diff = [
      'diff --git a/tests/a.test.ts b/tests/a.test.ts',
      '+++ b/tests/a.test.ts',
      "+  it.skip('flaky', () => {})",
      "+  describe.only('x', () => {})",
      "-  it.skip('old', () => {})",
      "+  it('fine', () => {})",
      '+++ b/src/lib/x.ts',
      "+  const it = { skip: 1 }; it.skip(1)",
    ].join('\n');
    const hits = findSkipMarkers(diff);
    expect(hits.map((h) => h.line)).toEqual(["it.skip('flaky', () => {})", "describe.only('x', () => {})"]);
  });
});

describe('gate decisions', () => {
  const t = (passed: number, failed: number, skipped = 0) => ({ passed, failed, skipped, total: passed + failed + skipped, ran: true, code: failed ? 1 : 0, output: '' });

  it('combines FAIL over INCONCLUSIVE over PASS', () => {
    expect(combine([{ name: 'a', result: 'PASS', detail: '' }])).toBe('PASS');
    expect(combine([{ name: 'a', result: 'PASS', detail: '' }, { name: 'b', result: 'INCONCLUSIVE', detail: '' }])).toBe('INCONCLUSIVE');
    expect(combine([{ name: 'a', result: 'FAIL', detail: '' }, { name: 'b', result: 'INCONCLUSIVE', detail: '' }])).toBe('FAIL');
  });
  it('passes when tests grew and nothing new fails', () => {
    expect(combine(compareTests(t(100, 0), t(104, 0)))).toBe('PASS');
  });
  it('fails on new failures, fewer tests, or more skips', () => {
    expect(combine(compareTests(t(100, 0), t(99, 1)))).toBe('FAIL');
    expect(combine(compareTests(t(100, 0), t(90, 0)))).toBe('FAIL');
    expect(combine(compareTests(t(100, 0), t(100, 0, 3)))).toBe('FAIL');
  });
  it('tolerates failures that already existed on the base', () => {
    expect(combine(compareTests(t(98, 2), t(99, 2)))).toBe('PASS');
  });
  it('is inconclusive when a run produced no report', () => {
    expect(combine(compareTests(t(100, 0), { ...t(0, 0), ran: false }))).toBe('INCONCLUSIVE');
  });
  it('parses vitest JSON and tsc output', () => {
    expect(parseVitestJson(JSON.stringify({ numTotalTests: 5, numPassedTests: 4, numFailedTests: 1, numPendingTests: 0, numTodoTests: 0 })))
      .toEqual({ passed: 4, failed: 1, skipped: 0, total: 5, ran: true });
    expect(parseVitestJson('not json').ran).toBe(false);
    expect(countTsErrors('a.ts(1,2): error TS2322: x\nb.ts(3,4): error TS7006: y')).toBe(2);
  });
});

describe('running commands with untrusted text', () => {
  // Upgrade goals can quote third-party text (e.g. a public issue title) and
  // end up in `gh pr create --title`. runFile must never let a shell see it.
  const hostile = 'Crash on %PROBE_SECRET% $(echo INJECTED) `echo X` "q" & echo AMP';

  it('runFile passes shell syntax through literally', async () => {
    process.env.PROBE_SECRET = 'leaked-value';
    try {
      const r = await runFile(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', hostile], process.cwd(), 20_000);
      expect(r.code).toBe(0);
      expect(r.output).toBe(hostile);
      expect(r.output).not.toContain('leaked-value');
    } finally {
      delete process.env.PROBE_SECRET;
    }
  });

  it('runCmd is a real shell (why untrusted text must not reach it)', async () => {
    process.env.PROBE_SECRET = 'leaked-value';
    try {
      const probe = process.platform === 'win32' ? 'echo %PROBE_SECRET%' : 'echo $PROBE_SECRET';
      expect((await runCmd(probe, process.cwd(), 20_000)).output).toContain('leaked-value');
    } finally {
      delete process.env.PROBE_SECRET;
    }
  });
});

describe('stage output parsing', () => {
  it('reads the analysis JSON block', () => {
    const a = parseAnalysis('Notes...\n```json\n{"analysis":"A","affected_areas":["src/lib/x.ts"],"proposed_plan":["one","two"],"risk":"low"}\n```');
    expect(a).toEqual({ analysis: 'A', affected_areas: ['src/lib/x.ts'], proposed_plan: ['one', 'two'], risk: 'low' });
  });
  it('falls back to the raw text without a block', () => {
    expect(parseAnalysis('just prose').analysis).toBe('just prose');
  });
  it('reads a review verdict and defaults to INCONCLUSIVE', () => {
    expect(parseReview('```json\n{"verdict":"pass","findings":["minor: a.ts:1 — nit"]}\n```')).toEqual({ verdict: 'PASS', findings: 'minor: a.ts:1 — nit' });
    expect(parseReview('looks good').verdict).toBe('INCONCLUSIVE');
  });
});

describe('upgrade worktrees (real git)', () => {
  let main: string;
  const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  beforeAll(() => {
    main = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-upgrade-'));
    g(main, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(main, '.gitignore'), '/node_modules\n');
    fs.writeFileSync(path.join(main, 'a.ts'), 'export const a = 1;\n');
    fs.mkdirSync(path.join(main, 'tests'));
    fs.writeFileSync(path.join(main, 'tests', 'a.test.ts'), 'test\n');
    g(main, 'add', '-A');
    g(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
    fs.mkdirSync(path.join(main, 'node_modules'));
    fs.writeFileSync(path.join(main, 'node_modules', 'marker'), 'keep me');
  });
  afterAll(() => { fs.rmSync(main, { recursive: true, force: true }); });

  it('creates the candidate from base, reports its diff, and removal never follows the node_modules link', async () => {
    const base = g(main, 'rev-parse', 'HEAD');
    const dir = await createCandidateWorktree(main, 'upg-test-001', base, 'opencode-upgrade/upg-test-001');
    expect(fs.existsSync(path.join(dir, 'node_modules', 'marker'))).toBe(true);

    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2;\nexport const b = 3;\n');
    fs.writeFileSync(path.join(dir, 'b.ts'), 'new\n');
    fs.rmSync(path.join(dir, 'tests', 'a.test.ts'));
    // Platform-written workspace data is not part of the candidate
    fs.mkdirSync(path.join(dir, '.knowledge'));
    fs.writeFileSync(path.join(dir, '.knowledge', 'ki_seed.json'), '{}');
    fs.mkdirSync(path.join(dir, '.open-code'));
    fs.writeFileSync(path.join(dir, '.open-code', 'out.txt'), 'x');
    const { files, diff } = await candidateDiff(dir, base);
    expect(files).toEqual([
      { path: 'a.ts', status: 'M', additions: 2, deletions: 1 },
      { path: 'b.ts', status: 'A', additions: 1, deletions: 0 },
      { path: 'tests/a.test.ts', status: 'D', additions: 0, deletions: 1 },
    ]);
    expect(diff).toContain('+export const b = 3;');
    expect(files.some((f) => f.path.startsWith('node_modules'))).toBe(false);

    // The main checkout is untouched
    expect(fs.readFileSync(path.join(main, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');

    await removeWorktree(main, dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.readFileSync(path.join(main, 'node_modules', 'marker'), 'utf8')).toBe('keep me');
  });
});
