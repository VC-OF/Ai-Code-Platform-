import fs from "fs/promises";
import path from "path";
import { getDecryptedEnv } from "./settingsStore";
import {
  createTransport,
  type JsonRpcMessage,
  type McpTransport,
  type McpTransportKind,
} from "./mcpTransports";

/**
 * Minimal MCP (Model Context Protocol) client.
 *
 * Platform config lives at .platform/mcp.json (override with MCP_CONFIG_PATH):
 *   {
 *     "servers": {
 *       "local":  { "command": "npx", "args": ["-y", "@some/mcp-server"], "env": {} },
 *       "remote": { "type": "http", "url": "https://example.com/mcp",
 *                   "headers": { "Authorization": "Bearer ${EXAMPLE_TOKEN}" } },
 *       "legacy": { "type": "sse", "url": "https://example.com/sse" }
 *     }
 *   }
 * A project workspace's Claude Code `.mcp.json` ({"mcpServers": {…}}, same
 * entry shapes) is merged on top — project entries win on a name clash.
 * `${VAR}` / `${VAR:-default}` in urls, headers, args and env resolve from
 * process.env and the encrypted Settings vars (Settings win).
 *
 * Each server's tools are exposed to the agent as `mcp_<server>_<tool>`.
 * Server names may not contain underscores (they delimit the mangling).
 * Servers advertising resources add `mcp_list_resources` / `mcp_read_resource`;
 * prompts become `/mcp__<server>__<prompt>` slash commands in the chat.
 *
 * Protocol: JSON-RPC 2.0 over a transport (stdio | Streamable HTTP | legacy
 * SSE) — initialize → notifications/initialized → tools/list (+
 * resources/list, prompts/list when advertised) → tools/call etc.
 */

const PROTOCOL_VERSION = "2024-11-05";
const HTTP_PROTOCOL_VERSION = "2025-03-26";
const INIT_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 30_000;
const MAX_LIST_PAGES = 10;

