import { spawn, exec, execSync, ChildProcessWithoutNullStreams } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { getWorkspaceRoot } from "./workspace";
import { getDecryptedEnv } from "./settingsStore";
import { isDockerMode } from "./safeExec";
import net from "net";

const execAsync = promisify(exec);

// ─── Containerized preview (SANDBOX_MODE=docker) ─────────────────────────────
/**
 * In docker mode the generated app's dev server runs INSIDE a container:
 * no host process, no host env/secrets beyond what's explicitly passed,
 * and the port is mapped out. A named volume shadows /workspace/node_modules
 * so Linux binaries never mix with host-installed (Windows) ones, and the
 * container installs its own dependencies on boot.
 */
function previewContainerName(projectId: string): string {
  return `oc-preview-${projectId}`.toLowerCase();
}

function buildPreviewDockerArgs(
  projectId: string,
  root: string,
  port: number,
  secretEnv: Record<string, string>
): string[] {
  const image = process.env.SANDBOX_IMAGE || "node:20";
  const mount = `${path.resolve(root).replace(/\\/g, "/")}:/workspace`;

  // Framework-aware host binding: vite needs an explicit --host to accept
  // connections from outside the container; next binds 0.0.0.0 by default
  let devArgs = `--port ${port}`;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8")
    );
    const hasVite = !!(pkg.devDependencies?.vite || pkg.dependencies?.vite);
    if (hasVite) devArgs += " --host 0.0.0.0";
  } catch {}

  const envFlags: string[] = [];
  for (const [key, value] of Object.entries(secretEnv)) {
    if (/^[A-Z0-9_]+$/i.test(key)) envFlags.push("-e", `${key}=${value}`);
  }

  return [
    "run", "--rm", "--init",
    "--name", previewContainerName(projectId),
    "-p", `${port}:${port}`,
    "--memory", "2g",
    "--cpus", "2",
    "--pids-limit", "1024",
    "-v", mount,
    // Named volume shadows node_modules → container-native binaries
    "-v", `oc-nm-${projectId}:/workspace/node_modules`,
    "-w", "/workspace",
    "-e", "HOME=/workspace",
    "-e", `PORT=${port}`,
    "-e", "npm_config_cache=/tmp/.npm-cache",
    ...envFlags,
    image,
    "sh", "-c",
    `npm install --no-audit --no-fund && npm run dev -- ${devArgs}`,
  ];
}

interface PreviewInstance {
  child: ChildProcessWithoutNullStreams;
  logs: string[];
  status: "stopped" | "starting" | "running" | "error";
  port: number;
}

const instances = new Map<string, PreviewInstance>();

async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (port < 5000) {
    const isFree = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.on("error", () => resolve(false));
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
    });
    // Double check it's not logically reserved by another instance in our map
    const alreadyMapped = Array.from(instances.values()).some(
      (i) => i.port === port && i.status !== "stopped"
    );
    if (isFree && !alreadyMapped) return port;
    port++;
  }
  throw new Error("No available ports");
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
}

function pushLog(instance: PreviewInstance, line: string) {
  instance.logs.push(stripAnsi(line));
  if (instance.logs.length > 500) instance.logs = instance.logs.slice(-500);
}

export function getPreviewLogs(projectId: string, lines = 100) {
  const instance = instances.get(projectId);
  if (!instance) {
    return { status: "stopped" as const, url: null, logs: [] as string[] };
  }
  return {
    status: instance.status,
    url: `http://localhost:${instance.port}`,
    logs: instance.logs.slice(-Math.max(1, Math.min(lines, 500))),
  };
}

export function getPreviewStatus(projectId: string) {
  const instance = instances.get(projectId);
  if (!instance) {
    return { status: "stopped", port: 4001, url: null, logs: [] };
  }
  return {
    status: instance.status,
    port: instance.port,
    url: `http://localhost:${instance.port}`,
    logs: instance.logs.slice(-100),
  };
}

