import fs from 'fs/promises';
import path from 'path';

/**
 * Stack detection + lint/test command plans for run_lint / run_tests.
 *
 * Pure planning lives here (unit-tested); tools.ts executes the plans via
 * safeExec, so the sandbox (docker or host allowlist) is always respected.
 *
 * Python in the docker sandbox: when requirements.txt / pyproject.toml /
 * setup.py exist, tests run from a project-local `.venv` (created on demand,
 * requirements + pytest installed into it). On the host the shell-less
 * allowlist can't activate a venv, so `python -m pytest` / `pytest` is used.
 */

export type Stack = 'node' | 'rust' | 'python' | 'go' | 'maven' | 'gradle';

export interface ProjectDir {
  /** Absolute path */
  dir: string;
  /** Path relative to the workspace ('.' for the root) */
  rel: string;
  stacks: Stack[];
}

/** One way to run a check; the first candidate whose probe succeeds wins. */
export interface Candidate {
  /** Cheap availability check (e.g. `ruff --version`). No probe = always usable. */
  probe?: string;
  command: string;
  /** Short label shown in tool output instead of a long command */
  display?: string;
}

export interface CheckPlan {
  stack: Stack;
  label: string;
  candidates: Candidate[];
  timeoutMs: number;
  /** Exit codes that mean "nothing to run" rather than failure (pytest 5). */
  skipExitCodes?: number[];
}

export const BUILD_TIMEOUT_MS = 600_000; // Rust/Java compiles are slow

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', 'out', '.next',
  '.venv', 'venv', '__pycache__', '.npm-cache', 'vendor', 'coverage',
]);
const SUBPROJECT_PARENTS = ['apps', 'packages', 'services'];

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

async function listDir(dir: string): Promise<{ name: string; isDir: boolean }[]> {
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    return ents.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return [];
  }
}

/** Detect which stacks a single directory is (by manifest files). */
export async function detectStacks(dir: string): Promise<Stack[]> {
  const entries = await listDir(dir);
  const names = new Set(entries.filter((e) => !e.isDir).map((e) => e.name));
  const stacks: Stack[] = [];
  if (names.has('package.json')) stacks.push('node');
  if (names.has('Cargo.toml')) stacks.push('rust');
  if (names.has('go.mod')) stacks.push('go');
  if (names.has('pom.xml')) stacks.push('maven');
  else if (names.has('build.gradle') || names.has('build.gradle.kts')) stacks.push('gradle');
  if (
    names.has('pyproject.toml') || names.has('requirements.txt') || names.has('setup.py') ||
    [...names].some((n) => n.endsWith('.py'))
  ) {
    stacks.push('python');
  }
  return stacks;
}

/**
 * The workspace root plus first-level subprojects (client/, server/,
 * frontend/, backend/, …) and apps|packages|services/* that carry their own
 * manifest. A Cargo/Go workspace root already covers its members, so
 * subdirectories only add stacks the root doesn't have.
 */
export async function findProjectDirs(workspace: string): Promise<ProjectDir[]> {
  const out: ProjectDir[] = [];
  const rootStacks = await detectStacks(workspace);
  if (rootStacks.length) out.push({ dir: workspace, rel: '.', stacks: rootStacks });

  const consider = async (abs: string, rel: string) => {
    let stacks = await detectStacks(abs);
    // Cargo/Go workspaces, Maven multi-module and Gradle builds are driven from the root
    stacks = stacks.filter((s) => !(rootStacks.includes(s) && s !== 'node' && s !== 'python'));
    // A root-level python project covers its own packages
    if (rootStacks.includes('python')) stacks = stacks.filter((s) => s !== 'python');
    if (stacks.length) out.push({ dir: abs, rel, stacks });
  };

  for (const e of await listDir(workspace)) {
    if (!e.isDir || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const abs = path.join(workspace, e.name);
    if (SUBPROJECT_PARENTS.includes(e.name)) {
      for (const c of await listDir(abs)) {
        if (!c.isDir || c.name.startsWith('.') || SKIP_DIRS.has(c.name)) continue;
        await consider(path.join(abs, c.name), `${e.name}/${c.name}`);
      }
      continue;
    }
    // Only subdirs with a real manifest — a loose .py file in e.g. scripts/
    // shouldn't turn every folder into a python project
    const stacks = await detectStacks(abs);
    const hasManifest = stacks.some((s) => s !== 'python') ||
      (await exists(path.join(abs, 'pyproject.toml'))) ||
      (await exists(path.join(abs, 'requirements.txt'))) ||
      (await exists(path.join(abs, 'setup.py')));
    if (hasManifest) await consider(abs, e.name);
  }
  return out;
}

/** True when a python project has pytest-style tests (tests/, test_*.py, *_test.py). */
export async function hasPythonTests(dir: string, depth = 3): Promise<boolean> {
  for (const e of await listDir(dir)) {
    if (e.isDir) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      if ((e.name === 'tests' || e.name === 'test') && depth > 0) return true;
      if (depth > 0 && (await hasPythonTests(path.join(dir, e.name), depth - 1))) return true;
    } else if (/^test_.*\.py$|_test\.py$/.test(e.name)) {
      return true;
    }
  }
  return false;
}

