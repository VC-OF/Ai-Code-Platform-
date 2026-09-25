import { ChildProcess, execSync, execFileSync } from "child_process";
import crossSpawn from "cross-spawn";
import fs from "fs";
import path from "path";
import http from "http";
import net from "net";
import { getWorkspaceRoot } from "./workspace";
import { getDecryptedEnv } from "./settingsStore";
import { isDockerMode } from "./safeExec";
import {
  detectRunPlan,
  detectPortFromLog,
  withPort,
  type NodePlan,
  type PythonPlan,
  type RunPlan,
  type StaticPlan,
} from "./previewPlan";

/**
 * Preview lifecycle. `detectRunPlan` (previewPlan.ts) decides WHAT to run;
 * this module runs it — on the host, or inside a container when
 * SANDBOX_MODE=docker — and tracks status/logs per project.
 *
 * Status: starting → running (the port answers HTTP) | error (process died)
 *         unavailable (nothing runnable: plan kind none/unsupported)
 */

export type PreviewStatusValue = "stopped" | "starting" | "running" | "error" | "unavailable";

interface PreviewInstance {
  children: ChildProcess[];
  logs: string[];
  status: PreviewStatusValue;
  /** Port we assigned (published port in docker mode) */
  port: number;
  /** Port parsed from logs for scripts we don't control (host mode) */
  detectedPort?: number;
  plan: RunPlan;
  container: boolean;
  reason?: string;
  hint?: string;
  error?: string;
  probe?: NodeJS.Timeout;
}

const instances = new Map<string, PreviewInstance>();
const reservedPorts = new Set<number>();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function previewContainerName(projectId: string): string {
  return `oc-preview-${projectId}`.toLowerCase();
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < 5000; port++) {
    const inUse =
      reservedPorts.has(port) ||
      Array.from(instances.values()).some(
        (i) => i.port === port && i.status !== "stopped" && i.status !== "unavailable"
      );
    if (inUse) continue;
    if (await isPortFree(port)) {
      if (reservedPorts.has(port)) continue; // raced with a concurrent start
      reservedPorts.add(port);
      return port;
    }
  }
  throw new Error("No available ports");
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
}

function pushLog(instance: PreviewInstance, text: string, prefix = "") {
  let clean = stripAnsi(text);
  if (prefix) {
    clean = clean
      .split(/(?<=\n)/)
      .map((l) => (l.trim() ? prefix + l : l))
      .join("");
  }
  instance.logs.push(clean);
  if (instance.logs.length > 500) instance.logs = instance.logs.slice(-500);
  if (instance.plan.kind === "node" && instance.plan.web.portFromLogs && !instance.detectedPort && !prefix.startsWith("[api]")) {
    const p = detectPortFromLog(clean);
    if (p) instance.detectedPort = p;
  }
}

/** Last meaningful log lines — shown as the failure reason */
function lastErrorLines(instance: PreviewInstance, n = 12): string {
  return instance.logs
    .join("")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^npm (notice|warn)/i.test(l.trim()))
    .slice(-n)
    .join("\n");
}

function servedPort(instance: PreviewInstance): number {
  // In docker only the assigned port is published
  return !instance.container && instance.detectedPort ? instance.detectedPort : instance.port;
}

/** Shell-quote a token for the container's `sh -c` script */
function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

let hostPython: string | null | undefined;
function hostPythonCmd(): string | null {
  if (hostPython !== undefined) return hostPython;
  hostPython = null;
  for (const cmd of ["python", "python3"]) {
    try {
      const out = execFileSync(cmd, ["--version"], { stdio: "pipe", timeout: 5000 }).toString();
      if (/Python 3/.test(out)) {
        hostPython = cmd;
        break;
      }
    } catch {}
  }
  return hostPython;
}

// ─── Status API ──────────────────────────────────────────────────────────────
export function getPreviewLogs(projectId: string, lines = 100) {
  const instance = instances.get(projectId);
  if (!instance || instance.status === "unavailable") {
    return { status: "stopped" as const, url: null, logs: [] as string[] };
  }
  return {
    status: instance.status,
    url: `http://localhost:${servedPort(instance)}`,
    logs: instance.logs.slice(-Math.max(1, Math.min(lines, 500))),
  };
}

