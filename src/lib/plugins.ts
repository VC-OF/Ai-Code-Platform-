import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Plugins, Claude Code layout: a folder under `.platform/plugins/<name>/`
 * (override with OPEN_CODE_PLUGINS_DIR) that may contain
 *   skills/<skill>/SKILL.md   → skills listed as `<plugin>:<skill>`
 *   commands/<cmd>.md         → slash commands `/<plugin>:<cmd>`
 *   agents/<agent>.md         → agent definitions (listed for reference)
 *   .mcp.json                 → MCP servers, exposed as `<plugin>-<server>`
 *   hooks/hooks.json          → listed; not executed automatically
 *
 * Installed with `/plugin install <https git url | local dir>` (git clone
 * --depth 1 via execFile — no shell) or by copying a local directory.
 */

export const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const HTTPS_GIT_RE = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?\/[\w./~%-]+$/i;
const CLONE_TIMEOUT_MS = 120_000;

export function pluginsDir(): string {
  return process.env.OPEN_CODE_PLUGINS_DIR || path.join(process.cwd(), ".platform", "plugins");
}

export interface PluginInfo {
  name: string;
  path: string;
  description?: string;
  version?: string;
  skills: string[];
  commands: string[];
  agents: string[];
  mcpServers: string[];
  hasHooks: boolean;
}

export function isValidPluginName(name: string): boolean {
  return PLUGIN_NAME_RE.test(name) && name !== "." && name !== "..";
}

export function isHttpsGitUrl(source: string): boolean {
  return HTTPS_GIT_RE.test(source) && !source.includes("..");
}

/** Default plugin name for a source: last path segment without `.git`. */
export function pluginNameFromSource(source: string): string {
  const trimmed = source.trim().replace(/[\\/]+$/, "");
  const last = trimmed.split(/[\\/]/).pop() ?? "";
  return last.replace(/\.git$/i, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function listNames(dir: string, filter: (e: { name: string; isDirectory(): boolean }) => boolean): Promise<string[]> {
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    return ents.filter(filter).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Servers declared in a plugin's .mcp.json (`mcpServers` or `servers`). */
export async function readPluginMcpServers(pluginPath: string): Promise<Record<string, Record<string, unknown>>> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(pluginPath, ".mcp.json"), "utf8"));
    const servers = parsed?.mcpServers ?? parsed?.servers ?? {};
    return servers && typeof servers === "object" ? servers : {};
  } catch {
    return {};
  }
}

export async function describePlugin(name: string): Promise<PluginInfo | null> {
  if (!isValidPluginName(name)) return null;
  const root = path.join(pluginsDir(), name);
  try {
    if (!(await fs.stat(root)).isDirectory()) return null;
  } catch {
    return null;
  }
  let meta: { description?: string; version?: string } = {};
  try {
    meta = JSON.parse(await fs.readFile(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
  } catch {}
  const md = (e: { name: string; isDirectory(): boolean }) => !e.isDirectory() && e.name.endsWith(".md");
  return {
    name,
    path: root,
    description: typeof meta.description === "string" ? meta.description : undefined,
    version: typeof meta.version === "string" ? meta.version : undefined,
    skills: await listNames(path.join(root, "skills"), (e) => e.isDirectory()),
    commands: (await listNames(path.join(root, "commands"), md)).map((n) => n.slice(0, -3)),
    agents: (await listNames(path.join(root, "agents"), md)).map((n) => n.slice(0, -3)),
    mcpServers: Object.keys(await readPluginMcpServers(root)),
    hasHooks: await exists(path.join(root, "hooks", "hooks.json")),
  };
}

export async function listPlugins(): Promise<PluginInfo[]> {
  const names = await listNames(pluginsDir(), (e) => e.isDirectory() && isValidPluginName(e.name));
  const out: PluginInfo[] = [];
  for (const n of names) {
    const info = await describePlugin(n);
    if (info) out.push(info);
  }
  return out;
}

function isEmptyPlugin(p: PluginInfo): boolean {
  return !p.skills.length && !p.commands.length && !p.agents.length && !p.mcpServers.length && !p.hasHooks;
}

/**
 * Install from an https git URL (shallow clone) or an existing local
 * directory (copied). Refuses to overwrite an installed plugin.
 */
export async function installPlugin(source: string, name?: string): Promise<PluginInfo> {
  const src = source.trim();
  if (!src) throw new Error("Plugin source is required (an https git URL or a local directory).");
  const pluginName = (name?.trim() || pluginNameFromSource(src));
  if (!isValidPluginName(pluginName)) {
    throw new Error(`Invalid plugin name '${pluginName}' — use letters, numbers, '-' or '_' (max 64).`);
  }
  const dest = path.join(pluginsDir(), pluginName);
  if (await exists(dest)) {
    throw new Error(`Plugin '${pluginName}' is already installed. Remove it first with /plugin remove ${pluginName}.`);
  }
  await fs.mkdir(pluginsDir(), { recursive: true });

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src) || /^git@/i.test(src)) {
    if (!isHttpsGitUrl(src)) throw new Error("Only https:// git URLs are allowed for plugins.");
    try {
      await execFileAsync("git", ["clone", "--depth", "1", "--", src, dest], {
        timeout: CLONE_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch (err) {
      await fs.rm(dest, { recursive: true, force: true });
      const msg = (err as { stderr?: string }).stderr || (err instanceof Error ? err.message : String(err));
      throw new Error(`git clone failed: ${String(msg).trim().slice(0, 500)}`);
    }
  } else {
    const abs = path.resolve(src);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      throw new Error(`Local plugin directory not found: ${src}`);
    }
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${src}`);
    const rel = path.relative(abs, dest);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      throw new Error("Cannot install a plugin from a directory that contains the plugins folder.");
    }
    await fs.cp(abs, dest, {
      recursive: true,
      filter: (p) => path.basename(p) !== ".git" && path.basename(p) !== "node_modules",
    });
  }

  const info = await describePlugin(pluginName);
  if (!info || isEmptyPlugin(info)) {
    await fs.rm(dest, { recursive: true, force: true });
    throw new Error(
      "Not a plugin: expected skills/*/SKILL.md, commands/*.md, agents/*.md, .mcp.json or hooks/hooks.json."
    );
  }
  return info;
}

export async function removePlugin(name: string): Promise<boolean> {
  if (!isValidPluginName(name)) throw new Error(`Invalid plugin name '${name}'.`);
  const dest = path.join(pluginsDir(), name);
  if (!(await exists(dest))) return false;
  await fs.rm(dest, { recursive: true, force: true });
  return true;
}

/** Installed plugin roots (name + absolute path) for the skill/command/MCP loaders. */
export async function pluginRoots(): Promise<{ name: string; root: string }[]> {
  const names = await listNames(pluginsDir(), (e) => e.isDirectory() && isValidPluginName(e.name));
  return names.map((name) => ({ name, root: path.join(pluginsDir(), name) }));
}