async function hasPythonManifest(dir: string): Promise<boolean> {
  for (const f of ['requirements.txt', 'pyproject.toml', 'setup.py']) {
    if (await exists(path.join(dir, f))) return true;
  }
  return false;
}

/** Only simple test-name patterns are forwarded (docker runs through sh -c). */
export function safePattern(pattern: unknown): string | undefined {
  if (typeof pattern !== 'string') return undefined;
  const p = pattern.trim();
  return p && /^[\w.\-/:]+$/.test(p) ? p : undefined;
}

export function lintPlan(stack: Exclude<Stack, 'node'>, dockerMode: boolean): CheckPlan {
  switch (stack) {
    case 'rust':
      return {
        stack, label: 'Rust', timeoutMs: BUILD_TIMEOUT_MS,
        candidates: [
          { probe: 'cargo clippy --version', command: 'cargo clippy --all-targets -q' },
          { probe: 'cargo --version', command: 'cargo check -q' },
        ],
      };
    case 'python':
      return {
        stack, label: 'Python', timeoutMs: 180_000,
        candidates: [
          // Windows bind mounts report every file as executable, which trips
          // ruff's shebang/exec-bit rules (EXE00x) — meaningless there
          {
            probe: 'ruff --version',
            command: dockerMode && process.platform === 'win32'
              ? 'ruff check . --extend-ignore EXE001,EXE002'
              : 'ruff check .',
          },
          dockerMode
            ? { probe: 'python3 --version', command: "python3 -m compileall -q -x '(^|/)(\\.venv|venv|node_modules)/' ." }
            : { probe: 'python --version', command: 'python -m compileall -q .' },
        ],
      };
    case 'go':
      return {
        stack, label: 'Go', timeoutMs: BUILD_TIMEOUT_MS,
        candidates: [{ probe: 'go version', command: 'go vet ./...' }],
      };
    case 'maven':
      return {
        stack, label: 'Java (Maven)', timeoutMs: BUILD_TIMEOUT_MS,
        candidates: [{ probe: 'mvn -v', command: 'mvn -q -B -DskipTests compile' }],
      };
    case 'gradle':
      return {
        stack, label: 'Java (Gradle)', timeoutMs: BUILD_TIMEOUT_MS,
        candidates: [
          ...(dockerMode ? [{ probe: 'test -x ./gradlew', command: './gradlew -q build -x test' }] : []),
          { probe: 'gradle --version', command: 'gradle -q build -x test' },
        ],
      };
  }
}

