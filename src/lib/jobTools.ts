import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn, type ChildProcess } from "child_process";
import crossSpawn from "cross-spawn";
import { z } from "zod";
import { prepareSandboxedSpawn, CommandError } from "./safeExec";
import { ensureOpenCodeIgnored, openCodePath } from "./openCodeDir";
import type { ScienceToolResult, ScienceTurnContext } from "./scienceTools";

/**
 * Background jobs: long-running builds, test suites or servers started with
 * run_background keep running across agent turns (until kill_job or server
 * shutdown) while the agent polls them with job_output. Same sandbox rules as
 * run_command — host mode spawns an allowlisted binary without a shell,
 * docker mode runs `sh -c` in a throwaway container that kill_job stops with
 * `docker kill`. Output lives in a capped in-memory ring buffer and is also
 * appended to .open-code/jobs/<id>.log in the workspace.
 */

export type JobToolResult = ScienceToolResult;

export type JobStatus = "running" | "exited" | "killed";

const MAX_JOBS_PER_PROJECT = 8;
const MAX_BUFFERED_LINES = 2_000;
const MAX_LINES_PER_READ = 400;
const MAX_READ_CHARS = 8_000;
const MAX_WAIT_SECONDS = 120;

export interface Job {
  id: string;
  name: string;
  command: string;
  workspace: string;
  startedAt: number;
  endedAt?: number;
  status: JobStatus;
  exitCode: number | null;
  /** Ring buffer: lines[0] is line number `firstLine` (1-based) */
  lines: string[];
  firstLine: number;
  totalLines: number;
  partial: string;
  /** Last line number handed to the agent (default since_line) */
  cursor: number;
  logRel: string;
  proc: ChildProcess | null;
  containerName: string | null;
  waiters: Set<() => void>;
}

const shared = globalThis as unknown as { __ocJobs?: Map<string, Map<string, Job>>; __ocJobsExitHook?: boolean };
const registry = (shared.__ocJobs ??= new Map<string, Map<string, Job>>());

function projectJobs(workspace: string): Map<string, Job> {
  const key = path.resolve(workspace);
  let jobs = registry.get(key);
  if (!jobs) registry.set(key, (jobs = new Map()));
  return jobs;
}

// Jobs die with the server: never leave orphaned processes or containers
if (!shared.__ocJobsExitHook) {
  shared.__ocJobsExitHook = true;
  process.once("exit", () => {
    for (const jobs of registry.values()) for (const job of jobs.values()) if (job.status === "running") terminate(job);
  });
}

// ─── Schemas ───────────────────────────────────────────────────────────────────

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required } },
});

export const JOB_TOOL_SCHEMAS = [
  fn(
    "run_background",
    "Start a long-running command in the background (same sandbox rules as run_command) and return a job id immediately. Use it for builds, installs and test suites expected to take more than a few minutes, or a server you need to exercise; then poll with job_output. Jobs keep running across turns until kill_job (max 8 per project). The app's own dev server is managed by the Preview tab — do not start a second copy here.",
    {
      command: { type: "string", description: "Command to run, e.g. 'cargo build --release' or 'npm test'" },
      name: { type: "string", description: "Short label for the job (optional)" },
    },
    ["command"]
  ),
  fn(
    "job_output",
    "Read new output lines of a background job plus its status (running/exited/killed), exit code and elapsed time. By default returns lines since your last read; wait_seconds (0-120) blocks until new output arrives or the job exits.",
    {
      job_id: { type: "string" },
      since_line: { type: "integer", description: "Return lines after this line number (0 = from the start)" },
      wait_seconds: { type: "integer", description: "Wait up to this long for new output or exit (0-120, default 0)" },
    },
    ["job_id"]
  ),
  fn("kill_job", "Stop a background job (and its container in docker mode).", { job_id: { type: "string" } }, ["job_id"]),
  fn("list_jobs", "List this project's background jobs with status, exit code and elapsed time."),
];

export const JOB_ZOD_SCHEMAS = {
  run_background: z.object({
    command: z.string().min(1).max(1000),
    name: z.string().min(1).max(60).optional(),
  }),
  job_output: z.object({
    job_id: z.string().min(1).max(40),
    since_line: z.number().int().min(0).optional(),
    wait_seconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).optional(),
  }),
  kill_job: z.object({ job_id: z.string().min(1).max(40) }),
  list_jobs: z.object({}).optional(),
};

const JOB_TOOL_NAMES = new Set(JOB_TOOL_SCHEMAS.map((s) => s.function.name));