export interface McpStdioConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpRemoteConfig {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioConfig | McpRemoteConfig;

function isRemote(config: McpServerConfig): config is McpRemoteConfig {
  return config.type === "http" || config.type === "sse";
}

export interface McpToolInfo {
  server: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResourceInfo {
  server: string;
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptInfo {
  server: string;
  name: string;
  description?: string;
  arguments: McpPromptArgument[];
}

// ─── Config ──────────────────────────────────────────────────────────────────

function configPath(): string {
  return (
    process.env.MCP_CONFIG_PATH ||
    path.join(process.cwd(), ".platform", "mcp.json")
  );
}

/** Names that would collide with the built-in resource tools' mangling. */
const RESERVED_SERVER_NAMES = new Set(["list", "read"]);

function normalizeEntry(name: string, raw: unknown): McpServerConfig | null {
  if (!/^[a-zA-Z0-9-]+$/.test(name) || RESERVED_SERVER_NAMES.has(name)) {
    console.warn(`[mcp] ignoring server '${name}' — names must be alphanumeric/dashes`);
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const type = typeof e.type === "string" ? e.type : undefined;
  const headers =
    e.headers && typeof e.headers === "object" ? (e.headers as Record<string, string>) : undefined;
  if (type === "http" || type === "streamable-http" || type === "sse") {
    if (typeof e.url !== "string" || !e.url) {
      console.warn(`[mcp] ignoring server '${name}' — ${type} entries need a url`);
      return null;
    }
    return { type: type === "sse" ? "sse" : "http", url: e.url, headers };
  }
  if (type && type !== "stdio") {
    console.warn(`[mcp] ignoring server '${name}' — unknown transport '${type}'`);
    return null;
  }
  if (typeof e.command !== "string" || !e.command) return null;
  return {
    command: e.command,
    args: Array.isArray(e.args) ? e.args.map(String) : undefined,
    env: e.env && typeof e.env === "object" ? (e.env as Record<string, string>) : undefined,
  };
}

async function readServers(file: string, key: string): Promise<Record<string, McpServerConfig>> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    const raw = parsed?.[key];
    const out: Record<string, McpServerConfig> = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
      const cfg = normalizeEntry(name, entry);
      if (cfg) out[name] = cfg;
    }
    return out;
  } catch {
    return {};
  }
}

/** Where each server came from, for /mcp. */
export type McpConfigSource = "platform" | "project" | "plugin";

/** Platform config merged with the workspace's `.mcp.json` (project wins). */
/**
 * Stdio servers from installed plugins' `.mcp.json`, named
 * `<plugin>-<server>`. `${CLAUDE_PLUGIN_ROOT}` in command/args/env is
 * replaced with the plugin folder (Claude Code convention).
 */
export async function loadPluginMcpServers(): Promise<Record<string, McpServerConfig>> {
  const { pluginRoots, readPluginMcpServers } = await import("./plugins");
  const out: Record<string, McpServerConfig> = {};
  for (const plugin of await pluginRoots()) {
    const sub = (s: string) => s.split("${CLAUDE_PLUGIN_ROOT}").join(plugin.root);
    for (const [server, cfg] of Object.entries(await readPluginMcpServers(plugin.root))) {
      if (!cfg || typeof cfg.command !== "string") continue; // stdio only
      const name = `${plugin.name}-${server}`.replace(/[^a-zA-Z0-9-]+/g, "-");
      if (RESERVED_SERVER_NAMES.has(name)) continue;
      const env: Record<string, string> = {};
      if (cfg.env && typeof cfg.env === "object") {
        for (const [k, v] of Object.entries(cfg.env as Record<string, unknown>)) env[k] = sub(String(v));
      }
      out[name] = {
        command: sub(cfg.command),
        args: Array.isArray(cfg.args) ? cfg.args.map((a) => sub(String(a))) : [],
        env,
      };
    }
  }
  return out;
}

/**
 * Which project `.mcp.json` servers the user approved. A cloned repo's
 * `.mcp.json` can name any command, so — as in Claude Code — its servers
 * only start once approved in `.claude/settings.json` or
 * `.claude/settings.local.json`: `"enableAllProjectMcpServers": true` or
 * `"enabledMcpjsonServers": ["name", …]` (`"disabledMcpjsonServers"` wins).
 */
export async function projectMcpApproval(
  workspace: string
): Promise<{ all: boolean; enabled: Set<string>; disabled: Set<string> }> {
  const res = { all: false, enabled: new Set<string>(), disabled: new Set<string>() };
  for (const rel of [".claude/settings.json", ".claude/settings.local.json"]) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(workspace, rel), "utf8")) as Record<string, unknown>;
      if (j.enableAllProjectMcpServers === true) res.all = true;
      for (const n of Array.isArray(j.enabledMcpjsonServers) ? j.enabledMcpjsonServers : []) res.enabled.add(String(n));
      for (const n of Array.isArray(j.disabledMcpjsonServers) ? j.disabledMcpjsonServers : []) res.disabled.add(String(n));
    } catch {
      // missing or invalid settings: nothing approved from this file
    }
  }
  return res;
}

/** Project servers found in `.mcp.json` but not yet approved (shown by /mcp). */
export async function pendingProjectMcpServers(workspace: string): Promise<string[]> {
  const project = await readServers(path.join(workspace, ".mcp.json"), "mcpServers");
  const approval = await projectMcpApproval(workspace);
  return Object.keys(project).filter((n) => approval.disabled.has(n) || !(approval.all || approval.enabled.has(n)));
}

export async function loadMcpConfigWithSources(
  workspace?: string
): Promise<Record<string, { config: McpServerConfig; source: McpConfigSource }>> {
  const out: Record<string, { config: McpServerConfig; source: McpConfigSource }> = {};
  // Plugin servers first: an explicit platform or project entry with the same name wins
  for (const [name, config] of Object.entries(await loadPluginMcpServers().catch(() => ({})))) {
    out[name] = { config, source: "plugin" };
  }
  for (const [name, config] of Object.entries(await readServers(configPath(), "servers"))) {
    out[name] = { config, source: "platform" };
  }
  if (workspace) {
    const project = await readServers(path.join(workspace, ".mcp.json"), "mcpServers");
    const approval = await projectMcpApproval(workspace);
    for (const [name, config] of Object.entries(project)) {
      if (approval.disabled.has(name) || !(approval.all || approval.enabled.has(name))) continue;
      out[name] = { config, source: "project" };
    }
  }
  return out;
}