export async function testPlan(
  stack: Exclude<Stack, 'node'>,
  dir: string,
  dockerMode: boolean,
  pattern?: string,
): Promise<CheckPlan | { skipped: string }> {
  const p = safePattern(pattern);
  switch (stack) {
    case 'rust':
      return {
        stack, label: 'Rust', timeoutMs: BUILD_TIMEOUT_MS,
        candidates: [{ probe: 'cargo --version', command: p ? `cargo test -q ${p}` : 'cargo test -q' }],
      };
    case 'python': {
      if (!(await hasPythonTests(dir))) return { skipped: 'no tests found (tests/ or test_*.py)' };
      const k = p ? ` -k ${p}` : '';
      if (dockerMode && (await hasPythonManifest(dir))) {
        // Project-local .venv so project deps are importable by pytest
        // uv when available: far fewer file writes than pip, which matters a
        // lot on slow (Windows) bind mounts; pip is the fallback.
        const editable = '{ [ -f pyproject.toml ] || [ -f setup.py ]; } && { $PIP -e . || echo "note: editable install of the project failed; testing from source"; }';
        const script = [
          'if command -v uv >/dev/null 2>&1; then { [ -x .venv/bin/python ] || uv venv -q .venv; }; export VIRTUAL_ENV="$PWD/.venv" UV_LINK_MODE=copy; PIP="uv pip install -q"',
          'else { [ -x .venv/bin/python ] || python3 -m venv .venv; }; PIP=".venv/bin/python -m pip install -q"; fi',
          '[ -f requirements.txt ] && $PIP -r requirements.txt',
          editable,
          '.venv/bin/python -c "import pytest" 2>/dev/null || $PIP pytest',
          `.venv/bin/python -m pytest -q${k}`,
        ].join('; ');
        // Docker mode already runs through `sh -c`; `pip install` in the
        // script turns the container network on for dependency installs
        return {
          stack, label: 'Python', timeoutMs: BUILD_TIMEOUT_MS, skipExitCodes: [5],
          candidates: [{ probe: 'python3 --version', command: script, display: `.venv (uv/pip) + python -m pytest -q${k}` }],
        };
      }
      return {
        stack, label: 'Python', timeoutMs: BUILD_TIMEOUT_MS, skipExitCodes: [5],
        candidates: dockerMode
          ? [
              { probe: "python3 -c 'import pytest'", command: `python3 -m pytest -q${k}` },
              { probe: 'pytest --version', command: `pytest -q${k}` },
            ]
          : [
              { probe: 'python -m pytest --version', command: `python -m pytest -q${k}` },
              { probe: 'pytest --version', command: `pytest -q${k}` },
            ],
      };
    }
    case 'go':
      return {
        stack, label: 'Go', timeoutMs: BUILD_TIMEOUT_MS,
        candidates: [{ probe: 'go version', command: p ? `go test ./... -run ${p}` : 'go test ./...' }],
      };
    case 'maven':
      return {
        stack, label: 'Java (Maven)', timeoutMs: BUILD_TIMEOUT_MS,
        // Not -q: quiet mode hides surefire's "Tests run: N" summary on
        // success, so a run where no test executed looked like a pass.
        // -ntp drops the download-progress noise instead.
        candidates: [{ probe: 'mvn -v', command: p ? `mvn -B -ntp test -Dtest=${p}` : 'mvn -B -ntp test' }],
      };
    case 'gradle': {
      const t = p ? ` --tests ${p}` : '';
      return {
        stack, label: 'Java (Gradle)', timeoutMs: BUILD_TIMEOUT_MS,
        candidates: [
          ...(dockerMode ? [{ probe: 'test -x ./gradlew', command: `./gradlew -q test${t}` }] : []),
          { probe: 'gradle --version', command: `gradle -q test${t}` },
        ],
      };
    }
  }
}

/** Best-effort pass/fail counts from common test runner summaries. */
export function parseTestCounts(stack: Stack, output: string): { total: number; failed: number } {
  let total = 0;
  let failed = 0;
  if (stack === 'rust') {
    for (const m of output.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)) {
      total += Number(m[1]) + Number(m[2]);
      failed += Number(m[2]);
    }
    return { total, failed };
  }
  if (stack === 'go') {
    failed = (output.match(/^--- FAIL/gm) ?? []).length;
    const passed = (output.match(/^--- PASS/gm) ?? []).length;
    const okPkgs = (output.match(/^ok\s/gm) ?? []).length;
    return { total: passed + failed || okPkgs, failed };
  }
  if (stack === 'maven' || stack === 'gradle') {
    const m = [...output.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+)/g)].pop();
    if (m) return { total: Number(m[1]), failed: Number(m[2]) + Number(m[3]) };
    return { total, failed };
  }
  const passedM = output.match(/(\d+)\s+passed/i);
  const failedM = output.match(/(\d+)\s+failed/i);
  failed = Number(failedM?.[1] ?? 0);
  total = Number(passedM?.[1] ?? 0) + failed;
  return { total, failed };
}

// Matched per shell segment, so `cd client && npm install` counts too
const SLOW_COMMAND =
  /^(npm|pnpm|yarn|bun)\s+(install|i|ci|add|run\s+build)\b|^npx\s|^(cargo|mvn|gradle|\.\/gradlew|dotnet)\b|^go\s+(build|test|mod|get|install)\b|\bpip3?\s+install\b|^uv\s|^(\S*\/)?python3?\s+-m\s+(pip|venv)\b/;
const SLOW_FLOOR_MS = 300_000;

export function isSlowCommand(command: string): boolean {
  return command.split(/&&|\|\||;|\|/).some((seg) => SLOW_COMMAND.test(seg.trim()));
}

/** run_command timeout: explicit timeout_seconds (clamped 1–900) > slow-command default (300s) > 60s.
 *  Installs/builds never get less than 300s: models routinely guess 60–120s,
 *  and a cold `npm install` on a Windows bind mount takes longer than that. */
export function resolveCommandTimeoutMs(command: string, timeoutSeconds?: unknown): number {
  const slow = isSlowCommand(command);
  const n = Number(timeoutSeconds);
  if (timeoutSeconds !== undefined && timeoutSeconds !== null && Number.isFinite(n) && n > 0) {
    const ms = Math.min(900, Math.max(1, Math.round(n))) * 1000;
    return slow ? Math.max(ms, SLOW_FLOOR_MS) : ms;
  }
  return slow ? SLOW_FLOOR_MS : 60_000;
}