export function isJobTool(name: string): boolean {
  return JOB_TOOL_NAMES.has(name);
}

// ─── Job lifecycle ─────────────────────────────────────────────────────────────

function wake(job: Job): void {
  for (const w of job.waiters) w();
  job.waiters.clear();
}

function pushLine(job: Job, line: string): void {
  job.lines.push(line);
  job.totalLines++;
  if (job.lines.length > MAX_BUFFERED_LINES) {
    job.lines.shift();
    job.firstLine++;
  }
}

function terminate(job: Job): void {
  const proc = job.proc;
  if (job.containerName) {
    try { spawn("docker", ["kill", job.containerName]).on("error", () => {}); } catch {}
  }
  if (!proc || proc.pid === undefined) return;
  if (process.platform === "win32") {
    // cmd shims (npm, tsc…) spawn a child tree that proc.kill() would orphan
    try { spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"]).on("error", () => {}); } catch {}
  } else {
    try { proc.kill("SIGTERM"); } catch {}
    setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 3000).unref();
  }
}

export async function startJob(workspace: string, command: string, name?: string, env?: Record<string, string>): Promise<Job> {
  const jobs = projectJobs(workspace);
  const running = [...jobs.values()].filter((j) => j.status === "running").length;
  if (running >= MAX_JOBS_PER_PROJECT) {
    throw new CommandError(`Too many background jobs (${running} running, max ${MAX_JOBS_PER_PROJECT}). Kill one with kill_job first.`);
  }
  const { invocation, containerName, env: childEnv } = prepareSandboxedSpawn(command, workspace, env);

  const id = `job_${crypto.randomBytes(3).toString("hex")}`;
  const logRel = openCodePath("jobs", `${id}.log`);
  const logAbs = path.join(workspace, logRel);
  await fs.promises.mkdir(path.dirname(logAbs), { recursive: true });
  await ensureOpenCodeIgnored(workspace);
  const log = fs.createWriteStream(logAbs, { flags: "a" });
  log.on("error", () => {});
  log.write(`$ ${command}\n`);

  const job: Job = {
    id, name: name ?? command.slice(0, 60), command, workspace,
    startedAt: Date.now(), status: "running", exitCode: null,
    lines: [], firstLine: 1, totalLines: 0, partial: "", cursor: 0,
    logRel, proc: null, containerName, waiters: new Set(),
  };

  const proc = crossSpawn(invocation.bin, invocation.args, { cwd: workspace, env: childEnv });
  job.proc = proc;
  jobs.set(id, job);

  const onData = (chunk: Buffer) => {
    const text = chunk.toString();
    log.write(text);
    const parts = (job.partial + text).split(/\r?\n/);
    job.partial = parts.pop() ?? "";
    for (const line of parts) pushLine(job, line);
    if (parts.length) wake(job);
  };
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  if (proc.stdin) {
    proc.stdin.on("error", () => {});
    proc.stdin.end();
  }

  const finish = (code: number | null, errMsg?: string) => {
    if (job.endedAt) return;
    if (job.partial) { pushLine(job, job.partial); job.partial = ""; }
    if (errMsg) { pushLine(job, errMsg); log.write(`${errMsg}\n`); }
    job.endedAt = Date.now();
    job.exitCode = code;
    if (job.status === "running") job.status = "exited";
    job.proc = null;
    log.end(`\n[${job.status}${code !== null ? ` with exit code ${code}` : ""}]\n`);
    wake(job);
  };
  proc.on("close", (code) => finish(code ?? (job.status === "killed" ? null : 1)));
  proc.on("error", (err) => finish(1, `Process error: ${err.message}`));
  return job;
}

export function getJob(workspace: string, id: string): Job | undefined {
  return projectJobs(workspace).get(id);
}

export function listJobs(workspace: string): Job[] {
  return [...projectJobs(workspace).values()];
}

export function killJob(job: Job): void {
  if (job.status !== "running") return;
  job.status = "killed";
  terminate(job);
}

/** Wait until the job has lines after `since` or exits, up to `ms`. */
function waitForOutput(job: Job, since: number, ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || job.status !== "running" || job.totalLines > since) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); job.waiters.delete(done); resolve(); };
    const timer = setTimeout(done, ms);
    job.waiters.add(done);
    signal?.addEventListener("abort", done, { once: true });
  });
}

