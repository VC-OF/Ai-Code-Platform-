// Workspace helpers and run_lint/run_tests runners used by the executor
import fs from "fs/promises";
import path from "path";
import fg from "fast-glob";
import { execFile } from "child_process";
import { promisify } from "util";
import { safeExec } from "../safeExec";
import { type CheckPlan } from "../stackVerify";
import { projectDb } from "../db";
import { truncate } from "./core";

const execFileAsync = promisify(execFile);

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Build Mode workspaces are arbitrary host folders, so the folder name is not
// the project id — look it up; app-mode workspaces/<id> fall back to basename
export function projectIdForWorkspace(workspace: string): string {
  try {
    const row = projectDb.getAll().find((p) => p.workspace === workspace);
    if (row) return row.id;
  } catch {}
  return path.basename(workspace);
}

export async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

export interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function readPackageJson(workspace: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(workspace, "package.json"), "utf-8")
    ) as PackageJson;
  } catch {
    return null;
  }
}

export const BUILD_OR_TEST_CMD =
  /\b(cargo|go|mvn|gradle|gradlew|dotnet|make|cmake|tsc|eslint|ruff|pytest|vitest|jest|mocha)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|typecheck|check)\b|\bpython3?\s+-m\s+(pytest|compileall)\b/;
export const OUTPUT_FILTER =
  /\|\s*(grep|egrep|rg|head|tail|wc|awk|sed|cut|sort|uniq|findstr|Select-String|Select-Object)\b|\|\|\s*(echo|true)\b|2>\s*\/dev\/null/;

/**
 * A build/test command piped through grep/head/tail (or `|| echo ok`) hides
 * failures: exit status and visible lines come from the filter, not the
 * compiler. A live run declared "compiles successfully" from
 * `cargo check | grep main.rs` while 102 errors sat in other files. Tell the
 * model so it cannot mistake such output for a verification.
 */
export function filteredVerificationNote(command: string): string | null {
  if (!BUILD_OR_TEST_CMD.test(command) || !OUTPUT_FILTER.test(command)) return null;
  return (
    "\n\n[Note: this command's output was filtered or truncated by a pipe / fallback (grep, head, tail, `|| echo`, `2>/dev/null`), " +
    "so it cannot show whether the build or tests actually succeeded — the exit status and visible lines belong to the filter. " +
    "Run run_lint / run_tests (or the unfiltered command) before claiming success.]"
  );
}

// Glob patterns are resolved by fast-glob relative to cwd, but "../" segments
// and absolute patterns would escape the workspace
export function assertSafeGlob(pattern: string): void {
  const p = pattern.replace(/\\/g, "/");
  if (path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.split("/").includes("..")) {
    throw new Error(`Glob pattern '${pattern}' must be relative and stay inside the workspace`);
  }
}

