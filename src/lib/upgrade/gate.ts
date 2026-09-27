import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { upgradeStore, sha256, type GateCheck, type GateResult, type UpgradeRecord } from './store';
import { isProtectedPath, isTestFile, findSkipMarkers, PROTECTED_PATHS } from './guard';
import { candidateDiff, ensureBaseWorktree, git, removeWorktree } from './worktree';

/**
 * The acceptance gate. Always runs from the MAIN checkout's code against
 *   base      = the recorded base commit (measured in a detached base worktree)
 *   candidate = the upgrade worktree
 * The candidate's own copy of this file is never executed. Commands that run
 * candidate code (tsc, vitest) are child processes: if the candidate crashes
 * or hangs them, the gate records INCONCLUSIVE and the server keeps running.
 */

const TYPECHECK_CMD = 'npx tsc --noEmit -p tsconfig.json';
const TEST_TIMEOUT_MS = 20 * 60_000;
const TYPECHECK_TIMEOUT_MS = 10 * 60_000;

export interface CmdResult { code: number | null; output: string; timedOut: boolean }

export function runCmd(cmd: string, cwd: string, timeoutMs: number): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, windowsHide: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
    let out = '';
    const add = (b: Buffer) => { out += b.toString(); if (out.length > 400_000) out = out.slice(-300_000); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (e) => { out += `\n${e.message}`; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output: out, timedOut }); });
  });
}

export interface TestCounts { passed: number; failed: number; skipped: number; total: number; ran: boolean; code: number | null; output: string }

/** vitest's JSON reporter → counts. `ran` is false when no report was produced. */
export function parseVitestJson(json: string): Omit<TestCounts, 'code' | 'output'> {
  try {
    const r = JSON.parse(json);
    const skipped = (r.numPendingTests ?? 0) + (r.numTodoTests ?? 0);
    return { passed: r.numPassedTests ?? 0, failed: r.numFailedTests ?? 0, skipped, total: r.numTotalTests ?? 0, ran: typeof r.numTotalTests === 'number' };
  } catch {
    return { passed: 0, failed: 0, skipped: 0, total: 0, ran: false };
  }
}

