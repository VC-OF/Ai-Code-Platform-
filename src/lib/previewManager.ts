import { ChildProcess, execSync, execFile, execFileSync } from "child_process";
import crossSpawn from "cross-spawn";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import net from "net";
import { getWorkspaceRoot } from "./workspace";
import { getDecryptedEnv } from "./settingsStore";
import { isDockerMode } from "./safeExec";
import { isPolyglotImageBuilt, POLYGLOT_SANDBOX_IMAGE } from "./sandboxImage";
import {
  API_ONLY_NOTE,
  checkComposeConfig,
  isInsideWorkspace,
  detectRunPlan,
  detectPortFromLog,
  pickComposeWebPort,
  withPort,
  type CliPlan,
  type ComposePlan,
  type NodePlan,
  type PythonPlan,
  type RunPlan,
  type ServicePlan,
  type StaticPlan,
} from "./previewPlan";

/**
 * Preview lifecycle. `detectRunPlan` (previewPlan.ts) decides WHAT to run;
 * this module runs it — on the host, or inside a container when
 * SANDBOX_MODE=docker — and tracks status/logs per project.
 *
 * Status: starting → running (the port answers HTTP) | error (process died)
 *         unavailable (nothing to preview: plan kind none/unsupported/cli)
 *         cli runs: running → exited (with exit code)
 *
 * Docker Compose stacks always run through docker (`docker compose -p
 * oc-<id>`), after a security check of the normalized compose model.
 */

export type PreviewStatusValue = "stopped" | "starting" | "running" | "error" | "unavailable" | "exited";

interface PreviewInstance {
  children: ChildProcess[];
  logs: string[];
  status: PreviewStatusValue;
  /** Port we assigned (published host port in docker mode) */
  port: number;
  /** Port parsed from logs for scripts we don't control (host mode) */
  detectedPort?: number;
  plan: RunPlan;
  container: boolean;
  reason?: string;
  hint?: string;
  error?: string;
  /** Extra info shown above the preview (e.g. API-only backends) */
  note?: string;
  probe?: NodeJS.Timeout;
  /** Compose: project name + temp dir holding the generated compose file */
  compose?: { project: string; tmpDir: string; httpProbe: boolean };
  /** CLI runs */
  exitCode?: number | null;
  timeout?: NodeJS.Timeout;
}

// Kept on globalThis so dev-server module reloads don't orphan running
// previews (their containers/processes would keep running untracked)
const g = globalThis as typeof globalThis & {
  __ocPreviewInstances?: Map<string, PreviewInstance>;
  __ocPreviewReservedPorts?: Set<number>;
};
const instances = (g.__ocPreviewInstances ??= new Map<string, PreviewInstance>());
const reservedPorts = (g.__ocPreviewReservedPorts ??= new Set<number>());

/** Host port the platform itself listens on — never hand it to a project */
const PLATFORM_PORT = Number(process.env.PORT) || 3000;
const CLI_TIMEOUT_MS = 10 * 60_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function previewContainerName(projectId: string): string {
  return `oc-preview-${projectId}`.toLowerCase();
}