export function getPreviewStatus(projectId: string): {
  status: PreviewStatusValue;
  port: number;
  url: string | null;
  logs: string[];
  kind?: RunPlan["kind"];
  framework?: string;
  reason?: string;
  hint?: string;
  error?: string;
} {
  const instance = instances.get(projectId);
  if (!instance) {
    return { status: "stopped", port: 4001, url: null, logs: [] };
  }
  if (instance.status === "unavailable") {
    return {
      status: "unavailable",
      port: 0,
      url: null,
      logs: [],
      kind: instance.plan.kind,
      reason: instance.reason,
      hint: instance.hint,
    };
  }
  const port = servedPort(instance);
  const plan = instance.plan;
  return {
    status: instance.status,
    port,
    url: `http://localhost:${port}`,
    logs: instance.logs.slice(-100),
    kind: plan.kind,
    framework: plan.kind === "node" ? plan.framework : plan.kind === "python" ? plan.framework : undefined,
    error: instance.status === "error" ? instance.error : undefined,
  };
}

// Concurrent starts for the same project must share one boot
const pendingStarts = new Map<string, Promise<ReturnType<typeof getPreviewStatus>>>();

export function startPreview(projectId: string) {
  const pending = pendingStarts.get(projectId);
  if (pending) return pending;
  const p = startPreviewInner(projectId).finally(() => pendingStarts.delete(projectId));
  pendingStarts.set(projectId, p);
  return p;
}

async function startPreviewInner(projectId: string) {
  const existing = instances.get(projectId);
  if (existing) {
    if (existing.status === "running" || existing.status === "starting") {
      return getPreviewStatus(projectId);
    }
    stopPreview(projectId);
  }

  const root = getWorkspaceRoot(projectId);
  const dockerMode = isDockerMode();
  const plan = detectRunPlan(root, {
    pythonAvailable: dockerMode ? true : hostPythonCmd() !== null,
  });

  if (plan.kind === "none" || plan.kind === "unsupported") {
    instances.set(projectId, {
      children: [],
      logs: [],
      status: "unavailable",
      port: 0,
      plan,
      container: false,
      reason: plan.reason,
      hint: plan.kind === "unsupported" ? plan.hint : undefined,
    });
    return getPreviewStatus(projectId);
  }

  const port = await findAvailablePort(4001);
  const secretEnv = await getDecryptedEnv(projectId);
  const useContainer = dockerMode && plan.kind !== "static";

  const instance: PreviewInstance = {
    children: [],
    logs: [],
    status: "starting",
    port,
    plan,
    container: useContainer,
  };
  instances.set(projectId, instance);
  reservedPorts.delete(port); // now tracked by the instance

  try {
    if (plan.kind === "static") {
      // Static files are served by our own server — no project code runs,
      // so this is safe on the host even in sandbox mode
      startStatic(instance, plan);
    } else if (useContainer) {
      startContainer(projectId, root, instance, plan, secretEnv);
    } else if (plan.kind === "node") {
      void startHostNode(root, instance, plan, secretEnv);
    } else {
      startHostPython(root, instance, plan, secretEnv);
    }
  } catch (err) {
    fail(instance, `[failed to start: ${(err as Error).message}]`);
  }

  startProbe(instance);
  await new Promise((r) => setTimeout(r, 1500));
  return getPreviewStatus(projectId);
}

function fail(instance: PreviewInstance, message?: string) {
  if (message) pushLog(instance, `\n${message}\n`);
  if (instance.status === "stopped") return;
  instance.status = "error";
  instance.error = lastErrorLines(instance) || message || "The preview process exited unexpectedly.";
  if (instance.probe) clearInterval(instance.probe);
}

/** Attach log/exit handlers. `main` processes decide the instance status. */
function track(
  instance: PreviewInstance,
  child: ChildProcess,
  opts: { prefix?: string; main: boolean }
) {
  instance.children.push(child);
  const prefix = opts.prefix ?? "";
  child.stdout?.on("data", (d) => pushLog(instance, d.toString(), prefix));
  child.stderr?.on("data", (d) => pushLog(instance, d.toString(), prefix));
  child.on("error", (err) => {
    if (opts.main) fail(instance, `${prefix}[failed to start: ${err.message}]`);
    else pushLog(instance, `\n${prefix}[failed to start: ${err.message}]\n`);
  });
  child.on("exit", (code) => {
    pushLog(instance, `\n${prefix}[process exited with code ${code}]\n`);
    if (!opts.main || instance.status === "stopped") return;
    if (code === 0) {
      instance.status = "stopped";
      if (instance.probe) clearInterval(instance.probe);
    } else {
      fail(instance);
    }
  });
}