function elapsed(job: Job): string {
  const s = ((job.endedAt ?? Date.now()) - job.startedAt) / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function statusLine(job: Job): string {
  return `${job.status}${job.exitCode !== null && job.status !== "running" ? ` (exit ${job.exitCode})` : ""}`;
}

// ─── Executor ──────────────────────────────────────────────────────────────────

function fail(output: string, summary: string, suggestion?: string): JobToolResult {
  return { success: false, output: `Error: ${output}`, summary, error: output, suggestion };
}

export async function executeJobTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
  ctx: ScienceTurnContext,
  signal?: AbortSignal
): Promise<JobToolResult> {
  switch (name) {
    case "run_background": {
      const command = String(args.command);
      const job = await startJob(workspace, command, args.name ? String(args.name) : undefined);
      ctx.commandsRun.push(`background: ${command}`);
      return {
        success: true,
        output:
          `Started background job ${job.id} (${job.name}).\nLog: ${job.logRel}\n` +
          `Poll it with job_output {"job_id": "${job.id}", "wait_seconds": 30}; stop it with kill_job.`,
        summary: `Started job ${job.id}: ${command.slice(0, 80)}`,
        extra: { jobId: job.id, log: job.logRel },
      };
    }

    case "job_output": {
      const job = getJob(workspace, String(args.job_id));
      if (!job) {
        const ids = listJobs(workspace).map((j) => j.id).join(", ") || "(none)";
        return fail(`Unknown job '${args.job_id}'. Jobs: ${ids}`, "Job not found", "Use list_jobs to see job ids.");
      }
      const since = args.since_line !== undefined ? Number(args.since_line) : job.cursor;
      const waitSec = Math.min(MAX_WAIT_SECONDS, Math.max(0, Number(args.wait_seconds ?? 0)));
      await waitForOutput(job, since, waitSec * 1000, signal);

      const from = Math.max(since + 1, job.firstLine);
      const all = job.lines.slice(from - job.firstLine);
      const shown = all.slice(0, MAX_LINES_PER_READ);
      let text = shown.join("\n");
      if (text.length > MAX_READ_CHARS) text = text.slice(0, MAX_READ_CHARS) + "\n...[cut — read the rest with a larger since_line]";
      const last = from + shown.length - 1;
      job.cursor = Math.max(job.cursor, shown.length ? last : since);
      const dropped = from > since + 1 ? `[${from - since - 1} older lines dropped from the buffer — see ${job.logRel}]\n` : "";
      const more = all.length > shown.length ? `\n[${all.length - shown.length} more lines — call job_output again with since_line ${last}]` : "";
      const header = `Job ${job.id} — ${statusLine(job)}, elapsed ${elapsed(job)}, ${job.totalLines} lines total. Log: ${job.logRel}`;
      const body = shown.length ? `Lines ${from}-${last}:\n${dropped}${text}${more}` : "(no new output)";
      return {
        success: true,
        output: `${header}\n${body}`,
        summary: `Job ${job.id} ${statusLine(job)} — ${shown.length} new line${shown.length === 1 ? "" : "s"}`,
        extra: { jobId: job.id, status: job.status, exitCode: job.exitCode, nextSinceLine: job.cursor },
      };
    }

    case "kill_job": {
      const job = getJob(workspace, String(args.job_id));
      if (!job) return fail(`Unknown job '${args.job_id}'`, "Job not found", "Use list_jobs to see job ids.");
      if (job.status !== "running") {
        return { success: true, output: `Job ${job.id} is already ${statusLine(job)}.`, summary: `Job ${job.id} already ${job.status}` };
      }
      killJob(job);
      // Give the process a moment to exit so the report is final
      for (let i = 0; i < 30 && !job.endedAt; i++) await new Promise((r) => setTimeout(r, 100));
      return { success: true, output: `Killed job ${job.id} (${job.name}) after ${elapsed(job)}.`, summary: `Killed job ${job.id}` };
    }

    case "list_jobs": {
      const jobs = listJobs(workspace);
      if (!jobs.length) return { success: true, output: "No background jobs.", summary: "No background jobs" };
      const lines = jobs.map((j) => `${j.id}  ${statusLine(j).padEnd(16)} ${elapsed(j).padStart(8)}  ${j.name}  (log ${j.logRel})`);
      const running = jobs.filter((j) => j.status === "running").length;
      return { success: true, output: lines.join("\n"), summary: `${jobs.length} job(s), ${running} running` };
    }

    default:
      return fail(`Unknown job tool ${name}`, `Unknown tool ${name}`);
  }
}