export async function startPreview(projectId: string) {
  const existing = instances.get(projectId);
  if (existing) {
    if (existing.status === "running" || existing.status === "starting") {
      return getPreviewStatus(projectId);
    }
    // Clean up errored or stopped instances
    stopPreview(projectId);
  }

  const port = await findAvailablePort(4001);
  const secretEnv = await getDecryptedEnv(projectId);
  const root = getWorkspaceRoot(projectId);
  const dockerMode = isDockerMode();

  if (dockerMode) {
    // Remove any leftover container with this name (crashed earlier run)
    try {
      execSync(`docker rm -f ${previewContainerName(projectId)}`, {
        stdio: "pipe",
      });
    } catch {}
  } else {
    // Host mode: check package.json and ensure dev script exists
    const pkgPath = path.join(root, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (!pkg.scripts?.dev && (pkg.devDependencies?.vite || pkg.dependencies?.vite)) {
          pkg.scripts = { ...pkg.scripts, dev: "vite" };
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
        }
      } catch {}

      // Install deps on host if node_modules is missing
      const nodeModulesPath = path.join(root, "node_modules");
      if (!fs.existsSync(nodeModulesPath)) {
        try {
          await execAsync("npm install --no-audit --no-fund", { cwd: root });
        } catch (installErr) {
          console.error("Failed to run npm install in workspace:", installErr);
        }
      }
    }
  }

  // Determine whether we can run npm run dev
  const pkgPath = path.join(root, "package.json");
  let hasDevScript = false;
  let isVite = false;
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      hasDevScript = !!pkg.scripts?.dev;
      isVite = !!(pkg.devDependencies?.vite || pkg.dependencies?.vite || pkg.scripts?.dev?.includes("vite"));
    } catch {}
  }

  let child: ChildProcessWithoutNullStreams;

  if (dockerMode) {
    child = spawn("docker", buildPreviewDockerArgs(projectId, root, port, secretEnv), {
      env: process.env,
    }) as ChildProcessWithoutNullStreams;
  } else if (hasDevScript) {
    // CRITICAL: We pass --prefix so npm NEVER traverses up to parent folders
    const npmArgs = ["run", "dev", "--prefix", root, "--", "--port", String(port)];
    if (isVite) {
      npmArgs.push("--host", "0.0.0.0");
    }
    child = spawn("npm", npmArgs, {
      cwd: root,
      env: { ...process.env, ...secretEnv, PORT: String(port) },
      shell: true,
      detached: process.platform !== "win32",
    }) as ChildProcessWithoutNullStreams;
  } else {
    // Fallback static HTTP server for projects without a package dev script
    const staticScript = `
      const http = require('http');
      const fs = require('fs');
      const path = require('path');
      const mime = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
      };
      const rootDir = process.cwd();
      http.createServer((req, res) => {
        let reqPath = decodeURIComponent(req.url.split('?')[0]);
        if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
        let safePath = path.normalize(path.join(rootDir, reqPath));
        if (!safePath.startsWith(rootDir)) {
          res.writeHead(403);
          return res.end('Forbidden');
        }
        if (fs.existsSync(safePath) && fs.statSync(safePath).isDirectory()) {
          safePath = path.join(safePath, 'index.html');
        }
        if (!fs.existsSync(safePath)) safePath = path.join(rootDir, 'index.html');
        if (!fs.existsSync(safePath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('File not found');
        }
        const ext = path.extname(safePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': mime[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(safePath).pipe(res);
      }).listen(${port}, '0.0.0.0', () => {
        console.log('ready: static server running on http://localhost:${port}');
      });
    `;
    child = spawn(process.execPath, ["-e", staticScript], {
      cwd: root,
      env: { ...process.env, ...secretEnv, PORT: String(port) },
      shell: true,
      detached: process.platform !== "win32",
    }) as ChildProcessWithoutNullStreams;
  }

  const instance: PreviewInstance = {
    child,
    logs: [],
    status: "starting",
    port,
  };
  instances.set(projectId, instance);

  instance.child.stdout.on("data", (d) => {
    const text = d.toString();
    pushLog(instance, text);
    if (/ready|started server|compiled|local:|network:/i.test(text))
      instance.status = "running";
  });

  instance.child.stderr.on("data", (d) => {
    pushLog(instance, d.toString());
  });

  instance.child.on("exit", (code) => {
    pushLog(instance, `\n[process exited with code ${code}]`);
    instance.status = code === 0 ? "stopped" : "error";
  });

  // Give it a moment to boot before returning
  await new Promise((r) => setTimeout(r, 1500));

  return getPreviewStatus(projectId);
}

export function stopPreview(projectId: string) {
  const instance = instances.get(projectId);
  if (instance) {
    if (isDockerMode()) {
      // The docker CLI child is just an attachment — kill the container
      try {
        execSync(`docker kill ${previewContainerName(projectId)}`, {
          stdio: "pipe",
        });
      } catch {}
      try { instance.child?.kill(); } catch {}
    } else if (instance.child) {
      killProcessTree(instance.child);
    }
    instance.status = "stopped";
  }
  return getPreviewStatus(projectId);
}

/**
 * Kill the dev server and all its children. The child is spawned with
 * shell: true, so a plain .kill() would only terminate the shell and
 * orphan the npm → framework process tree (leaving the port occupied),
 * especially on Windows.
 */
function killProcessTree(child: ChildProcessWithoutNullStreams) {
  if (child.pid == null) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "pipe" });
    } catch {
      try { child.kill(); } catch {}
    }
  } else {
    try {
      // Negative pid targets the process group when detached; fall back to
      // the direct child otherwise
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try { child.kill(); } catch {}
    }
  }
}