/** Mark running once the port answers HTTP (any status code) */
function startProbe(instance: PreviewInstance) {
  let busy = false;
  instance.probe = setInterval(() => {
    if (instance.status !== "starting") {
      clearInterval(instance.probe);
      return;
    }
    if (busy) return;
    busy = true;
    const port = servedPort(instance);
    // Only a real HTTP response counts: docker's port proxy accepts (and can
    // hold open) connections before anything listens inside the container.
    // The long timeout covers first-request compiles (Next.js).
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 90000 }, (res) => {
      res.resume();
      busy = false;
      if (instance.status === "starting") instance.status = "running";
    });
    req.on("timeout", () => {
      req.destroy();
      busy = false;
    });
    req.on("error", () => {
      busy = false;
    });
  }, 1000);
}

// ─── Static ──────────────────────────────────────────────────────────────────
const STATIC_SERVER = `
const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const rootDir = path.resolve(process.env.STATIC_DIR);
const entry = process.env.STATIC_ENTRY || 'index.html';
const port = Number(process.env.PORT);
http.createServer((req, res) => {
  let reqPath;
  try { reqPath = decodeURIComponent(req.url.split('?')[0]); }
  catch { res.writeHead(400); return res.end('Bad Request'); }
  if (reqPath === '/' || reqPath === '') reqPath = '/' + entry;
  let safePath = path.normalize(path.join(rootDir, reqPath));
  if (safePath !== rootDir && !safePath.startsWith(rootDir + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  if (fs.existsSync(safePath) && fs.statSync(safePath).isDirectory()) safePath = path.join(safePath, 'index.html');
  if (!fs.existsSync(safePath) && !path.extname(safePath)) safePath = path.join(rootDir, entry);
  if (!fs.existsSync(safePath)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('File not found'); }
  const ext = path.extname(safePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(safePath).pipe(res);
}).listen(port, '0.0.0.0', () => {
  console.log('ready: static server running on http://localhost:' + port + ' (serving ' + entry + ')');
});
`;

function startStatic(instance: PreviewInstance, plan: StaticPlan) {
  // No shell: the multi-line script reaches node as a single argv entry
  const child = crossSpawn(process.execPath, ["-e", STATIC_SERVER], {
    cwd: plan.dir,
    env: {
      ...process.env,
      PORT: String(instance.port),
      STATIC_DIR: plan.dir,
      STATIC_ENTRY: plan.entry,
    },
    detached: process.platform !== "win32",
  });
  track(instance, child, { main: true });
}