// High-performance search: uses ripgrep if available on host, falling back to pure-Node
export async function nodeGrep(
  searchRoot: string,
  pattern: RegExp,
  globFilter: string | undefined
): Promise<{ file: string; line: number; text: string }[]> {
  if (globFilter) assertSafeGlob(globFilter);

  // 1. Try ripgrep (rg) for sub-millisecond search
  try {
    const rgArgs = ["-n", "--no-heading", "--color=never", "--max-count", "200"];
    if (pattern.ignoreCase) {
      rgArgs.push("-i");
    } else {
      rgArgs.push("-s");
    }
    if (globFilter) {
      rgArgs.push("-g", globFilter);
    }
    rgArgs.push("-g", "!node_modules", "-g", "!.next", "-g", "!.git", "-g", "!.platform", "-g", "!dist", "-g", "!build");
    // Run from the search root so ripgrep emits relative paths. Absolute
    // Windows paths contain a drive colon, which makes naive `:` splitting
    // ambiguous and corrupts the displayed filename.
    rgArgs.push("-e", pattern.source, ".");

    const { stdout } = await execFileAsync("rg", rgArgs, {
      cwd: searchRoot,
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });

    const lines = stdout.split(/\r?\n/);
    const rgResults: { file: string; line: number; text: string }[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const match = line.match(/^(.*?):(\d+):(.*)$/);
      if (match) {
        const [, filePath, rawLineNum, rawText] = match;
        const lineNum = parseInt(rawLineNum, 10);
        const text = rawText.trim();
        rgResults.push({
          file: path.relative(searchRoot, path.resolve(searchRoot, filePath)).replace(/\\/g, "/"),
          line: isNaN(lineNum) ? 1 : lineNum,
          text,
        });
        if (rgResults.length >= 200) break;
      }
    }
    if (rgResults.length > 0 || stdout.length > 0) {
      return rgResults;
    }
  } catch {
    // ripgrep not installed or exited non-zero — proceed with pure-Node fallback
  }

  // 2. Pure-Node fallback using fast-glob
  const files = await fg(globFilter || "**/*", {
    cwd: searchRoot,
    ignore: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.git/**",
      "**/.platform/**",
      "**/dist/**",
      "**/build/**",
      "**/target/**",
      "**/.turbo/**",
      "**/coverage/**",
    ],
    absolute: true,
    onlyFiles: true,
  });

  const results: { file: string; line: number; text: string }[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      lines.forEach((lineText, idx) => {
        if (pattern.test(lineText)) {
          results.push({
            file: path.relative(searchRoot, filePath).replace(/\\/g, "/"),
            line: idx + 1,
            text: lineText.trim(),
          });
        }
      });
    } catch {
      // Skip binary or unreadable files
    }
    if (results.length >= 200) break; // cap raw results
  }
  return results;
}

// ─── Verification runners (run_lint / run_tests) ─────────────────────────────

export interface CheckRun {
  label: string;
  command: string;
  passed: boolean;
  code: number;
  timedOut: boolean;
  output: string;
  /** Set when no candidate tool was available, or the runner found nothing to run */
  skipped?: string;
}

/** Pick the first candidate whose probe succeeds and run it via safeExec. */
export async function runCheckPlan(plan: CheckPlan, dir: string, signal?: AbortSignal): Promise<CheckRun> {
  for (const c of plan.candidates) {
    if (c.probe) {
      const probe = await safeExec(c.probe, dir, { signal, timeoutMs: 30_000 }).catch(() => null);
      if (!probe || probe.code !== 0 || probe.timedOut) continue;
    }
    const res = await safeExec(c.command, dir, { signal, timeoutMs: plan.timeoutMs }).catch(
      (err: unknown) => ({ stdout: "", stderr: err instanceof Error ? err.message : String(err), code: 1, timedOut: false })
    );
    const output = (res.stdout + (res.stderr ? `\n${res.stderr}` : "")).trim();
    if (plan.skipExitCodes?.includes(res.code)) {
      return { label: plan.label, command: c.display ?? c.command, passed: true, code: res.code, timedOut: false, output, skipped: "nothing collected" };
    }
    return {
      label: plan.label,
      command: c.display ?? c.command,
      passed: res.code === 0 && !res.timedOut,
      code: res.code,
      timedOut: res.timedOut,
      output,
    };
  }
  return {
    label: plan.label, command: "", passed: true, code: 0, timedOut: false, output: "",
    skipped: `no tooling: ${plan.candidates.map((c) => c.command.split(" ")[0]).join("/")} not available`,
  };
}

export async function runJsLint(dir: string, signal?: AbortSignal) {
  const hasTsconfig = await fileExists(path.join(dir, "tsconfig.json"));
  const pkg = await readPackageJson(dir);
  const hasEslint = !!(pkg?.devDependencies?.eslint || pkg?.dependencies?.eslint);

  let passed = true;
  let errorCount = 0;
  let warningCount = 0;
  let output = "";
  let full = "";
  let ran = false;

  if (hasTsconfig) {
    const tscResult = await safeExec("tsc --noEmit --pretty false", dir, { signal, timeoutMs: 60_000 }).catch(() => null);
    if (tscResult) {
      ran = true;
      if (tscResult.code !== 0) {
        passed = false;
        const combined = tscResult.stdout + "\n" + tscResult.stderr;
        errorCount += (combined.match(/error TS/g) ?? []).length || 1;
        output += `TypeScript:\n${truncate(combined)}\n`;
        full += `TypeScript:\n${combined}\n`;
      } else {
        output += "TypeScript: ✓ No errors\n";
        full += "TypeScript: ✓ No errors\n";
      }
    }
  }

  if (hasEslint) {
    const eslintResult = await safeExec("eslint . --format json", dir, { signal, timeoutMs: 60_000 }).catch(() => null);
    if (eslintResult) {
      ran = true;
      try {
        const eslintData = JSON.parse(eslintResult.stdout) as { errorCount: number; warningCount: number }[];
        const totalErrors = eslintData.reduce((s, f) => s + f.errorCount, 0);
        const totalWarnings = eslintData.reduce((s, f) => s + f.warningCount, 0);
        errorCount += totalErrors;
        warningCount += totalWarnings;
        if (totalErrors > 0) passed = false;
        output += `ESLint: ${totalErrors} errors, ${totalWarnings} warnings\n`;
        full += `ESLint: ${totalErrors} errors, ${totalWarnings} warnings\n`;
      } catch {
        output += truncate(eslintResult.stdout);
        full += eslintResult.stdout;
      }
    }
  }
  return { ran, passed, errorCount, warningCount, output, full };
}

export async function runJsTests(dir: string, pattern: unknown, signal?: AbortSignal) {
  const pkg = await readPackageJson(dir);
  if (!pkg?.scripts?.test) {
    return { skipped: true, passed: true, total: 0, failed: 0, output: "", full: "" };
  }
  const cmd = pattern ? `npm test -- ${String(pattern)}` : "npm test";
  const result = await safeExec(cmd, dir, { signal, timeoutMs: 120_000 });

  let passed = result.code === 0 && !result.timedOut;
  let total = 0;
  let failed = 0;
  const combined = result.stdout + "\n" + result.stderr;
  try {
    const data = JSON.parse(result.stdout);
    total = data.numTotalTests ?? 0;
    failed = data.numFailedTests ?? 0;
    passed = data.success ?? passed;
  } catch {
    const totalMatch = combined.match(/(\d+)\s+(?:tests?\s+)?passed/i);
    const failedMatch = combined.match(/(\d+)\s+(?:tests?\s+)?failed/i);
    total = parseInt(totalMatch?.[1] ?? "0");
    failed = parseInt(failedMatch?.[1] ?? "0");
  }
  return { skipped: false, passed, total, failed, output: truncate(combined), full: combined };
}
