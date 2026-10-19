import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import type { ScienceToolResult } from "./scienceTools";

const execFileAsync = promisify(execFile);

export type SidecarToolResult = ScienceToolResult;

export interface SidecarInstance {
  id: string;
  name: string;
  type: "postgres" | "redis" | "mysql" | "mongodb";
  containerName: string;
  port: number;
  dbName?: string;
  url: string;
  startedAt: number;
  isSimulated?: boolean;
}

// In-memory sidecar registry across agent turns
const shared = globalThis as unknown as { __ocSidecars?: Map<string, Map<string, SidecarInstance>> };
const registry = (shared.__ocSidecars ??= new Map<string, Map<string, SidecarInstance>>());

function workspaceSidecars(workspace: string): Map<string, SidecarInstance> {
  const key = path.resolve(workspace);
  let sidecars = registry.get(key);
  if (!sidecars) registry.set(key, (sidecars = new Map()));
  return sidecars;
}

// Check Docker availability
async function isDockerCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["version"], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

// Inject or update environment variables in .env.local
async function injectEnvVariable(workspace: string, key: string, value: string): Promise<string> {
  const envPath = path.join(workspace, ".env.local");
  let content = "";
  try {
    content = await fs.readFile(envPath, "utf-8");
  } catch {
    content = "";
  }

  const regex = new RegExp(`^${key}=.*$`, "m");
  let updated = "";
  if (regex.test(content)) {
    updated = content.replace(regex, `${key}="${value}"`);
  } else {
    updated = `${content}${content && !content.endsWith("\n") ? "\n" : ""}${key}="${value}"\n`;
  }

  await fs.writeFile(envPath, updated, "utf-8");
  return envPath;
}

// ─── Schemas ───────────────────────────────────────────────────────────────────

const fn = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = []
) => ({
  type: "function" as const,
  function: {
    name,
    description,
    parameters: { type: "object", properties, required },
  },
});

export const SIDECAR_TOOL_SCHEMAS = [
  fn(
    "database_sidecar_start",
    "Provision and start an on-demand containerized database sidecar (PostgreSQL, Redis, MySQL, or MongoDB) with automatic connection string generation and optional injection into .env.local.",
    {
      type: {
        type: "string",
        enum: ["postgres", "redis", "mysql", "mongodb"],
        description: "Database engine type (default: 'postgres')",
      },
      name: {
        type: "string",
        description: "Optional friendly name for the sidecar container (e.g. 'auth-db', 'app-cache')",
      },
      port: {
        type: "integer",
        description: "Host port to map to (defaults: postgres 5432, redis 6379, mysql 3306, mongodb 27017)",
      },
      db_name: {
        type: "string",
        description: "Database name to initialize (default: 'app')",
      },
      auto_env: {
        type: "boolean",
        description: "Whether to automatically write/update DATABASE_URL or REDIS_URL in .env.local (default: true)",
      },
    }
  ),
  fn(
    "database_sidecar_stop",
    "Stop and remove an on-demand database sidecar container.",
    {
      name: {
        type: "string",
        description: "Name or container name of the database sidecar to stop",
      },
    },
    ["name"]
  ),
  fn("database_sidecar_status", "List all active database sidecars, container statuses, and connection strings."),
];

export const SIDECAR_ZOD_SCHEMAS = {
  database_sidecar_start: z.object({
    type: z.enum(["postgres", "redis", "mysql", "mongodb"]).optional(),
    name: z.string().max(100).optional(),
    port: z.number().int().min(1024).max(65535).optional(),
    db_name: z.string().max(100).optional(),
    auto_env: z.boolean().optional(),
  }),
  database_sidecar_stop: z.object({
    name: z.string().min(1).max(100),
  }),
  database_sidecar_status: z.object({}).optional(),
};

const SIDECAR_TOOL_NAMES = new Set(SIDECAR_TOOL_SCHEMAS.map((s) => s.function.name));

export function isSidecarTool(name: string): boolean {
  return SIDECAR_TOOL_NAMES.has(name);
}

// ─── Executor ──────────────────────────────────────────────────────────────────

