import crossSpawn from "cross-spawn";
import type { ChildProcess } from "child_process";

/**
 * MCP transports: how JSON-RPC messages reach a server.
 *
 * - stdio: newline-delimited JSON over a child process's stdin/stdout
 * - http:  Streamable HTTP — every message is a POST; the reply is either a
 *          JSON body or an SSE stream of JSON-RPC messages. The server may
 *          assign an Mcp-Session-Id which is echoed on every later request.
 * - sse:   legacy HTTP+SSE — a long-lived GET event stream whose `endpoint`
 *          event names the POST URL; replies arrive as `message` events.
 *
 * Transports only move messages; request ids, timeouts and the handshake
 * live in McpClient.
 */

export type McpTransportKind = "stdio" | "http" | "sse";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpTransport {
  readonly kind: McpTransportKind;
  /** False once the process exited / stream closed / close() was called */
  readonly alive: boolean;
  /** Called for every message the server sends */
  onmessage?: (msg: JsonRpcMessage) => void;
  /** Called once when the connection is lost; pending requests fail */
  onclose?: (err: Error) => void;
  start(): Promise<void>;
  /** Resolves once the message is handed off; rejects if delivery failed */
  send(msg: JsonRpcMessage): Promise<void>;
  /** Negotiated protocol version (sent as a header by HTTP transports) */
  setProtocolVersion(version: string): void;
  close(): void;
}

export interface TransportConfig {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export function createTransport(serverName: string, config: TransportConfig): McpTransport {
  if (config.type === "http") return new StreamableHttpTransport(serverName, config.url!, config.headers);
  if (config.type === "sse") return new LegacySseTransport(serverName, config.url!, config.headers);
  return new StdioTransport(serverName, config.command!, config.args ?? [], config.env);
}

// ─── stdio ───────────────────────────────────────────────────────────────────

class StdioTransport implements McpTransport {
  readonly kind = "stdio" as const;
  onmessage?: (msg: JsonRpcMessage) => void;
  onclose?: (err: Error) => void;
  private proc: ChildProcess | null = null;
  private buffer = "";

  constructor(
    private readonly serverName: string,
    private readonly command: string,
    private readonly args: string[],
    private readonly env?: Record<string, string>
  ) {}

  get alive(): boolean {
    return !!this.proc && this.proc.exitCode === null;
  }

  async start(): Promise<void> {
    const proc = crossSpawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;

    // Writing to a server that already died emits EPIPE on stdin; without a
    // listener that is an uncaught 'error' event that crashes the process
    proc.stdin?.on("error", () => {});

    proc.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          this.onmessage?.(JSON.parse(line));
        } catch {
          // Non-JSON noise on stdout — ignore
        }
      }
    });

    proc.stderr?.on("data", () => {
      // MCP servers log to stderr; keep quiet unless debugging
    });

    proc.on("exit", () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.onclose?.(new Error(`MCP server '${this.serverName}' exited`));
    });

    proc.on("error", (err) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.onclose?.(new Error(`MCP server '${this.serverName}' failed to start: ${err.message}`));
    });
  }

  async send(msg: JsonRpcMessage): Promise<void> {
    this.proc?.stdin?.write(JSON.stringify(msg) + "\n");
  }

  setProtocolVersion(): void {}

  close(): void {
    try { this.proc?.kill(); } catch {}
    this.proc = null;
  }
}

// ─── Server-sent events ──────────────────────────────────────────────────────

/** Parse an SSE byte stream, calling onEvent(event, data) per dispatched event. */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  const dispatch = () => {
    if (data.length) onEvent(event || "message", data.join("\n"));
    event = "";
    data = [];
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + (buffer[idx] === "\r" ? 2 : 1));
      if (line === "") { dispatch(); continue; }
      if (line.startsWith(":")) continue; // comment / keep-alive
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let val = colon < 0 ? "" : line.slice(colon + 1);
      if (val.startsWith(" ")) val = val.slice(1);
      if (field === "event") event = val;
      else if (field === "data") data.push(val);
    }
  }
  dispatch();
}