async function runTests(dir: string): Promise<TestCounts & { command: string }> {
  const out = path.join(os.tmpdir(), `oc-upgrade-vitest-${process.pid}-${Date.now()}.json`);
  const command = `npx vitest run --reporter=json --outputFile="${out}"`;
  const res = await runCmd(command, dir, TEST_TIMEOUT_MS);
  let counts = { passed: 0, failed: 0, skipped: 0, total: 0, ran: false };
  try { counts = parseVitestJson(fs.readFileSync(out, 'utf8')); } catch {}
  try { fs.unlinkSync(out); } catch {}
  return { ...counts, code: res.timedOut ? null : res.code, output: (res.timedOut ? '[timed out]\n' : '') + res.output.slice(-20_000), command: command.replace(/--outputFile="[^"]+"/, '--outputFile=<tmp>') };
}

export function countTsErrors(output: string): number {
  return (output.match(/error TS\d+/g) ?? []).length;
}

/** Combine check results: any FAIL → FAIL, else any INCONCLUSIVE → INCONCLUSIVE, else PASS. */
export function combine(checks: GateCheck[]): GateResult {
  if (checks.some((c) => c.result === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.result === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

/** Pure comparison of candidate vs base test counts. */
export function compareTests(base: TestCounts, cand: TestCounts): GateCheck[] {
  const checks: GateCheck[] = [];
  if (!base.ran || !cand.ran) {
    checks.push({ name: 'Required tests execute', result: 'INCONCLUSIVE', detail: `${!base.ran ? 'Base' : 'Candidate'} test run produced no report (exit ${!base.ran ? base.code : cand.code}).` });
    return checks;
  }
  checks.push({
    name: 'Required tests execute',
    result: cand.failed > base.failed ? 'FAIL' : 'PASS',
    detail: `Candidate ${cand.passed} passed, ${cand.failed} failed, ${cand.skipped} skipped (base: ${base.passed} passed, ${base.failed} failed).`,
  });
  const fewer = cand.total < base.total || cand.passed < base.passed;
  checks.push({
    name: 'Test count did not decrease',
    result: fewer ? 'FAIL' : 'PASS',
    detail: `${cand.total} tests (base ${base.total}); ${cand.passed} passing (base ${base.passed}).`,
  });
  if (cand.skipped > base.skipped) {
    checks.push({ name: 'No new skipped tests', result: 'FAIL', detail: `${cand.skipped} skipped/todo (base ${base.skipped}).` });
  }
  return checks;
}

type Progress = (msg: string) => void;

export async function runGate(rec: UpgradeRecord, mainRoot: string, progress: Progress = () => {}): Promise<{ result: GateResult; checks: GateCheck[]; diffHash: string }> {
  const checks: GateCheck[] = [];
  const dir = rec.worktree;

  // 9. Required metadata
  const review = upgradeStore.latestReview(rec.id);
  const missing = [
    !rec.goal && 'goal', !rec.base_commit && 'base commit', !rec.candidate_branch && 'candidate branch',
    !rec.analysis && 'analysis', !review && 'review',
  ].filter(Boolean);
  checks.push({ name: 'Upgrade metadata exists', result: missing.length ? 'FAIL' : 'PASS', detail: missing.length ? `Missing: ${missing.join(', ')}` : 'Goal, base, branch, analysis and review recorded.' });

  // 8. Working tree state
  progress('Checking worktree state');
  let wtOk = fs.existsSync(dir);
  let wtDetail = wtOk ? '' : `Worktree ${dir} does not exist.`;
  if (wtOk) {
    try {
      const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
      const ancestor = await git(dir, ['merge-base', '--is-ancestor', rec.base_commit, 'HEAD']).then(() => true, () => false);
      const conflicts = await git(dir, ['diff', '--name-only', '--diff-filter=U']);
      if (branch !== rec.candidate_branch) { wtOk = false; wtDetail = `On branch ${branch}, expected ${rec.candidate_branch}.`; }
      else if (!ancestor) { wtOk = false; wtDetail = `HEAD no longer descends from base ${rec.base_commit.slice(0, 8)}.`; }
      else if (conflicts) { wtOk = false; wtDetail = `Unresolved conflicts: ${conflicts.split('\n').join(', ')}`; }
      else wtDetail = `On ${branch}, based on ${rec.base_commit.slice(0, 8)}, no conflicts.`;
    } catch (e) {
      wtOk = false;
      wtDetail = e instanceof Error ? e.message : String(e);
    }
  }
  checks.push({ name: 'Working tree state is consistent', result: wtOk ? 'PASS' : 'FAIL', detail: wtDetail });
  if (!wtOk) return { result: 'FAIL', checks, diffHash: '' };

  // 7. Diff
  progress('Collecting the diff');
  const { diff, files } = await candidateDiff(dir, rec.base_commit);
  upgradeStore.setChanges(rec.id, files);
  const diffHash = sha256(diff);
  const adds = files.reduce((s, f) => s + f.additions, 0);
  const dels = files.reduce((s, f) => s + f.deletions, 0);
  checks.push({ name: 'Diff is available', result: files.length ? 'PASS' : 'FAIL', detail: files.length ? `${files.length} files, +${adds} / -${dels}.` : 'The candidate made no changes.' });

  // 3. Protected paths (+ the enforcement call site in the agent loop)
  const violations = files.filter((f) => isProtectedPath(f.path)).map((f) => f.path);
  const loopFile = path.join(dir, 'src', 'lib', 'agentLoop.ts');
  if (fs.existsSync(loopFile) && !fs.readFileSync(loopFile, 'utf8').includes('upgradeToolGuard(')) {
    violations.push('src/lib/agentLoop.ts (removed the upgradeToolGuard call)');
  }
  checks.push({
    name: 'No protected paths changed',
    result: violations.length ? 'FAIL' : 'PASS',
    detail: violations.length ? `Violations: ${violations.join(', ')}` : `0 violations (${PROTECTED_PATHS.length} protected patterns).`,
  });

  // 5. Forbidden test deletion / skipping
  const deletedTests = files.filter((f) => f.status === 'D' && isTestFile(f.path)).map((f) => f.path);
  const skips = findSkipMarkers(diff);
  const testTamper = [
    ...deletedTests.map((p) => `deleted ${p}`),
    ...skips.map((s) => `${s.file}: ${s.line}`),
  ];
  checks.push({
    name: 'No test skipping or deletion',
    result: testTamper.length ? 'FAIL' : 'PASS',
    detail: testTamper.length ? testTamper.slice(0, 10).join('\n') : 'No deleted test files; no skip/only/todo markers added.',
  });

  // 6. Review
  checks.push({
    name: 'Review completed',
    result: !review ? 'FAIL' : review.verdict,
    detail: review ? `Reviewer (${review.reviewer}) verdict ${review.verdict}.` : 'No review recorded.',
  });

  // Cheap checks already failed → skip the expensive runs
  if (combine(checks) === 'FAIL') {
    checks.push({ name: 'Candidate builds', result: 'INCONCLUSIVE', detail: 'Skipped: an earlier check failed.' });
    checks.push({ name: 'Required tests execute', result: 'INCONCLUSIVE', detail: 'Skipped: an earlier check failed.' });
    return { result: 'FAIL', checks, diffHash };
  }

  // 1 + 2 + 4. Build (typecheck) and tests, base vs candidate
  progress('Preparing the base checkout');
  const baseDir = await ensureBaseWorktree(mainRoot, rec.id, rec.base_commit);
  try {
    upgradeStore.clearTests(rec.id);

    progress('Typechecking base and candidate');
    const [baseTsc, candTsc] = await Promise.all([
      runCmd(TYPECHECK_CMD, baseDir, TYPECHECK_TIMEOUT_MS),
      runCmd(TYPECHECK_CMD, dir, TYPECHECK_TIMEOUT_MS),
    ]);
    const baseErr = countTsErrors(baseTsc.output);
    const candErr = countTsErrors(candTsc.output);
    for (const [target, r, n] of [['base', baseTsc, baseErr], ['candidate', candTsc, candErr]] as const) {
      upgradeStore.addTest({ upgrade_id: rec.id, target, command: TYPECHECK_CMD, passed: r.code === 0 ? 1 : 0, failed: n, skipped: 0, total: 1, exit_code: r.timedOut ? null : r.code, output: r.output.slice(-20_000) });
    }
    checks.push(
      candTsc.timedOut || baseTsc.timedOut
        ? { name: 'Candidate builds', result: 'INCONCLUSIVE', detail: 'Typecheck timed out.' }
        : {
            name: 'Candidate builds',
            result: candErr > baseErr || (candTsc.code !== 0 && baseTsc.code === 0) ? 'FAIL' : 'PASS',
            detail: `\`${TYPECHECK_CMD}\`: ${candErr} errors (base ${baseErr}).`,
          },
    );

    // Sequential: two vitest runs in parallel starve each other and time out
    progress('Running the base test suite');
    const baseTests = await runTests(baseDir);
    progress('Running the candidate test suite');
    const candTests = await runTests(dir);
    for (const [target, t] of [['base', baseTests], ['candidate', candTests]] as const) {
      upgradeStore.addTest({ upgrade_id: rec.id, target, command: t.command, passed: t.passed, failed: t.failed, skipped: t.skipped, total: t.total, exit_code: t.code, output: t.output });
    }
    checks.push(...compareTests(baseTests, candTests));
  } finally {
    await removeWorktree(mainRoot, baseDir).catch(() => {});
  }

  // The diff must not have changed while tests ran (tests writing files, etc.)
  const after = await candidateDiff(dir, rec.base_commit);
  if (sha256(after.diff) !== diffHash) {
    checks.push({ name: 'Diff stable during verification', result: 'FAIL', detail: 'Running the build or tests changed the candidate files.' });
  }

  return { result: combine(checks), checks, diffHash };
}
