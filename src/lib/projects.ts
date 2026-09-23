import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { getWorkspaceRoot, ensureWorkspace } from "./workspace";
import { getTemplate } from "./templates";
import { projectDb, messageDb, type DbProject } from "./db";

const execFileAsync = promisify(execFile);

export interface Project {
  id: string;
  title: string;
  kind: "app" | "build";
  createdAt: number;
  updatedAt: number;
  chatHistory: { role: "user" | "assistant"; content: string }[];
}

/**
 * SQLite (projectDb) is the single source of truth. The legacy
 * .platform/projects.json store is migrated in once and renamed away.
 */

const LEGACY_JSON = path.join(process.cwd(), ".platform", "projects.json");
let migrated = false;

async function migrateLegacyJson(): Promise<void> {
  if (migrated) return;
  migrated = true;
  try {
    const raw = await fs.readFile(LEGACY_JSON, "utf-8");
    const legacy: Project[] = JSON.parse(raw);
    for (const p of legacy) {
      if (!projectDb.getById(p.id)) {
        try {
          projectDb.create({
            id: p.id,
            name: p.title,
            workspace: getWorkspaceRoot(p.id),
            description: null,
          });
        } catch {
          // e.g. workspace UNIQUE conflict — skip
        }
      }
    }
    await fs.rename(LEGACY_JSON, LEGACY_JSON + ".migrated");
  } catch {
    // No legacy file — nothing to migrate
  }
}

function toProject(row: DbProject): Project {
  return {
    id: row.id,
    title: row.name,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    chatHistory: [],
  };
}

export async function getProjects(): Promise<Project[]> {
  await migrateLegacyJson();
  return projectDb.getAll().map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  await migrateLegacyJson();
  const row = projectDb.getById(id);
  if (!row) return null;

  const project = toProject(row);
  try {
    const dbMsgs = messageDb.getRecent(id, 300);
    project.chatHistory = dbMsgs
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
  } catch (err) {
    console.error("Failed to load chatHistory from SQLite:", err);
  }
  return project;
}