export async function executeSidecarTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string
): Promise<SidecarToolResult> {
  const sidecars = workspaceSidecars(workspace);

  switch (name) {
    case "database_sidecar_start": {
      const type = (args.type as "postgres" | "redis" | "mysql" | "mongodb") || "postgres";
      const customName = args.name ? String(args.name) : undefined;
      const dbName = args.db_name ? String(args.db_name) : "app";
      const autoEnv = args.auto_env !== false;

      const defaultPorts: Record<string, number> = {
        postgres: 5432,
        redis: 6379,
        mysql: 3306,
        mongodb: 27017,
      };

      const port = args.port ? Number(args.port) : defaultPorts[type];
      const identifier = customName || `${type}-sidecar`;
      const containerName = `oc-${path.basename(workspace)}-${identifier}`.replace(/[^a-zA-Z0-9_-]/g, "_");

      let connUrl = "";
      let envKey = "DATABASE_URL";
      if (type === "postgres") {
        connUrl = `postgresql://postgres:postgres@localhost:${port}/${dbName}`;
        envKey = "DATABASE_URL";
      } else if (type === "redis") {
        connUrl = `redis://localhost:${port}`;
        envKey = "REDIS_URL";
      } else if (type === "mysql") {
        connUrl = `mysql://root:root@localhost:${port}/${dbName}`;
        envKey = "DATABASE_URL";
      } else if (type === "mongodb") {
        connUrl = `mongodb://localhost:${port}/${dbName}`;
        envKey = "MONGODB_URI";
      }

      const hasDocker = await isDockerCliAvailable();

      if (hasDocker) {
        // Stop any pre-existing container with same name
        try {
          await execFileAsync("docker", ["rm", "-f", containerName], { timeout: 10_000 });
        } catch {}

        const dockerArgs: string[] = ["run", "-d", "--name", containerName, "-p", `${port}:${defaultPorts[type]}`];

        if (type === "postgres") {
          dockerArgs.push(
            "-e",
            "POSTGRES_PASSWORD=postgres",
            "-e",
            "POSTGRES_USER=postgres",
            "-e",
            `POSTGRES_DB=${dbName}`,
            "postgres:16-alpine"
          );
        } else if (type === "redis") {
          dockerArgs.push("redis:7-alpine");
        } else if (type === "mysql") {
          dockerArgs.push(
            "-e",
            "MYSQL_ROOT_PASSWORD=root",
            "-e",
            `MYSQL_DATABASE=${dbName}`,
            "mysql:8"
          );
        } else if (type === "mongodb") {
          dockerArgs.push("mongo:7");
        }

        try {
          await execFileAsync("docker", dockerArgs, { timeout: 30_000 });
          // Register instance
          const instance: SidecarInstance = {
            id: containerName,
            name: identifier,
            type,
            containerName,
            port,
            dbName,
            url: connUrl,
            startedAt: Date.now(),
          };
          sidecars.set(identifier, instance);

          let envNote = "";
          if (autoEnv) {
            await injectEnvVariable(workspace, envKey, connUrl);
            envNote = `\nConfigured ${envKey} in .env.local automatically.`;
          }

          return {
            success: true,
            output:
              `Database sidecar '${identifier}' (${type}) started successfully on port ${port}.\n` +
              `Container: ${containerName}\n` +
              `Connection URL: ${connUrl}${envNote}\n` +
              `Ready to accept client connections.`,
            summary: `Started ${type} sidecar on port ${port}`,
            extra: {
              name: identifier,
              containerName,
              port,
              type,
              url: connUrl,
              envKey,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            output: `Failed to launch ${type} container via Docker: ${msg}`,
            summary: `Failed to launch ${type} sidecar`,
            error: msg,
            suggestion: "Ensure Docker daemon is running and image can be pulled.",
          };
        }
      } else {
        // Docker not running on host: fallback simulation / configuration
        const instance: SidecarInstance = {
          id: `sim-${identifier}`,
          name: identifier,
          type,
          containerName: `sim-${containerName}`,
          port,
          dbName,
          url: connUrl,
          startedAt: Date.now(),
          isSimulated: true,
        };
        sidecars.set(identifier, instance);

        let envNote = "";
        if (autoEnv) {
          await injectEnvVariable(workspace, envKey, connUrl);
          envNote = `\nConfigured ${envKey} in .env.local automatically.`;
        }

        return {
          success: true,
          output:
            `Configured ${type} sidecar endpoint (Docker engine not running on host):\n` +
            `Connection URL: ${connUrl}${envNote}\n\n` +
            `Notice: Docker daemon is currently unreachable. Start Docker Desktop if you require a live database container.`,
          summary: `Configured ${type} sidecar endpoint (${port})`,
          extra: {
            name: identifier,
            port,
            type,
            url: connUrl,
            simulated: true,
          },
        };
      }
    }

    case "database_sidecar_stop": {
      const target = String(args.name);
      let instance: SidecarInstance | undefined = sidecars.get(target);

      if (!instance) {
        for (const [, v] of sidecars.entries()) {
          if (v.containerName === target || v.type === target) {
            instance = v;
            break;
          }
        }
      }

      if (!instance) {
        return {
          success: false,
          output: `Database sidecar '${target}' not found. Active sidecars: ${[...sidecars.keys()].join(", ") || "(none)"}`,
          summary: `Sidecar not found: ${target}`,
          error: "Sidecar not found",
        };
      }

      sidecars.delete(instance.name);

      if (!instance.isSimulated) {
        try {
          await execFileAsync("docker", ["rm", "-f", instance.containerName], { timeout: 15_000 });
        } catch {}
      }

      return {
        success: true,
        output: `Stopped and removed database sidecar '${instance.name}' (${instance.containerName}).`,
        summary: `Stopped sidecar ${instance.name}`,
      };
    }

    case "database_sidecar_status": {
      const active = [...sidecars.values()];
      if (active.length === 0) {
        return {
          success: true,
          output: "No database sidecars currently active in this workspace.",
          summary: "Sidecar status: 0 active",
        };
      }

      const lines = active.map(
        (s) =>
          `• [${s.type.toUpperCase()}] ${s.name} (container: ${s.containerName}) on port ${s.port}\n  URL: ${s.url}${s.isSimulated ? " [Simulated/Offline]" : " [Running]"}`
      );

      return {
        success: true,
        output: `Active Database Sidecars (${active.length}):\n\n${lines.join("\n\n")}`,
        summary: `Sidecars: ${active.length} active`,
        extra: { sidecars: active },
      };
    }

    default:
      return {
        success: false,
        output: `Unknown sidecar tool: ${name}`,
        summary: `Unknown tool ${name}`,
        error: `Unknown tool ${name}`,
      };
  }
}
