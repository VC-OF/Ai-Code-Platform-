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

function pushLog(instance: PreviewInstance, line: string) {
  instance.logs.push(line);
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
  if (existing && existing.status !== "stopped") {
    return getPreviewStatus(projectId);
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
    // Host mode: install deps on the host if missing
    const nodeModulesPath = path.join(root, "node_modules");
    if (!fs.existsSync(nodeModulesPath)) {
      try {
        await execAsync("npm install", { cwd: root });
      } catch (installErr) {
        console.error("Failed to run npm install in workspace:", installErr);
      }
    }
  }

  const child = dockerMode
    ? (spawn("docker", buildPreviewDockerArgs(projectId, root, port, secretEnv), {
        env: process.env,
      }) as ChildProcessWithoutNullStreams)
    : (spawn("npm", ["run", "dev", "--", "--port", String(port)], {
        cwd: root,
        env: { ...process.env, ...secretEnv, PORT: String(port) },
        shell: true,
        // Own process group on POSIX so the whole tree can be killed together
        detached: process.platform !== "win32",
      }) as ChildProcessWithoutNullStreams);

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
    if (/ready|started server|compiled/i.test(text))
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