export async function createProject(
  title: string = "New Project",
  templateId?: string
): Promise<Project> {
  await migrateLegacyJson();
  const id = "proj_" + Math.random().toString(36).substring(2, 11);

  const workspaceRoot = getWorkspaceRoot(id);
  await ensureWorkspace(id);

  try {
    // Scaffolding default AGENTS.md memory file
    let pkgManager = "npm";
    try {
      const filesInParent = await fs.readdir(process.cwd());
      if (filesInParent.includes("pnpm-lock.yaml")) pkgManager = "pnpm";
      else if (filesInParent.includes("yarn.lock")) pkgManager = "yarn";
    } catch {}

    const defaultAgentsMd = `# Project conventions
- Package manager: ${pkgManager}
- Test command: ${pkgManager} test
- Always read a file before editing it
- Run lint/tests after any code change before finishing a turn
`;
    await fs.writeFile(path.join(workspaceRoot, "AGENTS.md"), defaultAgentsMd, "utf8");

    // Scaffold starter template files (if any)
    const template = getTemplate(templateId);
    for (const [relPath, content] of Object.entries(template.files)) {
      const full = path.join(workspaceRoot, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf8");
    }

    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    await execFileAsync("git", ["add", "-A"], { cwd: workspaceRoot });
    await execFileAsync(
      "git",
      [
        "-c", "user.name=Open Code",
        "-c", "user.email=agent@opencode.local",
        "commit", "-m", "initial", "--allow-empty",
      ],
      { cwd: workspaceRoot }
    );
  } catch {
    // Scaffold/Git init is best-effort
  }

  projectDb.create({
    id,
    name: title,
    workspace: workspaceRoot,
    description: null,
  });

  const row = projectDb.getById(id)!;
  return toProject(row);
}

// ─── Build Mode: point a project at an arbitrary existing folder ─────────────
// Unlike app-mode projects (sandboxed under workspaces/<id>, scaffolded from
// a template), Build Mode opens a real directory directly — the "point the
// agent at any codebase" model. The safety trade-off: safeResolve still
// jails file tools to this folder, but the folder itself is real and
// consequential, so creation is gated by a path denylist below.

const WIN_FORBIDDEN_PREFIXES = [
  "c:\\windows", "c:\\program files", "c:\\programdata", "c:\\$recycle.bin",
];
const POSIX_FORBIDDEN_PREFIXES = [
  "/etc", "/usr", "/bin", "/sbin", "/boot", "/root", "/sys", "/proc", "/dev", "/var", "/lib",
];

export async function validateBuildModePath(rawPath: string): Promise<string> {
  const trimmed = (rawPath ?? "").trim();
  if (!trimmed) {
    throw new Error("Folder path is required");
  }
  if (!path.isAbsolute(trimmed)) {
    throw new Error(
      "Folder path must be absolute, e.g. C:\\Users\\you\\my-project or /home/you/my-project"
    );
  }
  const resolved = path.resolve(trimmed);

  // A whole filesystem root (C:\, D:\, /) — never let the agent loose there
  if (path.parse(resolved).root === resolved) {
    throw new Error("Refusing to open a filesystem root — choose a specific project folder");
  }

  // The platform's own directory (or an ancestor containing it) — opening
  // it would let the agent edit its own source, .env.local, and DB
  const cwd = path.resolve(process.cwd());
  if (resolved === cwd || cwd.startsWith(resolved + path.sep)) {
    throw new Error("Refusing to open the platform's own directory");
  }

  // The bare home directory — subfolders are fine, but the root holds
  // .ssh/.aws/browser profiles/etc. alongside everything else
  if (resolved === path.resolve(os.homedir())) {
    throw new Error(
      "Refusing to open your home directory root — choose a project folder inside it"
    );
  }

  const lower = resolved.toLowerCase();
  const sep = process.platform === "win32" ? "\\" : "/";
  const forbidden = process.platform === "win32" ? WIN_FORBIDDEN_PREFIXES : POSIX_FORBIDDEN_PREFIXES;
  if (forbidden.some((p) => lower === p || lower.startsWith(p + sep))) {
    throw new Error(`Refusing to open a system directory: ${resolved}`);
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(`Folder does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }

  return resolved;
}

export async function createBuildModeProject(
  hostPath: string,
  title?: string
): Promise<Project> {
  await migrateLegacyJson();
  const resolved = await validateBuildModePath(hostPath);

  // Opening the same folder twice reuses the existing project instead of
  // erroring on the workspace UNIQUE constraint
  const existing = projectDb.getAll().find((p) => p.workspace === resolved);
  if (existing) {
    return toProject(existing);
  }

  const id = "proj_" + Math.random().toString(36).substring(2, 11);
  const resolvedTitle = title?.trim() || path.basename(resolved) || "Build Mode Project";

  try {
    // Only add a memory file if this codebase doesn't already have one
    const agentsMdPath = path.join(resolved, "AGENTS.md");
    const hasAgentsMd = await fs.access(agentsMdPath).then(() => true).catch(() => false);
    if (!hasAgentsMd) {
      await fs.writeFile(
        agentsMdPath,
        "# Project conventions\n" +
          "(Opened in Build Mode from an existing folder — update this with the " +
          "project's real conventions as you learn them.)\n",
        "utf8"
      );
    }

    // Reuse an existing git repo; only init if absent — never force an
    // initial commit here, since this may be the user's real, uncommitted work
    const hasGit = await fs.access(path.join(resolved, ".git")).then(() => true).catch(() => false);
    if (!hasGit) {
      await execFileAsync("git", ["init"], { cwd: resolved });
    }
  } catch {
    // Best-effort, same as app-mode creation
  }

  projectDb.create({
    id,
    name: resolvedTitle,
    workspace: resolved,
    description: null,
    kind: "build",
  });

  const row = projectDb.getById(id)!;
  return toProject(row);
}

export async function updateProject(
  id: string,
  updates: Partial<Pick<Project, "title">>
): Promise<Project | null> {
  const row = projectDb.getById(id);
  if (!row) return null;
  if (updates.title) {
    projectDb.update(id, { name: updates.title });
  } else {
    projectDb.touch(id);
  }
  return toProject(projectDb.getById(id)!);
}

export async function deleteProject(id: string): Promise<boolean> {
  const row = projectDb.getById(id);
  if (!row) return false;
  // Cascades to messages, checkpoints, usage_log, tool_log.
  // The workspace folder is kept on disk on purpose (recoverable by hand).
  projectDb.delete(id);
  return true;
}
