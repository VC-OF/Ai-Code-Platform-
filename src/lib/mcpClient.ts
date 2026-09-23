import crossSpawn from "cross-spawn";
import type { ChildProcess } from "child_process";
import fs from "fs/promises";
import path from "path";

/**
 * Minimal MCP (Model Context Protocol) client — stdio transport.
 *
 * Config lives at .platform/mcp.json (override with MCP_CONFIG_PATH):
 *   {
 *     "servers": {
 *       "my-server": { "command": "npx", "args": ["-y", "@some/mcp-server"], "env": {} }
 *     }
 *   }
 *
 * Each server's tools are exposed to the agent as `mcp_<server>_<tool>`.
 * Server names may not contain underscores (they delimit the mangling).
 *
 * Protocol: newline-delimited JSON-RPC 2.0 over the child's stdio —
 * initialize → notifications/initialized → tools/list → tools/call.
 */

const PROTOCOL_VERSION = "2024-11-05";
const INIT_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 30_000;

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpToolInfo {
  server: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ─── Config ──────────────────────────────────────────────────────────────────

function configPath(): string {
  return (
    process.env.MCP_CONFIG_PATH ||
    path.join(process.cwd(), ".platform", "mcp.json")
  );
}

export async function loadMcpConfig(): Promise<Record<string, McpServerConfig>> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    const servers: Record<string, McpServerConfig> = parsed?.servers ?? {};
    // Underscores would break mcp_<server>_<tool> demangling
    for (const name of Object.keys(servers)) {
      if (!/^[a-zA-Z0-9-]+$/.test(name)) {
        console.warn(`[mcp] ignoring server '${name}' — names must be alphanumeric/dashes`);
        delete servers[name];
      }
    }
    return servers;
  } catch {
    return {};
  }
}

// ─── Stdio JSON-RPC client ───────────────────────────────────────────────────

class StdioMcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = "";
  private initialized: Promise<void> | null = null;
  tools: McpToolInfo[] = [];

  constructor(
    public readonly serverName: string,
    private readonly config: McpServerConfig
  ) {}

  get alive(): boolean {
    return !!this.proc && this.proc.exitCode === null;
  }

  private spawnProc(): void {
    const proc = crossSpawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;

    proc.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          this.handleMessage(JSON.parse(line));
        } catch {
          // Non-JSON noise on stdout — ignore
        }
      }
    });

    proc.stderr?.on("data", () => {
      // MCP servers log to stderr; keep quiet unless debugging
    });

    proc.on("exit", () => {
      const err = new Error(`MCP server '${this.serverName}' exited`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.proc = null;
      this.initialized = null;
    });

    proc.on("error", (err) => {
      const wrapped = new Error(
        `MCP server '${this.serverName}' failed to start: ${err.message}`
      );
      for (const { reject } of this.pending.values()) reject(wrapped);
      this.pending.clear();
      this.proc = null;
      this.initialized = null;
    });
  }

  private handleMessage(msg: JsonRpcResponse): void {
    if (msg.id === undefined) return; // notification from server — ignore
    const waiter = this.pending.get(msg.id);
    if (!waiter) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      waiter.reject(new Error(`MCP ${this.serverName}: ${msg.error.message}`));
    } else {
      waiter.resolve(msg.result);
    }
  }

  private send(msg: Record<string, unknown>): void {
    this.proc?.stdin?.write(JSON.stringify(msg) + "\n");
  }

  private request(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number
  ): Promise<unknown> {
    if (!this.alive) {
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
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** Spawn (if needed), handshake, and list tools. Idempotent. */
  ensureInitialized(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = (async () => {
      this.spawnProc();
      await this.request(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "open-code", version: "0.1.0" },
        },
        INIT_TIMEOUT_MS
      );
      this.send({ jsonrpc: "2.0", method: "notifications/initialized" });

      const result = (await this.request("tools/list", {}, INIT_TIMEOUT_MS)) as {
        tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
      };
      this.tools = (result?.tools ?? []).map((t) => ({
        server: this.serverName,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    })();
    this.initialized.catch(() => { this.initialized = null; });
    return this.initialized;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.ensureInitialized();
    const result = (await this.request(
      "tools/call",
      { name, arguments: args },
      CALL_TIMEOUT_MS
    )) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };

    const text = (result?.content ?? [])
      .map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type} content]`))
      .join("\n");

    if (result?.isError) {
      throw new Error(text || `MCP tool '${name}' reported an error`);
    }
    return text || "(empty result)";
  }
}

// ─── Registry ────────────────────────────────────────────────────────────────

const clients = new Map<string, StdioMcpClient>();

async function getClient(serverName: string): Promise<StdioMcpClient | null> {
  const existing = clients.get(serverName);
  if (existing?.alive) return existing;

  const config = (await loadMcpConfig())[serverName];
  if (!config) return null;

  const client = new StdioMcpClient(serverName, config);
  clients.set(serverName, client);
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
  const rest = prefixed.slice(4);
  const sep = rest.indexOf("_");
  if (sep <= 0) return null;
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 1) };
}

/** OpenAI-style tool schemas for every tool on every configured server.
 *  Unreachable servers are skipped with a warning, never fatal. */
export async function getMcpToolSchemas(): Promise<Record<string, unknown>[]> {
  const config = await loadMcpConfig();
  const schemas: Record<string, unknown>[] = [];

  for (const serverName of Object.keys(config)) {
    try {
      const client = await getClient(serverName);
      if (!client) continue;
      await client.ensureInitialized();
      for (const tool of client.tools) {
        schemas.push({
          type: "function",
          function: {
            name: mangleName(serverName, tool.name),
            description:
              `[${serverName} MCP] ${tool.description ?? tool.name}`.slice(0, 1024),
            parameters: tool.inputSchema ?? { type: "object", properties: {} },
          },
        });
      }
    } catch (err) {
      console.warn(`[mcp] server '${serverName}' unavailable:`, err);
    }
  }
  return schemas;
}

export async function callMcpTool(
  prefixedName: string,
  args: Record<string, unknown>
): Promise<string> {
  const parsed = demangleName(prefixedName);
  if (!parsed) throw new Error(`Not an MCP tool name: ${prefixedName}`);
  const client = await getClient(parsed.server);
  if (!client) {
    throw new Error(`MCP server '${parsed.server}' is not configured`);
  }
  return client.callTool(parsed.tool, args);
}

/** Status for the settings UI. */
export async function getMcpStatus(): Promise<
  { server: string; connected: boolean; tools: string[]; error?: string }[]
> {
  const config = await loadMcpConfig();
  const out: { server: string; connected: boolean; tools: string[]; error?: string }[] = [];

  for (const serverName of Object.keys(config)) {
    try {
      const client = await getClient(serverName);
      if (!client) continue;
      await client.ensureInitialized();
      out.push({
        server: serverName,
        connected: true,
        tools: client.tools.map((t) => t.name),
      });
    } catch (err) {
      out.push({
        server: serverName,
        connected: false,
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