function composeProjectName(projectId: string): string {
  return `oc-${projectId}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
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
    if (port === PLATFORM_PORT) continue;
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

function run(cmd: string, args: string[], timeout = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === "number" ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// ─── Status API ──────────────────────────────────────────────────────────────
function hasWebUrl(instance: PreviewInstance): boolean {
  return instance.plan.kind !== "cli" && instance.status !== "unavailable";
}

export function getPreviewLogs(projectId: string, lines = 100) {
  const instance = instances.get(projectId);
  if (!instance || (instance.status === "unavailable" && !instance.logs.length)) {
    return { status: "stopped" as const, url: null, logs: [] as string[] };
  }
  return {
    status: instance.status,
    url: hasWebUrl(instance) ? `http://localhost:${servedPort(instance)}` : null,
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
  note?: string;
  /** CLI projects: the command the "Run in Docker" action executes */
  command?: string;
  runnable?: boolean;
  exitCode?: number | null;
} {
  const instance = instances.get(projectId);
  if (!instance) {
    return { status: "stopped", port: 4001, url: null, logs: [] };
  }
  const plan = instance.plan;
  const cli = plan.kind === "cli" ? { command: plan.command, runnable: true } : {};
  if (instance.status === "unavailable") {
    return {
      status: "unavailable",
      port: 0,
      url: null,
      logs: instance.logs.slice(-100),
      kind: plan.kind,
      reason: instance.reason,
      hint: instance.hint,
      ...cli,
    };
  }
  if (plan.kind === "cli") {
    return {
      status: instance.status,
      port: 0,
      url: null,
      logs: instance.logs.slice(-300),
      kind: "cli",
      reason: instance.reason,
      exitCode: instance.exitCode,
      error: instance.status === "error" ? instance.error : undefined,
      ...cli,
    };
  }
  const port = servedPort(instance);
  return {
    status: instance.status,
    port,
    url: `http://localhost:${port}`,
    logs: instance.logs.slice(-100),
    kind: plan.kind,
    framework:
      plan.kind === "node" || plan.kind === "python"
        ? plan.framework
        : plan.kind === "service"
          ? plan.lang
          : undefined,
    note: instance.note,
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

function setUnavailable(projectId: string, plan: RunPlan, reason: string, hint?: string, logs: string[] = []) {
  instances.set(projectId, {
    children: [],
    logs,
    status: "unavailable",
    port: 0,
    plan,
    container: false,
    reason,
    hint,
  });
  return getPreviewStatus(projectId);
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
  const detectOpts = { pythonAvailable: dockerMode ? true : hostPythonCmd() !== null, docker: dockerMode };
  let plan = detectRunPlan(root, detectOpts);
  const preLogs: string[] = [];

  if (plan.kind === "compose") {
    const prepared = await prepareCompose(root, plan);
    if (prepared.kind === "refused") {
      return setUnavailable(
        projectId,
        plan,
        `Refused to run ${plan.file}: ${prepared.problems.join("; ")}.`,
        "For safety, compose previews may not use privileged mode, host networking/PID, host devices, the Docker socket, or bind mounts outside the project folder."
      );
    }
    if (prepared.kind === "invalid") {
      // The compose file can't run as-is (missing .env / Dockerfile …):
      // fall back to running the project's own code directly
      preLogs.push(`[preview] ${plan.file} can't be started: ${prepared.message}\n`);
      const fallback = detectRunPlan(root, { ...detectOpts, skipCompose: true });
      if (fallback.kind === "none" || fallback.kind === "unsupported") {
        return setUnavailable(
          projectId,
          plan,
          `docker compose can't start ${plan.file}: ${prepared.message}`,
          "Fix the compose file (or add the missing files), then check again.",
          preLogs
        );
      }
      preLogs.push(`[preview] falling back to a ${fallback.kind === "node" && fallback.apiOnly ? "Node API" : fallback.kind} preview\n`);
      plan = fallback;
    } else {
      return startComposeInstance(projectId, root, plan, prepared.config, preLogs);
    }
  }

  if (plan.kind === "none" || plan.kind === "unsupported") {
    return setUnavailable(projectId, plan, plan.reason, plan.kind === "unsupported" ? plan.hint : undefined, preLogs);
  }
  if (plan.kind === "cli") {
    return setUnavailable(
      projectId,
      plan,
      plan.reason,
      `Use “Run in Docker” to run \`${plan.command}\` in a sandbox container; its output appears in the terminal below.`,
      preLogs
    );
  }
  if (plan.kind === "compose") return getPreviewStatus(projectId); // unreachable

  const port = await findAvailablePort(4001);
  const secretEnv = await getDecryptedEnv(projectId);
  const useContainer = (dockerMode && plan.kind !== "static") || plan.kind === "service";

  const instance: PreviewInstance = {
    children: [],
    logs: preLogs,
    status: "starting",
    port,
    plan,
    container: useContainer,
    note: (plan.kind === "node" && plan.apiOnly) || plan.kind === "service" ? API_ONLY_NOTE : undefined,
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
    } else if (plan.kind === "python") {
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

/** Mark running once the port answers HTTP (any status code — a 404 is a live server) */
function startProbe(instance: PreviewInstance) {
  let busy = false;
  instance.probe = setInterval(() => {
    if (instance.status !== "starting") {
      clearInterval(instance.probe);
      return;
    }
    if (busy) return;
    busy = true;
    if (instance.compose && !instance.compose.httpProbe) {
      // No HTTP service in the stack: running once every service is up
      void run("docker", ["compose", "-p", instance.compose.project, "ps", "--all", "--format", "json"], 15_000).then((r) => {
        busy = false;
        const rows = parseComposePs(r.stdout);
        if (rows.length && rows.every((x) => x.State === "running") && instance.status === "starting") {
          instance.status = "running";
        }
      });
      return;
    }
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

// ─── Docker: images & caches ─────────────────────────────────────────────────
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

type Lang = "python" | "rust" | "go" | "java";

/**
 * Image for a language toolchain: the polyglot sandbox image when it is built
 * (and new enough), else the official image.
 */
function toolchainImage(lang: Lang, plan?: ServicePlan): string {
  const polyglot = isPolyglotImageBuilt();
  switch (lang) {
    case "python":
      return process.env.SANDBOX_PYTHON_IMAGE || (polyglot ? POLYGLOT_SANDBOX_IMAGE : "python:3.12-slim");
    case "rust":
      return polyglot ? POLYGLOT_SANDBOX_IMAGE : "rust:1-slim";
    case "go":
      return polyglot ? POLYGLOT_SANDBOX_IMAGE : "golang:1.22";
    case "java": {
      const v = plan?.javaVersion ?? 17;
      // The polyglot image ships JDK 17
      if (v <= 17 && polyglot) return POLYGLOT_SANDBOX_IMAGE;
      const jdk = v <= 17 ? 17 : v <= 21 ? 21 : v;
      if (plan?.tool === "gradle") return plan.wrapper ? `eclipse-temurin:${jdk}-jdk` : `gradle:8-jdk${jdk}`;
      return `maven:3.9-eclipse-temurin-${jdk}`;
    }
  }
}

/** Shared named-volume caches (pip, cargo registry, go modules, maven, gradle) */
function toolchainCacheArgs(lang: Lang, image: string): string[] {
  switch (lang) {
    case "python":
      return ["-v", "oc-cache-pip:/oc-cache/pip", "-e", "PIP_CACHE_DIR=/oc-cache/pip", "-e", "PYTHONUNBUFFERED=1"];
    case "rust": {
      const cargoHome = image === POLYGLOT_SANDBOX_IMAGE ? "/cache/cargo" : "/usr/local/cargo";
      return ["-v", `oc-cache-cargo-registry:${cargoHome}/registry`, "-e", "CARGO_TERM_COLOR=never"];
    }
    case "go":
      return [
        "-v", "oc-cache-go:/oc-cache/go",
        "-e", "GOMODCACHE=/oc-cache/go/mod",
        "-e", "GOCACHE=/oc-cache/go/build",
      ];
    case "java":
      return [
        "-v", "oc-cache-m2:/oc-cache/m2",
        "-v", "oc-cache-gradle:/oc-cache/gradle",
        "-e", "MAVEN_USER_HOME=/oc-cache/m2",
        "-e", "MAVEN_OPTS=-Dmaven.repo.local=/oc-cache/m2/repository",
        "-e", "GRADLE_USER_HOME=/oc-cache/gradle",
      ];
  }
}

// ─── Docker: scripts ─────────────────────────────────────────────────────────
function pythonVenvLines(hasRequirements: boolean): string[] {
  const lines = [
    // A throwaway venv per run keeps the image clean; pip's cache volume makes reinstalls fast
    "python3 -m venv /tmp/venv 2>/dev/null || python -m venv /tmp/venv",
    ". /tmp/venv/bin/activate",
  ];
  if (hasRequirements) lines.push("pip install -q -r requirements.txt");
  return lines;
}

function containerScript(plan: NodePlan | PythonPlan, port: number): string {
  const lines = ["set -e"];
  if (plan.kind === "python") {
    const cwd = `/workspace/${plan.dir}`.replace(/\/$/, "");
    const runner = plan.framework === "fastapi" ? "fastapi uvicorn" : plan.framework;
    lines.push(`cd ${sq(cwd)}`);
    lines.push(...pythonVenvLines(plan.hasRequirements));
    lines.push(`pip install -q ${runner}`);
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

/** Java (Spring Boot) / Go API servers */
function serviceScript(plan: ServicePlan, port: number): string {
  const cwd = `/workspace/${plan.dir}`.replace(/\/$/, "");
  const lines = ["set -e", `cd ${sq(cwd)}`];
  if (plan.lang === "go") {
    lines.push('echo "[preview] go run ."');
    lines.push("exec go run .");
    return lines.join("\n");
  }
  const portArg = `--server.port=${port}`;
  if (plan.tool === "gradle") {
    const gradle = plan.wrapper ? "sh ./gradlew" : "gradle";
    lines.push(`exec ${gradle} --no-daemon bootRun ${sq(`--args=${portArg}`)}`);
    return lines.join("\n");
  }
  // The official maven image sets MAVEN_CONFIG=/root/.m2, which mvnw passes
  // to Maven as a CLI argument ("multiModuleProjectDirectory not set")
  lines.push("unset MAVEN_CONFIG");
  // Run the wrapper via `sh` (checkouts may lack +x); a CRLF wrapper can't
  // run in sh, so fall back to the image's Maven then
  lines.push(
    plan.wrapper
      ? 'if grep -q "$(printf \'\\r\')" ./mvnw; then echo "[preview] mvnw has CRLF line endings; using the image\'s mvn"; MVN() { mvn "$@"; }; else MVN() { sh ./mvnw "$@"; }; fi'
      : 'MVN() { mvn "$@"; }'
  );
  if (plan.module) {
    // Multi-module build: install sibling modules, then run the Boot app module
    lines.push('echo "[preview] building modules (mvn install -DskipTests)"');
    lines.push("MVN -B -ntp -DskipTests install");
    lines.push(`echo "[preview] starting ${plan.module} (spring-boot:run)"`);
    lines.push(`MVN -B -ntp -pl ${sq(plan.module)} spring-boot:run ${sq(`-Dspring-boot.run.arguments=${portArg}`)}`);
  } else {
    lines.push(`MVN -B -ntp spring-boot:run ${sq(`-Dspring-boot.run.arguments=${portArg}`)}`);
  }
  return lines.join("\n");
}

function cliScript(plan: CliPlan): string {
  const cwd = `/workspace/${plan.dir}`.replace(/\/$/, "");
  const lines = ["set -e", `cd ${sq(cwd)}`, `echo "$ ${plan.command}"`];
  switch (plan.lang) {
    case "rust":
      lines.push("exec cargo run");
      break;
    case "go":
      lines.push("exec go run .");
      break;
    case "python":
      lines.push(...pythonVenvLines(!!plan.hasRequirements));
      lines.push(`exec python ${sq(plan.entry ?? "main.py")}`);
      break;
  }
  return lines.join("\n");
}

function baseDockerArgs(projectId: string, root: string, secretEnv: Record<string, string>): string[] {
  const mount = `${path.resolve(root).replace(/\\/g, "/")}:/workspace`;
  const envFlags: string[] = [];
  for (const [key, value] of Object.entries(secretEnv)) {
    if (/^[A-Z0-9_]+$/i.test(key)) envFlags.push("-e", `${key}=${value}`);
  }
  return [
    "run", "--rm", "--init",
    "--name", previewContainerName(projectId),
    "--memory", "2g",
    "--cpus", "2",
    "--pids-limit", "1024",
    "-v", mount,
    "-w", "/workspace",
    "-e", "HOME=/tmp/home",
    ...envFlags,
  ];
}

function startContainer(
  projectId: string,
  root: string,
  instance: PreviewInstance,
  plan: NodePlan | PythonPlan | ServicePlan,
  secretEnv: Record<string, string>
) {
  try {
    execFileSync("docker", ["rm", "-f", previewContainerName(projectId)], { stdio: "pipe" });
  } catch {}

  const port = instance.port;
  const extra: string[] = [];
  let image: string;
  let script: string;
  let containerPort = port;

  if (plan.kind === "node") {
    // Named volumes shadow each node_modules → container-native binaries
    for (const d of plan.installDirs) {
      extra.push("-v", `${volumeName(projectId, d)}:${d ? `/workspace/${d}` : "/workspace"}/node_modules`);
    }
    extra.push(
      "-e", "npm_config_cache=/tmp/.npm-cache",
      "-e", "NEXT_TELEMETRY_DISABLED=1",
      // Host bind mounts (Docker Desktop) don't deliver inotify events, so
      // dev servers must poll to pick up edits made by the agent
      "-e", "WATCHPACK_POLLING=true",
      "-e", "CHOKIDAR_USEPOLLING=true"
    );
    // Not SANDBOX_IMAGE: that is often node:20-slim, which lacks openssl
    // (Prisma engines) and build tools (native modules) dev servers need
    image = process.env.SANDBOX_PREVIEW_IMAGE || "node:20";
    script = containerScript(plan, port);
  } else if (plan.kind === "python") {
    image = toolchainImage("python");
    extra.push(...toolchainCacheArgs("python", image));
    script = containerScript(plan, port);
  } else {
    image = toolchainImage(plan.lang, plan);
    extra.push(...toolchainCacheArgs(plan.lang, image));
    if (plan.lang === "java") extra.push("-e", `SERVER_PORT=${port}`);
    if (plan.lang === "go" && plan.fixedPort) {
      containerPort = plan.fixedPort;
      pushLog(instance, `[preview] the Go server listens on hard-coded port ${plan.fixedPort}; publishing it on ${port}\n`);
    }
    script = serviceScript(plan, port);
  }
  pushLog(instance, `[preview] running in docker (${image})\n`);

  const args = [
    ...baseDockerArgs(projectId, root, secretEnv),
    "-p", `${port}:${containerPort}`,
    "-e", `PORT=${containerPort}`,
    "-e", "HOST=0.0.0.0",
    ...extra,
    image,
    "sh", "-c", script,
  ];
  const child = crossSpawn("docker", args, { env: process.env });
  track(instance, child, { main: true });
}

// ─── CLI runs ────────────────────────────────────────────────────────────────
/**
 * Run a CLI project's default command in a container ("Run in Docker").
 * Output streams into the preview logs; status is running → exited.
 */
export async function runCli(projectId: string) {
  const existing = instances.get(projectId);
  if (existing && existing.plan.kind === "cli" && existing.status === "running") {
    return getPreviewStatus(projectId);
  }
  if (existing) stopPreview(projectId);

  const root = getWorkspaceRoot(projectId);
  const plan = detectRunPlan(root, { pythonAvailable: true, docker: true, skipCompose: true });
  if (plan.kind !== "cli") {
    return { ...(await startPreview(projectId)), error: "This project isn't a command-line program." };
  }
  const secretEnv = await getDecryptedEnv(projectId);
  const instance: PreviewInstance = {
    children: [],
    logs: [],
    status: "running",
    port: 0,
    plan,
    container: true,
    reason: plan.reason,
  };
  instances.set(projectId, instance);
  try {
    execFileSync("docker", ["rm", "-f", previewContainerName(projectId)], { stdio: "pipe" });
  } catch {}

  const image = toolchainImage(plan.lang);
  const extra = [...toolchainCacheArgs(plan.lang, image)];
  if (plan.lang === "rust") {
    // Build output in a per-project volume (not the bind mount): fast + no host clutter
    extra.push("-v", `oc-target-${projectId.toLowerCase()}:/oc-target`, "-e", "CARGO_TARGET_DIR=/oc-target");
  }
  pushLog(instance, `[run] ${plan.command} in docker (${image})\n`);
  const args = [...baseDockerArgs(projectId, root, secretEnv), ...extra, image, "sh", "-c", cliScript(plan)];
  const child = crossSpawn("docker", args, { env: process.env });
  instance.children.push(child);
  child.stdout?.on("data", (d) => pushLog(instance, d.toString()));
  child.stderr?.on("data", (d) => pushLog(instance, d.toString()));
  child.on("error", (err) => {
    pushLog(instance, `\n[failed to start: ${err.message}]\n`);
    instance.status = "error";
    instance.error = err.message;
  });
  child.on("exit", (code) => {
    if (instance.timeout) clearTimeout(instance.timeout);
    if (instance.status === "stopped") return;
    pushLog(instance, `\n[process exited with code ${code}]\n`);
    instance.status = "exited";
    instance.exitCode = code;
  });
  instance.timeout = setTimeout(() => {
    if (instance.status !== "running") return;
    pushLog(instance, `\n[run timed out after ${CLI_TIMEOUT_MS / 60000} minutes — stopping]\n`);
    try {
      execFileSync("docker", ["kill", previewContainerName(projectId)], { stdio: "pipe" });
    } catch {}
  }, CLI_TIMEOUT_MS);
  return getPreviewStatus(projectId);
}

// ─── Docker Compose ──────────────────────────────────────────────────────────
type ComposePrep =
  | { kind: "ok"; config: Record<string, unknown> }
  | { kind: "refused"; problems: string[] }
  | { kind: "invalid"; message: string };

function composeBaseArgs(root: string, plan: ComposePlan): string[] {
  const dir = plan.dir ? path.join(root, plan.dir) : root;
  return ["compose", "-f", path.join(root, plan.file), "--project-directory", dir];
}

/** Load the normalized compose model and security-check it */
async function prepareCompose(root: string, plan: ComposePlan): Promise<ComposePrep> {
  const r = await run("docker", [...composeBaseArgs(root, plan), "config", "--format", "json"], 60_000);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout)
      .split("\n")
      .filter((l) => l.trim() && !/level=warn/i.test(l))
      .slice(-3)
      .join(" ")
      .trim()
      .slice(0, 400);
    return { kind: "invalid", message: msg || `docker compose config exited with ${r.code}` };
  }
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(r.stdout);
  } catch {
    return { kind: "invalid", message: "could not parse `docker compose config` output" };
  }
  const check = checkComposeConfig(config, root);
  const problems = [...check.problems];
  const services = (config.services ?? {}) as Record<string, Record<string, unknown>>;
  const missing: string[] = [];
  for (const [name, svc] of Object.entries(services)) {
    const build = svc.build as { context?: string; dockerfile?: string } | undefined;
    if (!build?.context) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(build.context)) {
      problems.push(`service "${name}" builds from a remote context (${build.context})`);
      continue;
    }
    // The build context is sent to the builder: it must not expose host files
    if (!isInsideWorkspace(build.context, root)) {
      problems.push(`service "${name}" builds from a directory outside the project (${build.context})`);
      continue;
    }
    const dockerfile = path.resolve(build.context, build.dockerfile || "Dockerfile");
    if (!build.dockerfile?.includes("\n") && !fs.existsSync(dockerfile)) {
      missing.push(`service "${name}" needs ${path.relative(root, dockerfile).replace(/\\/g, "/")}, which doesn't exist`);
    }
  }
  if (problems.length) return { kind: "refused", problems };
  if (missing.length) return { kind: "invalid", message: missing.join("; ") };
  return { kind: "ok", config };
}

function parseComposePs(out: string): Array<{ Service?: string; State?: string }> {
  const text = out.trim();
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [v];
  } catch {
    // Newer compose prints one JSON object per line
    return text
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}

async function startComposeInstance(
  projectId: string,
  root: string,
  plan: ComposePlan,
  config: Record<string, unknown>,
  preLogs: string[]
) {
  const project = composeProjectName(projectId);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `oc-compose-${projectId}-`));
  const instance: PreviewInstance = {
    children: [],
    logs: preLogs,
    status: "starting",
    port: 0,
    plan,
    container: true,
    compose: { project, tmpDir, httpProbe: true },
  };
  instances.set(projectId, instance);

  // Remap host ports that collide with the platform or anything already
  // listening. The user's compose file is never edited: we run a generated
  // copy of the normalized model from a temp dir outside the workspace.
  const services = (config.services ?? {}) as Record<string, Record<string, unknown>>;
  const claimed: number[] = [];
  const remapped = new Map<string, number>(); // `${service}:${target}` → host port
  for (const [name, svc] of Object.entries(services)) {
    if (svc.container_name) {
      pushLog(instance, `[preview] ignoring container_name "${String(svc.container_name)}" of ${name} (names are scoped to the preview project)\n`);
      delete svc.container_name;
    }
    const ports = Array.isArray(svc.ports) ? (svc.ports as Array<Record<string, unknown>>) : [];
    for (const p of ports) {
      if (p.protocol && p.protocol !== "tcp") continue;
      const target = Number(p.target);
      const published = p.published != null && p.published !== "" ? Number(String(p.published).split("-")[0]) : NaN;
      let host = published;
      const conflict =
        !Number.isInteger(published) ||
        published === PLATFORM_PORT ||
        claimed.includes(published) ||
        !(await isPortFree(published));
      if (conflict) {
        host = await findAvailablePort(4001);
        claimed.push(host);
        pushLog(
          instance,
          Number.isInteger(published)
            ? `[preview] host port ${published} (${name}:${target}) is ${published === PLATFORM_PORT ? "used by the platform" : "already in use"} → published on ${host} instead\n`
            : `[preview] ${name}:${target} → published on ${host}\n`
        );
      } else {
        claimed.push(published);
      }
      p.published = String(host);
      delete p.host_ip; // keep it reachable on localhost
      remapped.set(`${name}:${target}`, host);
    }
  }
  for (const p of claimed) reservedPorts.delete(p);

  const check = checkComposeConfig(config, root);
  const web = pickComposeWebPort(check.ports);
  if (web?.published) {
    instance.port = web.published;
    pushLog(instance, `[preview] showing service "${web.service}" (container port ${web.target}) at http://localhost:${web.published}\n`);
  } else {
    instance.compose!.httpProbe = false;
    instance.note = "This stack has no web service — the preview shows its containers' logs only.";
  }

  const file = path.join(tmpDir, "compose.json");
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  const dir = plan.dir ? path.join(root, plan.dir) : root;
  pushLog(instance, `[preview] docker compose -p ${project} up --build (${plan.file})\n`);
  const child = crossSpawn(
    "docker",
    ["compose", "-p", project, "-f", file, "--project-directory", dir, "up", "--build"],
    { env: process.env }
  );
  track(instance, child, { main: true });
  startProbe(instance);
  await new Promise((r) => setTimeout(r, 1500));
  return getPreviewStatus(projectId);
}

function stopCompose(instance: PreviewInstance) {
  const c = instance.compose;
  if (!c) return;
  // `down` without -v: named volumes (databases) are always kept
  const child = crossSpawn("docker", ["compose", "-p", c.project, "down", "--remove-orphans"], {
    env: process.env,
    stdio: "ignore",
  });
  child.on("exit", () => {
    try {
      fs.rmSync(c.tmpDir, { recursive: true, force: true });
    } catch {}
  });
  child.on("error", () => {});
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
    if (instance.timeout) clearTimeout(instance.timeout);
    if (instance.compose) {
      stopCompose(instance);
    } else if (instance.container && wasActive) {
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