export async function loadMcpConfig(workspace?: string): Promise<Record<string, McpServerConfig>> {
  const withSources = await loadMcpConfigWithSources(workspace);
  return Object.fromEntries(Object.entries(withSources).map(([k, v]) => [k, v.config]));
}

/** `${VAR}` / `${VAR:-default}` substitution. Unknown vars become "". */
export function substituteEnv(value: string, vars: Record<string, string | undefined>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name: string, def?: string) => {
    const v = vars[name];
    if (v !== undefined && v !== "") return v;
    return def ?? "";
  });
}

function projectIdFromWorkspace(workspace?: string): string | undefined {
  if (!workspace) return undefined;
  const id = path.basename(workspace);
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : undefined;
}

async function resolveConfig(config: McpServerConfig, workspace?: string): Promise<McpServerConfig> {
  const secrets = await getDecryptedEnv(projectIdFromWorkspace(workspace)).catch(
    () => ({} as Record<string, string>)
  );
  const vars: Record<string, string | undefined> = { ...process.env, ...secrets };
  const sub = (v: string) => substituteEnv(v, vars);
  const subMap = (m?: Record<string, string>) =>
    m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, sub(String(v))])) : undefined;
  if (isRemote(config)) {
    return { type: config.type, url: sub(config.url), headers: subMap(config.headers) };
  }
  return {
    command: sub(config.command),
    args: config.args?.map(sub),
    env: subMap(config.env),
  };
}