// ─── Docker ──────────────────────────────────────────────────────────────────
function volumeName(projectId: string, dir: string): string {
  const suffix = dir ? `-${dir.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
  return `oc-nm-${projectId}${suffix}`;
}

function envPrefix(env: Record<string, string>): string {
  return Object.entries(env)
    .filter(([k]) => /^[A-Z0-9_]+$/i.test(k))
    .map(([k, v]) => `${k}=${sq(v)}`)
    .join(" ");
}

function containerScript(plan: NodePlan | PythonPlan, port: number): string {
  const lines = ["set -e"];
  if (plan.kind === "python") {
    const cwd = `/workspace/${plan.dir}`.replace(/\/$/, "");
    const runner = plan.framework === "fastapi" ? "fastapi uvicorn" : plan.framework;
    lines.push(`cd ${sq(cwd)}`);
    if (plan.hasRequirements) lines.push("pip install -q --no-cache-dir -r requirements.txt");
    lines.push(`pip install -q --no-cache-dir ${runner}`);
    lines.push(`exec ${pythonArgs(plan, port, "python").map(sq).join(" ")}`);
    return lines.join("\n");
  }

  const cwdOf = (d: string) => (d ? `/workspace/${d}` : "/workspace");
  for (const d of plan.installDirs) {
    lines.push(`echo "[preview] installing dependencies in ${d || "."}"`);
    // A marker proves the last install finished; an interrupted one leaves a
    // half-extracted volume that npm considers complete, so wipe it first
    lines.push(
      `cd ${sq(cwdOf(d))} && mkdir -p node_modules && if [ ! -f node_modules/.oc-install-ok ]; then find node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} +; fi`
    );
    lines.push(`rm -f node_modules/.oc-install-ok && npm install --no-audit --no-fund && touch node_modules/.oc-install-ok`);
  }
  for (const d of plan.prismaDirs) {
    lines.push(
      `cd ${sq(cwdOf(d))} && (npx --no-install prisma generate || echo "[preview] prisma generate failed")`
    );
  }
  for (const d of plan.prismaSqliteDirs) {
    // Without --accept-data-loss this never drops data; it just creates
    // missing tables in a fresh local SQLite database
    lines.push(
      `cd ${sq(cwdOf(d))} && (npx --no-install prisma db push --skip-generate || echo "[preview] prisma db push failed")`
    );
  }
  if (plan.api) {
    const api = plan.api;
    lines.push(
      `(cd ${sq(cwdOf(api.dir))} && env -u PORT -u HOST ${api.cmd} ${api.args.map(sq).join(" ")} 2>&1 | sed -u 's/^/[api] /') &`
    );
  }
  const web = plan.web;
  const env = envPrefix({ ...web.env, PORT: String(port) });
  lines.push(`cd ${sq(cwdOf(web.dir))}`);
  lines.push(`exec env ${env} ${web.cmd} ${withPort(web, port).map(sq).join(" ")}`);
  return lines.join("\n");
}

function startContainer(
  projectId: string,
  root: string,
  instance: PreviewInstance,
  plan: NodePlan | PythonPlan,
  secretEnv: Record<string, string>
) {
  try {
    execFileSync("docker", ["rm", "-f", previewContainerName(projectId)], { stdio: "pipe" });
  } catch {}

  const port = instance.port;
  const mount = `${path.resolve(root).replace(/\\/g, "/")}:/workspace`;
  const envFlags: string[] = [];
  for (const [key, value] of Object.entries(secretEnv)) {
    if (/^[A-Z0-9_]+$/i.test(key)) envFlags.push("-e", `${key}=${value}`);
  }
  // Named volumes shadow each node_modules → container-native binaries
  const volumes: string[] = [];
  if (plan.kind === "node") {
    for (const d of plan.installDirs) {
      volumes.push("-v", `${volumeName(projectId, d)}:${d ? `/workspace/${d}` : "/workspace"}/node_modules`);
    }
  }
  const image =
    plan.kind === "python"
      ? process.env.SANDBOX_PYTHON_IMAGE || "python:3.12-slim"
      : // Not SANDBOX_IMAGE: that is often node:20-slim, which lacks openssl
        // (Prisma engines) and build tools (native modules) dev servers need
        process.env.SANDBOX_PREVIEW_IMAGE || "node:20";

  const args = [
    "run", "--rm", "--init",
    "--name", previewContainerName(projectId),
    "-p", `${port}:${port}`,
    "--memory", "2g",
    "--cpus", "2",
    "--pids-limit", "1024",
    "-v", mount,
    ...volumes,
    "-w", "/workspace",
    "-e", "HOME=/tmp/home",
    "-e", `PORT=${port}`,
    "-e", "HOST=0.0.0.0",
    "-e", "npm_config_cache=/tmp/.npm-cache",
    "-e", "NEXT_TELEMETRY_DISABLED=1",
    // Host bind mounts (Docker Desktop) don't deliver inotify events, so
    // dev servers must poll to pick up edits made by the agent
    "-e", "WATCHPACK_POLLING=true",
    "-e", "CHOKIDAR_USEPOLLING=true",
    ...envFlags,
    image,
    "sh", "-c", containerScript(plan, port),
  ];
  const child = crossSpawn("docker", args, { env: process.env });
  track(instance, child, { main: true });
}

// ─── Host ────────────────────────────────────────────────────────────────────
function runToCompletion(
  instance: PreviewInstance,
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<number> {
  return new Promise((resolve) => {
    const child = crossSpawn(cmd, args, { cwd, env });
    instance.children.push(child);
    child.stdout?.on("data", (d) => pushLog(instance, d.toString()));
    child.stderr?.on("data", (d) => pushLog(instance, d.toString()));
    child.on("error", (err) => {
      pushLog(instance, `\n[failed to run ${cmd}: ${err.message}]\n`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function startHostNode(
  root: string,
  instance: PreviewInstance,
  plan: NodePlan,
  secretEnv: Record<string, string>
) {
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, ...secretEnv };
  delete baseEnv.PORT;
  delete baseEnv.HOST;
  const abs = (d: string) => (d ? path.join(root, d) : root);

  for (const d of plan.installDirs) {
    if (fs.existsSync(path.join(abs(d), "node_modules"))) continue;
    pushLog(instance, `[preview] installing dependencies in ${d || "."}\n`);
    const code = await runToCompletion(instance, "npm", ["install", "--no-audit", "--no-fund"], abs(d), baseEnv);
    if (instance.status === "stopped") return;
    if (code !== 0) return fail(instance, `[npm install failed in ${d || "."} (exit ${code})]`);
  }
  for (const d of plan.prismaDirs) {
    if (fs.existsSync(path.join(abs(d), "node_modules", ".prisma", "client"))) continue;
    await runToCompletion(instance, "npx", ["--no-install", "prisma", "generate"], abs(d), baseEnv);
    if (instance.status === "stopped") return;
  }
  for (const d of plan.prismaSqliteDirs) {
    await runToCompletion(instance, "npx", ["--no-install", "prisma", "db", "push", "--skip-generate"], abs(d), baseEnv);
    if (instance.status === "stopped") return;
  }

  if (plan.api) {
    const api = plan.api;
    const child = crossSpawn(api.cmd, api.args, {
      cwd: abs(api.dir),
      env: { ...baseEnv, ...api.env },
      detached: process.platform !== "win32",
    });
    track(instance, child, { prefix: "[api] ", main: false });
  }

  const web = plan.web;
  const child = crossSpawn(web.cmd, withPort(web, instance.port), {
    cwd: abs(web.dir),
    env: { ...baseEnv, ...web.env, PORT: String(instance.port) },
    detached: process.platform !== "win32",
  });
  track(instance, child, { prefix: plan.api ? "[web] " : "", main: true });
}

function pythonArgs(plan: PythonPlan, port: number, python: string): string[] {
  const mod = plan.entry.replace(/\.py$/, "");
  switch (plan.framework) {
    case "django":
      return [python, "manage.py", "runserver", `0.0.0.0:${port}`, "--noreload"];
    case "fastapi":
      return [python, "-m", "uvicorn", `${mod}:app`, "--host", "0.0.0.0", "--port", String(port)];
    default:
      return [python, "-m", "flask", "--app", mod, "run", "--host", "0.0.0.0", "--port", String(port)];
  }
}

function startHostPython(
  root: string,
  instance: PreviewInstance,
  plan: PythonPlan,
  secretEnv: Record<string, string>
) {
  const python = hostPythonCmd() ?? "python";
  const [cmd, ...args] = pythonArgs(plan, instance.port, python);
  const child = crossSpawn(cmd, args, {
    cwd: plan.dir ? path.join(root, plan.dir) : root,
    env: { ...process.env, ...secretEnv, PORT: String(instance.port), PYTHONUNBUFFERED: "1" },
    detached: process.platform !== "win32",
  });
  track(instance, child, { main: true });
}

// ─── Stop ────────────────────────────────────────────────────────────────────
export function stopPreview(projectId: string) {
  const instance = instances.get(projectId);
  if (instance) {
    const wasActive = instance.status !== "stopped" && instance.status !== "unavailable";
    instance.status = "stopped";
    if (instance.probe) clearInterval(instance.probe);
    if (instance.container && wasActive) {
      // The docker CLI child is just an attachment — kill the container
      try {
        execFileSync("docker", ["kill", previewContainerName(projectId)], { stdio: "pipe" });
      } catch {}
    }
    for (const child of instance.children) killProcessTree(child);
    instances.delete(projectId);
  }
  return getPreviewStatus(projectId);
}

/**
 * Kill a process and all its children, so npm → framework trees don't
 * outlive the preview (leaving the port occupied), especially on Windows.
 */
function killProcessTree(child: ChildProcess) {
  if (child.pid == null || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "pipe" });
    } catch {
      try { child.kill(); } catch {}
    }
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try { child.kill(); } catch {}
    }
  }
}