function parseMessages(text: string): JsonRpcMessage[] {
  const parsed = JSON.parse(text) as JsonRpcMessage | JsonRpcMessage[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function httpError(serverName: string, res: Response): Promise<Error> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  return new Error(`MCP ${serverName}: HTTP ${res.status}${body ? ` — ${body}` : ""}`);
}

// ─── Streamable HTTP ─────────────────────────────────────────────────────────

class StreamableHttpTransport implements McpTransport {
  readonly kind = "http" as const;
  onmessage?: (msg: JsonRpcMessage) => void;
  onclose?: (err: Error) => void;
  private closed = false;
  private sessionId?: string;
  private protocolVersion?: string;

  constructor(
    private readonly serverName: string,
    private readonly url: string,
    private readonly headers: Record<string, string> = {}
  ) {}

  get alive(): boolean {
    return !this.closed;
  }

  async start(): Promise<void> {}

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  private requestHeaders(): Record<string, string> {
    const h: Record<string, string> = { ...this.headers };
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    if (this.protocolVersion) h["MCP-Protocol-Version"] = this.protocolVersion;
    return h;
  }

  async send(msg: JsonRpcMessage): Promise<void> {
    if (this.closed) throw new Error(`MCP server '${this.serverName}' is closed`);
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        ...this.requestHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(msg),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (!res.ok) {
      // 404 on a known session means the server dropped it: reconnect next time
      if (res.status === 404 && this.sessionId) this.close();
      throw await httpError(this.serverName, res);
    }
    if (res.status === 202 || msg.id === undefined) {
      await res.body?.cancel().catch(() => {});
      return;
    }
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream") && res.body) {
      // Replies (and any server notifications) stream in; don't block send()
      // on the stream so the caller's timeout keeps governing the request
      readSseStream(res.body, (_event, data) => {
        try {
          for (const m of parseMessages(data)) this.onmessage?.(m);
        } catch {}
      }).catch(() => {});
      return;
    }
    const text = await res.text();
    if (!text.trim()) return;
    for (const m of parseMessages(text)) this.onmessage?.(m);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.sessionId) {
      // Best effort: tell the server the session is over
      fetch(this.url, { method: "DELETE", headers: this.requestHeaders() }).catch(() => {});
    }
  }
}

// ─── Legacy HTTP+SSE ─────────────────────────────────────────────────────────

class LegacySseTransport implements McpTransport {
  readonly kind = "sse" as const;
  onmessage?: (msg: JsonRpcMessage) => void;
  onclose?: (err: Error) => void;
  private abort: AbortController | null = null;
  private endpoint?: string;
  private open = false;

  constructor(
    private readonly serverName: string,
    private readonly url: string,
    private readonly headers: Record<string, string> = {}
  ) {}

  get alive(): boolean {
    return this.open;
  }

  setProtocolVersion(): void {}

  start(): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const lost = (err: Error) => {
        const wasOpen = this.open;
        this.open = false;
        if (!settled) { settled = true; reject(err); }
        else if (wasOpen) this.onclose?.(err);
      };
      fetch(this.url, {
        headers: { ...this.headers, Accept: "text/event-stream" },
        signal: abort.signal,
      })
        .then(async (res) => {
          if (!res.ok || !res.body) throw await httpError(this.serverName, res);
          this.open = true;
          await readSseStream(res.body, (event, data) => {
            if (event === "endpoint") {
              this.endpoint = new URL(data.trim(), this.url).toString();
              if (!settled) { settled = true; resolve(); }
            } else if (event === "message") {
              try {
                for (const m of parseMessages(data)) this.onmessage?.(m);
              } catch {}
            }
          });
          lost(new Error(`MCP server '${this.serverName}' closed its event stream`));
        })
        .catch((err: unknown) => {
          if (abort.signal.aborted) { this.open = false; return; }
          lost(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  async send(msg: JsonRpcMessage): Promise<void> {
    if (!this.open || !this.endpoint) {
      throw new Error(`MCP server '${this.serverName}' is not connected`);
    }
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });
    if (!res.ok) throw await httpError(this.serverName, res);
    await res.body?.cancel().catch(() => {});
  }

  close(): void {
    this.open = false;
    this.abort?.abort();
    this.abort = null;
  }
}