/** A URL safe to show: no credentials, query string or fragment. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

// ─── JSON-RPC client (transport-agnostic) ────────────────────────────────────

interface ServerCapabilities {
  tools?: unknown;
  resources?: unknown;
  prompts?: unknown;
}

type ContentPart = {
  type: string;
  text?: string;
  resource?: { uri?: string; text?: string; mimeType?: string };
};

function contentToText(parts: ContentPart[] | undefined): string {
  return (parts ?? [])
    .map((c) => {
      if (c.type === "text") return c.text ?? "";
      if (c.type === "resource" && c.resource?.text !== undefined) return c.resource.text;
      return `[${c.type} content]`;
    })
    .join("\n");
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

class McpClient {
  private transport: McpTransport | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private initialized: Promise<void> | null = null;
  tools: McpToolInfo[] = [];
  resources: McpResourceInfo[] = [];
  prompts: McpPromptInfo[] = [];
  capabilities: ServerCapabilities = {};

  constructor(
    public readonly serverName: string,
    public readonly config: McpServerConfig,
    private readonly workspace?: string
  ) {}

  get kind(): McpTransportKind {
    return transportKind(this.config);
  }

  get alive(): boolean {
    // Not started yet counts as healthy — ensureInitialized() will connect
    return !this.transport || this.transport.alive;
  }

  private failAll(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.id === undefined || msg.method) return; // notification/request from server — ignore
    const waiter = this.pending.get(Number(msg.id));
    if (!waiter) return;
    this.pending.delete(Number(msg.id));
    if (msg.error) {
      waiter.reject(new Error(`MCP ${this.serverName}: ${msg.error.message}`));
    } else {
      waiter.resolve(msg.result);
    }
  }

  private notify(method: string): void {
    this.transport?.send({ jsonrpc: "2.0", method }).catch(() => {});
  }

  private request(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number
  ): Promise<unknown> {
    const transport = this.transport;
    if (!transport?.alive) {
      return Promise.reject(new Error(`MCP server '${this.serverName}' is not running`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${this.serverName}: '${method}' timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      transport.send({ jsonrpc: "2.0", id, method, params }).catch((err: unknown) => {
        const waiter = this.pending.get(id);
        if (!waiter) return;
        this.pending.delete(id);
        waiter.reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /** Paginated list call (tools/list, resources/list, prompts/list). */
  private async listAll<T>(method: string, key: string): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const result = (await this.request(method, cursor ? { cursor } : {}, INIT_TIMEOUT_MS)) as
        Record<string, unknown> | undefined;
      out.push(...((result?.[key] as T[] | undefined) ?? []));
      cursor = typeof result?.nextCursor === "string" ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    return out;
  }

  /** Connect (if needed), handshake, and list tools/resources/prompts. Idempotent. */
  ensureInitialized(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = (async () => {
      const resolved = await resolveConfig(this.config, this.workspace);
      const transport = createTransport(this.serverName, resolved);
      this.transport = transport;
      transport.onmessage = (msg) => this.handleMessage(msg);
      transport.onclose = (err) => {
        if (this.transport !== transport) return;
        this.failAll(err);
        this.initialized = null;
      };
      await withTimeout(
        transport.start(),
        INIT_TIMEOUT_MS,
        `MCP ${this.serverName}: connection timed out`
      );

      const init = (await this.request(
        "initialize",
        {
          protocolVersion: transport.kind === "http" ? HTTP_PROTOCOL_VERSION : PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "open-code", version: "0.1.0" },
        },
        INIT_TIMEOUT_MS
      )) as { protocolVersion?: string; capabilities?: ServerCapabilities } | undefined;
      this.capabilities = init?.capabilities ?? {};
      transport.setProtocolVersion(init?.protocolVersion ?? HTTP_PROTOCOL_VERSION);
      this.notify("notifications/initialized");

      // Servers that don't advertise tools may still answer tools/list
      try {
        const tools = await this.listAll<{
          name: string; description?: string; inputSchema?: Record<string, unknown>;
        }>("tools/list", "tools");
        this.tools = tools.map((t) => ({
          server: this.serverName,
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      } catch (err) {
        if (this.capabilities.tools) throw err;
        this.tools = [];
      }

      this.resources = [];
      if (this.capabilities.resources) {
        const resources = await this.listAll<Omit<McpResourceInfo, "server">>(
          "resources/list", "resources"
        ).catch(() => []);
        this.resources = resources.map((r) => ({ ...r, server: this.serverName }));
      }

      this.prompts = [];
      if (this.capabilities.prompts) {
        const prompts = await this.listAll<Omit<McpPromptInfo, "server">>(
          "prompts/list", "prompts"
        ).catch(() => []);
        this.prompts = prompts.map((p) => ({
          server: this.serverName,
          name: p.name,
          description: p.description,
          arguments: Array.isArray(p.arguments) ? p.arguments : [],
        }));
      }
    })();
    this.initialized.catch(() => {
      this.initialized = null;
      // A server that failed the handshake (e.g. timed out) may still be
      // running; close it so the next attempt doesn't leak another process
      this.close();
    });
    return this.initialized;
  }

  close(): void {
    const t = this.transport;
    this.transport = null;
    this.initialized = null;
    t?.close();
    this.failAll(new Error(`MCP server '${this.serverName}' closed`));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.ensureInitialized();
    const result = (await this.request(
      "tools/call",
      { name, arguments: args },
      CALL_TIMEOUT_MS
    )) as { content?: ContentPart[]; isError?: boolean };

    const text = contentToText(result?.content);
    if (result?.isError) {
      throw new Error(text || `MCP tool '${name}' reported an error`);
    }
    return text || "(empty result)";
  }

  async readResource(uri: string): Promise<string> {
    await this.ensureInitialized();
    const result = (await this.request("resources/read", { uri }, CALL_TIMEOUT_MS)) as {
      contents?: { uri?: string; mimeType?: string; text?: string; blob?: string }[];
    };
    const text = (result?.contents ?? [])
      .map((c) =>
        c.text !== undefined
          ? c.text
          : `[binary ${c.mimeType ?? "content"}, ${Math.floor(((c.blob ?? "").length * 3) / 4)} bytes]`
      )
      .join("\n\n");
    return text || "(empty resource)";
  }

  async getPrompt(name: string, args: Record<string, string>): Promise<string> {
    await this.ensureInitialized();
    const result = (await this.request(
      "prompts/get",
      { name, arguments: args },
      CALL_TIMEOUT_MS
    )) as { messages?: { role: string; content: ContentPart | ContentPart[] }[] };
    return (result?.messages ?? [])
      .map((m) => {
        const text = contentToText(Array.isArray(m.content) ? m.content : [m.content]);
        return m.role === "user" ? text : `[${m.role}]\n${text}`;
      })
      .filter((t) => t.trim())
      .join("\n\n");
  }
}

function transportKind(config: McpServerConfig): McpTransportKind {
  return config.type === "http" || config.type === "sse" ? config.type : "stdio";
}

// ─── Registry ────────────────────────────────────────────────────────────────

const gm = globalThis as unknown as { __ocMcpClients?: Map<string, McpClient> };
const clients = (gm.__ocMcpClients ??= new Map<string, McpClient>());

/** One client per (server name, config, workspace) — two projects may define
 *  the same name differently in their .mcp.json. Platform servers are shared. */
function clientKey(serverName: string, config: McpServerConfig, source: McpConfigSource, workspace?: string): string {
  return `${serverName}\0${JSON.stringify(config)}\0${source === "project" ? workspace ?? "" : ""}`;
}

async function getClient(serverName: string, workspace?: string): Promise<McpClient | null> {
  const entry = (await loadMcpConfigWithSources(workspace))[serverName];
  if (!entry) return null;
  const key = clientKey(serverName, entry.config, entry.source, workspace);
  const existing = clients.get(key);
  if (existing?.alive) return existing;
  existing?.close();

  // Secrets for ${VAR} substitution are scoped to the configuring project
  const client = new McpClient(serverName, entry.config, workspace);
  clients.set(key, client);
  return client;
}

/** Tool name mangling: mcp_<server>_<tool>. Server names contain no '_'. */
export function mangleName(server: string, tool: string): string {
  return `mcp_${server}_${tool}`;
}

export function demangleName(
  prefixed: string
): { server: string; tool: string } | null {
  if (!prefixed.startsWith("mcp_")) return null;
  if (isMcpResourceTool(prefixed)) return null;
  const rest = prefixed.slice(4);
  const sep = rest.indexOf("_");
  if (sep <= 0) return null;
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 1) };
}

/** Built-in agent tools over MCP resources (read-only). */
export const MCP_RESOURCE_TOOLS = ["mcp_list_resources", "mcp_read_resource"] as const;

export function isMcpResourceTool(name: string): boolean {
  return (MCP_RESOURCE_TOOLS as readonly string[]).includes(name);
}

const MCP_RESOURCE_TOOL_SCHEMAS: Record<string, unknown>[] = [
  {
    type: "function",
    function: {
      name: "mcp_list_resources",
      description:
        "List resources (documents, files, records) exposed by connected MCP servers. Returns each resource's server, URI, name and MIME type. Read one with mcp_read_resource.",
      parameters: {
        type: "object",
        properties: {
          server: { type: "string", description: "Only list this server's resources" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mcp_read_resource",
      description: "Read one MCP resource by server name and URI (from mcp_list_resources).",
      parameters: {
        type: "object",
        properties: {
          server: { type: "string", description: "MCP server name" },
          uri: { type: "string", description: "Resource URI" },
        },
        required: ["server", "uri"],
      },
    },
  },
];

/** Connect every configured server; unreachable ones are skipped with a warning. */
async function connectedClients(workspace?: string): Promise<McpClient[]> {
  const config = await loadMcpConfig(workspace);
  const out: McpClient[] = [];
  for (const serverName of Object.keys(config)) {
    try {
      const client = await getClient(serverName, workspace);
      if (!client) continue;
      await client.ensureInitialized();
      out.push(client);
    } catch (err) {
      console.warn(`[mcp] server '${serverName}' unavailable:`, err);
    }
  }
  return out;
}

/** OpenAI-style tool schemas for every tool on every configured server,
 *  plus the resource tools when any server exposes resources. */
export async function getMcpToolSchemas(workspace?: string): Promise<Record<string, unknown>[]> {
  const schemas: Record<string, unknown>[] = [];
  let anyResources = false;
  for (const client of await connectedClients(workspace)) {
    if (client.capabilities.resources) anyResources = true;
    for (const tool of client.tools) {
      schemas.push({
        type: "function",
        function: {
          name: mangleName(client.serverName, tool.name),
          description:
            `[${client.serverName} MCP] ${tool.description ?? tool.name}`.slice(0, 1024),
          parameters: tool.inputSchema ?? { type: "object", properties: {} },
        },
      });
    }
  }
  if (anyResources) schemas.push(...MCP_RESOURCE_TOOL_SCHEMAS);
  return schemas;
}

export async function callMcpTool(
  prefixedName: string,
  args: Record<string, unknown>,
  workspace?: string
): Promise<string> {
  const parsed = demangleName(prefixedName);
  if (!parsed) throw new Error(`Not an MCP tool name: ${prefixedName}`);
  const client = await getClient(parsed.server, workspace);
  if (!client) {
    throw new Error(`MCP server '${parsed.server}' is not configured`);
  }
  return client.callTool(parsed.tool, args);
}

async function requireClient(server: string, workspace?: string): Promise<McpClient> {
  const client = await getClient(server, workspace);
  if (!client) throw new Error(`MCP server '${server}' is not configured`);
  await client.ensureInitialized();
  return client;
}

export async function listMcpResources(workspace?: string, server?: string): Promise<McpResourceInfo[]> {
  const list = server ? [await requireClient(server, workspace)] : await connectedClients(workspace);
  return list.flatMap((c) => c.resources);
}

export async function readMcpResource(server: string, uri: string, workspace?: string): Promise<string> {
  return (await requireClient(server, workspace)).readResource(uri);
}

export async function listMcpPrompts(workspace?: string): Promise<McpPromptInfo[]> {
  return (await connectedClients(workspace)).flatMap((c) => c.prompts);
}

/** prompts/get flattened to plain text (the chat sends it as the user message). */
export async function getMcpPrompt(
  server: string,
  name: string,
  args: Record<string, string>,
  workspace?: string
): Promise<string> {
  return (await requireClient(server, workspace)).getPrompt(name, args);
}

/** Built-in resource tools, dispatched from executeTool. */
export async function executeMcpResourceTool(
  name: string,
  args: Record<string, unknown>,
  workspace?: string
): Promise<string> {
  if (name === "mcp_read_resource") {
    return readMcpResource(String(args.server ?? ""), String(args.uri ?? ""), workspace);
  }
  const server = typeof args.server === "string" && args.server ? args.server : undefined;
  const resources = await listMcpResources(workspace, server);
  if (resources.length === 0) return "No MCP resources available.";
  return resources
    .map((r) =>
      `- [${r.server}] ${r.uri}${r.name ? ` — ${r.name}` : ""}${r.mimeType ? ` (${r.mimeType})` : ""}${r.description ? `: ${r.description}` : ""}`
    )
    .join("\n");
}

export interface McpServerStatus {
  server: string;
  type: McpTransportKind;
  /** Redacted (no credentials/query) for http/sse; the command for stdio */
  target: string;
  source: McpConfigSource;
  connected: boolean;
  tools: string[];
  resources: number;
  prompts: Omit<McpPromptInfo, "server">[];
  error?: string;
}

/** Status for the settings UI and /mcp. */
export async function getMcpStatus(workspace?: string): Promise<McpServerStatus[]> {
  const config = await loadMcpConfigWithSources(workspace);
  const out: McpServerStatus[] = [];

  for (const [serverName, { config: cfg, source }] of Object.entries(config)) {
    const base = {
      server: serverName,
      type: transportKind(cfg),
      target: isRemote(cfg) ? redactUrl(cfg.url) : cfg.command,
      source,
    };
    try {
      const client = await getClient(serverName, workspace);
      if (!client) continue;
      await client.ensureInitialized();
      out.push({
        ...base,
        connected: true,
        tools: client.tools.map((t) => t.name),
        resources: client.resources.length,
        prompts: client.prompts.map(({ name, description, arguments: a }) => ({ name, description, arguments: a })),
      });
    } catch (err) {
      out.push({
        ...base,
        connected: false,
        tools: [],
        resources: 0,
        prompts: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
