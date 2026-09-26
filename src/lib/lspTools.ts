import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { pathToFileURL, fileURLToPath } from "url";
import { z } from "zod";
import { safeResolve } from "./safeResolve";

/**
 * Code-intelligence tools backed by real language servers (LSP over stdio):
 * go-to-definition, references, hover, document/workspace symbols and
 * diagnostics. Same module layout as appTools: schemas, zod validators and
 * the executor live here. JSON-RPC framing is implemented in-house — no deps.
 */

export interface LspToolResult {
  success: boolean;
  output: string;
  summary: string;
  error?: string;
  suggestion?: string;
}

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required } },
});

const positionProps = {
  path: { type: "string", description: "Workspace-relative source file" },
  line: { type: "integer", description: "1-based line" },
  column: { type: "integer", description: "1-based column" },
  symbol: { type: "string", description: "Identifier to look up instead of line/column (its first occurrence in the file is used)" },
};

export const LSP_TOOL_SCHEMAS = [
  fn(
    "lsp_definition",
    "Go to definition via the language server (TS/JS, Python, Rust, Go, C/C++). Give path + line/column (1-based) or path + symbol. Returns path:line:col with the source line. More precise than grep for overloaded or re-exported names.",
    positionProps,
    ["path"]
  ),
  fn(
    "lsp_references",
    "Find all references to the symbol at a position (or the first occurrence of `symbol` in `path`) via the language server. Returns path:line:col with the source line for each.",
    { ...positionProps, include_declaration: { type: "boolean", description: "Include the declaration itself (default true)" } },
    ["path"]
  ),
  fn(
    "lsp_hover",
    "Type signature and docs for the symbol at a position (or the first occurrence of `symbol` in `path`) via the language server.",
    positionProps,
    ["path"]
  ),
  fn(
    "lsp_symbols",
    "Symbols from the language server: give `path` for a file outline (classes, functions, methods with lines), or `query` (plus a `path` or language hint file) to search workspace symbols.",
    {
      path: { type: "string", description: "File to outline (or, with query, a file that selects the language server)" },
      query: { type: "string", description: "Workspace symbol search text" },
    },
    []
  ),
  fn(
    "lsp_diagnostics",
    "Type errors and warnings for one file from the language server (waits up to ~5s after opening it). Faster and more precise than a full build for checking an edit.",
    { path: { type: "string", description: "Workspace-relative source file" } },
    ["path"]
  ),
];

const relPath = z.string().min(1).max(500);
const positionArgs = z
  .object({
    path: relPath,
    line: z.number().int().min(1).optional(),
    column: z.number().int().min(1).optional(),
    symbol: z.string().min(1).max(200).optional(),
  })
  .refine((d) => d.symbol !== undefined || d.line !== undefined, { message: "give line (and column) or symbol" });

export const LSP_ZOD_SCHEMAS = {
  lsp_definition: positionArgs,
  lsp_references: z
    .object({
      path: relPath,
      line: z.number().int().min(1).optional(),
      column: z.number().int().min(1).optional(),
      symbol: z.string().min(1).max(200).optional(),
      include_declaration: z.boolean().optional(),
    })
    .refine((d) => d.symbol !== undefined || d.line !== undefined, { message: "give line (and column) or symbol" }),
  lsp_hover: positionArgs,
  lsp_symbols: z
    .object({ path: relPath.optional(), query: z.string().max(200).optional() })
    .refine((d) => d.path !== undefined || d.query !== undefined, { message: "give path (outline) or query (workspace search)" }),
  lsp_diagnostics: z.object({ path: relPath }),
};

export function isLspTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(LSP_ZOD_SCHEMAS, name);
}

// ─── JSON-RPC framing ──────────────────────────────────────────────────────────

/** Incremental parser for `Content-Length: N\r\n\r\n<body>` frames. */
export class LspFrameParser {
  private buf = Buffer.alloc(0);

  /** Feed a chunk; returns every complete message now available. */
  push(chunk: Buffer | string): unknown[] {
    this.buf = Buffer.concat([this.buf, typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk]);
    const out: unknown[] = [];
    for (;;) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const header = this.buf.subarray(0, headerEnd).toString("ascii");
      const m = /content-length:\s*(\d+)/i.exec(header);
      if (!m) {
        // Garbage before a header: drop it and resync
        this.buf = this.buf.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(m[1]);
      const start = headerEnd + 4;
      if (this.buf.length < start + len) break;
      const body = this.buf.subarray(start, start + len).toString("utf8");
      this.buf = this.buf.subarray(start + len);
      try {
        out.push(JSON.parse(body));
      } catch {
        /* malformed body — skip */
      }
    }
    return out;
  }
}

export function encodeLspMessage(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

// ─── Language registry ─────────────────────────────────────────────────────────

export interface LspCommand {
  command: string;
  args: string[];
}

interface LanguageSpec {
  id: string;
  /** LSP languageId per extension */
  extensions: Record<string, string>;
  candidates: LspCommand[];
  install: string;
}

export const LSP_LANGUAGES: LanguageSpec[] = [
  {
    id: "typescript",
    extensions: { ".ts": "typescript", ".tsx": "typescriptreact", ".mts": "typescript", ".cts": "typescript", ".js": "javascript", ".jsx": "javascriptreact", ".mjs": "javascript", ".cjs": "javascript" },
    candidates: [{ command: "typescript-language-server", args: ["--stdio"] }],
    install: "npm install -D typescript typescript-language-server (in the project), or npm install -g typescript-language-server typescript",
  },
  {
    id: "python",
    extensions: { ".py": "python", ".pyi": "python" },
    candidates: [
      { command: "pyright-langserver", args: ["--stdio"] },
      { command: "pylsp", args: [] },
    ],
    install: "npm install -g pyright (pyright-langserver) or pip install python-lsp-server (pylsp)",
  },
  {
    id: "rust",
    extensions: { ".rs": "rust" },
    candidates: [{ command: "rust-analyzer", args: [] }],
    install: "rustup component add rust-analyzer",
  },
  {
    id: "go",
    extensions: { ".go": "go" },
    candidates: [{ command: "gopls", args: [] }],
    install: "go install golang.org/x/tools/gopls@latest",
  },
  {
    id: "cpp",
    extensions: { ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp", ".hxx": "cpp" },
    candidates: [{ command: "clangd", args: [] }],
    install: "install clangd (LLVM) and put it on PATH",
  },
];

export function languageForPath(file: string): { spec: LanguageSpec; languageId: string } | null {
  const ext = path.extname(file).toLowerCase();
  for (const spec of LSP_LANGUAGES) {
    const languageId = spec.extensions[ext];
    if (languageId) return { spec, languageId };
  }
  return null;
}

/** Test hook / admin override: force the command used for a language. */
const overrides = new Map<string, LspCommand>();
export function setLspCommandOverride(language: string, cmd: LspCommand | null): void {
  if (cmd) overrides.set(language, cmd);
  else overrides.delete(language);
}

function executableIn(dir: string, name: string): string | null {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const ext of exts) {
    const p = path.join(dir, name + ext.toLowerCase());
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* not here */
    }
  }
  return null;
}

/** First available candidate: workspace node_modules/.bin, platform node_modules/.bin, then PATH. */
export function resolveLspCommand(language: string, workspace: string): LspCommand | null {
  const override = overrides.get(language);
  if (override) return override;
  const spec = LSP_LANGUAGES.find((s) => s.id === language);
  if (!spec) return null;
  const dirs = [
    path.join(workspace, "node_modules", ".bin"),
    path.join(process.cwd(), "node_modules", ".bin"),
    ...(process.env.PATH || "").split(path.delimiter).filter(Boolean),
  ];
  for (const cand of spec.candidates) {
    for (const dir of dirs) {
      const found = executableIn(dir, cand.command);
      if (found) return { command: found, args: cand.args };
    }
  }
  return null;
}

// ─── Client ────────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;
const IDLE_SHUTDOWN_MS = 10 * 60_000;
const DIAGNOSTICS_WAIT_MS = 5_000;

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface LspLocation { uri: string; range: LspRange }
export interface LspDiagnostic { range: LspRange; severity?: number; message: string; source?: string; code?: string | number }

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export class LspClient {
  private proc: ChildProcess;
  private parser = new LspFrameParser();
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private open = new Map<string, { version: number; mtimeMs: number }>();
  private diagnostics = new Map<string, LspDiagnostic[]>();
  private diagWaiters = new Set<() => void>();
  private idleTimer: NodeJS.Timeout | null = null;
  private stderrTail = "";
  exited = false;
  onExit: (() => void) | null = null;

  constructor(cmd: LspCommand, readonly root: string) {
    let command = cmd.command;
    let args = cmd.args;
    let shell = false;
    if (/\.[cm]?js$/i.test(command)) {
      args = [command, ...args];
      command = process.execPath;
    } else if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
      // npm shims on Windows need a shell; quote in case of spaces
      shell = true;
      command = `"${command}"`;
    }
    this.proc = spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"], shell, windowsHide: true });
    this.proc.stdout?.on("data", (c: Buffer) => {
      for (const msg of this.parser.push(c)) this.handle(msg as Record<string, unknown>);
    });
    this.proc.stderr?.on("data", (c: Buffer) => {
      this.stderrTail = (this.stderrTail + c.toString()).slice(-2000);
    });
    this.proc.on("error", (err) => this.markExited(err.message));
    this.proc.on("exit", (code) => this.markExited(`language server exited (code ${code})`));
    this.proc.stdin?.on("error", () => { /* broken pipe after exit */ });
  }

  private markExited(reason: string): void {
    if (this.exited) return;
    this.exited = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const detail = this.stderrTail.trim() ? `${reason}: ${this.stderrTail.trim().split("\n").slice(-3).join(" | ")}` : reason;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(detail));
    }
    this.pending.clear();
    this.onExit?.();
  }

  private send(msg: Record<string, unknown>): void {
    if (this.exited) return;
    this.proc.stdin?.write(encodeLspMessage({ jsonrpc: "2.0", ...msg }));
  }

  private handle(msg: Record<string, unknown>): void {
    const id = msg.id as number | string | undefined;
    if (id !== undefined && msg.method === undefined) {
      const p = this.pending.get(Number(id));
      if (!p) return;
      this.pending.delete(Number(id));
      clearTimeout(p.timer);
      const err = msg.error as { message?: string } | undefined;
      if (err) p.reject(new Error(err.message || "LSP error"));
      else p.resolve(msg.result ?? null);
      return;
    }
    if (typeof msg.method !== "string") return;
    if (id !== undefined) {
      // Server → client request: answer minimally so the server does not stall
      const params = msg.params as { items?: unknown[] } | undefined;
      const result = msg.method === "workspace/configuration" ? (params?.items ?? []).map(() => null) : null;
      this.send({ id, result });
      return;
    }
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as { uri: string; diagnostics: LspDiagnostic[] };
      this.diagnostics.set(normalizeUri(params.uri), params.diagnostics ?? []);
      for (const w of this.diagWaiters) w();
    }
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.exited) return Promise.reject(new Error("language server is not running"));
    this.touch();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  async initialize(): Promise<void> {
    const rootUri = pathToFileURL(this.root).href;
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      rootPath: this.root,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: false, dynamicRegistration: false },
          definition: { linkSupport: false },
          references: {},
          hover: { contentFormat: ["plaintext", "markdown"] },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          publishDiagnostics: { relatedInformation: false },
        },
        workspace: { symbol: {}, configuration: true, workspaceFolders: true },
      },
    }, 60_000);
    this.notify("initialized", {});
  }

  /** didOpen on first use; didChange (full text) when the file's mtime moved. */
  async sync(abs: string, languageId: string): Promise<string> {
    const uri = pathToFileURL(abs).href;
    const key = normalizeUri(uri);
    const stat = await fsp.stat(abs);
    const cur = this.open.get(key);
    if (cur && cur.mtimeMs === stat.mtimeMs) return uri;
    const text = await fsp.readFile(abs, "utf8");
    this.diagnostics.delete(key);
    if (!cur) {
      this.open.set(key, { version: 1, mtimeMs: stat.mtimeMs });
      this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
    } else {
      const version = cur.version + 1;
      this.open.set(key, { version, mtimeMs: stat.mtimeMs });
      this.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
    }
    return uri;
  }

  /** Latest diagnostics for a synced document, waiting up to timeoutMs for the first publish. */
  async waitDiagnostics(uri: string, timeoutMs = DIAGNOSTICS_WAIT_MS): Promise<LspDiagnostic[] | null> {
    const key = normalizeUri(uri);
    if (this.diagnostics.has(key)) return this.diagnostics.get(key)!;
    return new Promise((resolve) => {
      const done = () => {
        if (!this.diagnostics.has(key) && !this.exited) return;
        clearTimeout(timer);
        this.diagWaiters.delete(done);
        resolve(this.diagnostics.get(key) ?? null);
      };
      const timer = setTimeout(() => {
        this.diagWaiters.delete(done);
        resolve(this.diagnostics.get(key) ?? null);
      }, timeoutMs);
      this.diagWaiters.add(done);
    });
  }

  touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.shutdown(), IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  async shutdown(): Promise<void> {
    if (this.exited) return;
    try {
      await this.request("shutdown", null, 3_000);
      this.notify("exit", null);
    } catch {
      /* fall through to kill */
    }
    await new Promise((r) => setTimeout(r, 200));
    this.kill();
  }

  kill(): void {
    if (!this.exited) {
      try { this.proc.kill(); } catch { /* already gone */ }
    }
    this.markExited("language server stopped");
  }
}

function normalizeUri(uri: string): string {
  try {
    const p = fileURLToPath(uri);
    return process.platform === "win32" ? p.toLowerCase() : p;
  } catch {
    return uri;
  }
}

// ─── Server registry (one per project + language) ─────────────────────────────

const g = globalThis as unknown as { __lspServers?: Map<string, Promise<LspClient>>; __lspExitHook?: boolean };
const servers: Map<string, Promise<LspClient>> = (g.__lspServers ??= new Map());
if (!g.__lspExitHook) {
  g.__lspExitHook = true;
  process.once("exit", () => {
    for (const p of servers.values()) p.then((c) => c.kill()).catch(() => {});
  });
}

export class LspUnavailableError extends Error {}

export async function getLspClient(workspace: string, language: string): Promise<LspClient> {
  const key = `${path.resolve(workspace)}::${language}`;
  const existing = servers.get(key);
  if (existing) {
    const c = await existing.catch(() => null);
    if (c && !c.exited) return c;
    servers.delete(key);
  }
  const cmd = resolveLspCommand(language, workspace);
  if (!cmd) {
    const spec = LSP_LANGUAGES.find((s) => s.id === language);
    const names = spec?.candidates.map((c) => c.command).join(" or ") ?? language;
    throw new LspUnavailableError(`No ${language} language server found (looked for ${names}). Install it: ${spec?.install ?? "n/a"}`);
  }
  const started = (async () => {
    const client = new LspClient(cmd, path.resolve(workspace));
    client.onExit = () => {
      if (servers.get(key) === started) servers.delete(key);
    };
    try {
      await client.initialize();
    } catch (err) {
      client.kill();
      throw err;
    }
    return client;
  })();
  servers.set(key, started);
  started.catch(() => { if (servers.get(key) === started) servers.delete(key); });
  return started;
}

/** Stop every running server (tests, shutdown). */
export async function shutdownAllLspServers(): Promise<void> {
  const all = [...servers.values()];
  servers.clear();
  await Promise.all(all.map((p) => p.then((c) => c.shutdown()).catch(() => {})));
}

// ─── Positions and formatting ──────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 0-based LSP position from 1-based line/column, or from the first
 * whole-identifier occurrence of `symbol` (on `line` when both are given).
 */
export function resolvePosition(
  text: string,
  opts: { line?: number; column?: number; symbol?: string }
): LspPosition {
  const lines = text.split(/\r?\n/);
  if (opts.symbol) {
    const re = new RegExp(`(?<![\\w$])${escapeRegex(opts.symbol)}(?![\\w$])`);
    const range = opts.line !== undefined ? [opts.line - 1] : lines.map((_, i) => i);
    for (const i of range) {
      const m = re.exec(lines[i] ?? "");
      if (m) return { line: i, character: m.index };
    }
    throw new Error(`symbol '${opts.symbol}' not found${opts.line !== undefined ? ` on line ${opts.line}` : ""}`);
  }
  const line = (opts.line ?? 1) - 1;
  if (line >= lines.length) throw new Error(`line ${line + 1} is past the end of the file (${lines.length} lines)`);
  const lineText = lines[line];
  const character = opts.column !== undefined ? Math.min(opts.column - 1, lineText.length) : Math.max(0, lineText.search(/\S/));
  return { line, character };
}

export function displayPath(root: string, uri: string): string {
  let abs: string;
  try {
    abs = fileURLToPath(uri);
  } catch {
    return uri;
  }
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : abs;
}

/** Reads source lines for excerpts, caching per file within one call. */
export class LineCache {
  private files = new Map<string, string[] | null>();
  line(uri: string, line: number): string {
    if (!this.files.has(uri)) {
      let lines: string[] | null = null;
      try {
        lines = fs.readFileSync(fileURLToPath(uri), "utf8").split(/\r?\n/);
      } catch {
        lines = null;
      }
      this.files.set(uri, lines);
    }
    const text = this.files.get(uri)?.[line] ?? "";
    const t = text.trim();
    return t.length > 160 ? `${t.slice(0, 157)}...` : t;
  }
}

export function formatLocation(root: string, loc: LspLocation, cache: LineCache): string {
  const { line, character } = loc.range.start;
  const excerpt = cache.line(loc.uri, line);
  return `${displayPath(root, loc.uri)}:${line + 1}:${character + 1}${excerpt ? `  ${excerpt}` : ""}`;
}

/** Location | Location[] | LocationLink[] | null → Location[] */
export function toLocations(result: unknown): LspLocation[] {
  if (!result) return [];
  const arr = Array.isArray(result) ? result : [result];
  const out: LspLocation[] = [];
  for (const r of arr as Record<string, unknown>[]) {
    if (r && typeof r.uri === "string" && r.range) out.push({ uri: r.uri, range: r.range as LspRange });
    else if (r && typeof r.targetUri === "string") {
      out.push({ uri: r.targetUri, range: (r.targetSelectionRange ?? r.targetRange) as LspRange });
    }
  }
  return out;
}

export function hoverText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const contents = (result as { contents?: unknown }).contents;
  const part = (c: unknown): string => {
    if (typeof c === "string") return c;
    if (c && typeof c === "object") {
      const o = c as { value?: string; language?: string };
      if (typeof o.value === "string") return o.language ? "```" + o.language + "\n" + o.value + "\n```" : o.value;
    }
    return "";
  };
  return (Array.isArray(contents) ? contents.map(part) : [part(contents)]).filter(Boolean).join("\n\n").trim();
}

const SYMBOL_KINDS = [
  "", "file", "module", "namespace", "package", "class", "method", "property", "field", "constructor", "enum",
  "interface", "function", "variable", "constant", "string", "number", "boolean", "array", "object", "key",
  "null", "enum member", "struct", "event", "operator", "type parameter",
];
const kindName = (k: unknown) => SYMBOL_KINDS[Number(k)] || "symbol";

interface DocSymbol { name: string; kind: number; detail?: string; range?: LspRange; selectionRange?: LspRange; location?: LspLocation; containerName?: string; children?: DocSymbol[] }

/** DocumentSymbol[] (hierarchical, indented) or SymbolInformation[] → outline lines */
export function formatSymbols(root: string, symbols: unknown, fileUri?: string): string[] {
  const out: string[] = [];
  const walk = (list: DocSymbol[], depth: number) => {
    for (const s of list) {
      const uri = s.location?.uri ?? fileUri ?? "";
      const start = (s.selectionRange ?? s.location?.range ?? s.range)?.start ?? { line: 0, character: 0 };
      const where = fileUri && uri === fileUri ? `${start.line + 1}:${start.character + 1}` : `${displayPath(root, uri)}:${start.line + 1}:${start.character + 1}`;
      const container = s.containerName && depth === 0 && !s.children ? ` (in ${s.containerName})` : "";
      out.push(`${"  ".repeat(depth)}${kindName(s.kind)} ${s.name}${s.detail ? ` ${s.detail}` : ""}${container}  ${where}`);
      if (s.children?.length) walk(s.children, depth + 1);
    }
  };
  if (Array.isArray(symbols)) walk(symbols as DocSymbol[], 0);
  return out;
}

const SEVERITY = ["", "error", "warning", "info", "hint"];

export function formatDiagnostics(relFile: string, diags: LspDiagnostic[]): string[] {
  return [...diags]
    .sort((a, b) => (a.severity ?? 1) - (b.severity ?? 1) || a.range.start.line - b.range.start.line)
    .map((d) => {
      const { line, character } = d.range.start;
      const tag = [d.source, d.code !== undefined ? String(d.code) : ""].filter(Boolean).join(" ");
      return `${relFile}:${line + 1}:${character + 1} ${SEVERITY[d.severity ?? 1] || "error"}: ${d.message.split("\n")[0]}${tag ? ` [${tag}]` : ""}`;
    });
}

// ─── Executor ──────────────────────────────────────────────────────────────────

const MAX_RESULTS = 200;

function ok(output: string, summary: string): LspToolResult {
  return { success: true, output, summary };
}

function fail(error: string, summary: string, suggestion?: string): LspToolResult {
  return { success: false, output: `Error: ${error}${suggestion ? `\n${suggestion}` : ""}`, summary, error, suggestion };
}

interface OpenedFile { client: LspClient; uri: string; abs: string; rel: string; text: string }

async function openFile(workspace: string, relFile: string): Promise<OpenedFile> {
  const abs = safeResolve(workspace, relFile);
  const lang = languageForPath(abs);
  if (!lang) {
    const exts = LSP_LANGUAGES.flatMap((s) => Object.keys(s.extensions)).join(" ");
    throw new LspUnavailableError(`no language server for '${path.extname(abs) || relFile}' files (supported: ${exts})`);
  }
  const text = await fsp.readFile(abs, "utf8");
  const client = await getLspClient(workspace, lang.spec.id);
  const uri = await client.sync(abs, lang.languageId);
  return { client, uri, abs, rel: path.relative(workspace, abs).split(path.sep).join("/"), text };
}

function positionArgsOf(args: Record<string, unknown>) {
  return {
    line: typeof args.line === "number" ? args.line : undefined,
    column: typeof args.column === "number" ? args.column : undefined,
    symbol: typeof args.symbol === "string" ? args.symbol : undefined,
  };
}

function listLocations(root: string, locs: LspLocation[]): string {
  const cache = new LineCache();
  const lines = locs.slice(0, MAX_RESULTS).map((l) => formatLocation(root, l, cache));
  if (locs.length > MAX_RESULTS) lines.push(`... ${locs.length - MAX_RESULTS} more`);
  return lines.join("\n");
}

async function positional(name: string, args: Record<string, unknown>, workspace: string): Promise<LspToolResult> {
  const f = await openFile(workspace, String(args.path));
  const pos = resolvePosition(f.text, positionArgsOf(args));
  const at = `${f.rel}:${pos.line + 1}:${pos.character + 1}`;
  const textDocument = { uri: f.uri };
  if (name === "lsp_hover") {
    const text = hoverText(await f.client.request("textDocument/hover", { textDocument, position: pos }));
    if (!text) return ok(`No hover information at ${at}.`, `No hover info at ${at}`);
    return ok(`${at}\n${text}`, `Hover at ${at}`);
  }
  if (name === "lsp_definition") {
    const locs = toLocations(await f.client.request("textDocument/definition", { textDocument, position: pos }));
    if (!locs.length) return ok(`No definition found for ${at}.`, `No definition for ${at}`);
    return ok(listLocations(workspace, locs), `${locs.length} definition${locs.length === 1 ? "" : "s"} for ${at}`);
  }
  const includeDeclaration = args.include_declaration !== false;
  const locs = toLocations(await f.client.request("textDocument/references", { textDocument, position: pos, context: { includeDeclaration } }));
  if (!locs.length) return ok(`No references found for ${at}.`, `No references for ${at}`);
  return ok(listLocations(workspace, locs), `${locs.length} reference${locs.length === 1 ? "" : "s"} for ${at}`);
}

async function symbols(args: Record<string, unknown>, workspace: string): Promise<LspToolResult> {
  const query = typeof args.query === "string" ? args.query : undefined;
  if (query !== undefined) {
    let client: LspClient;
    if (typeof args.path === "string") client = (await openFile(workspace, args.path)).client;
    else client = await getLspClient(workspace, "typescript");
    const res = await client.request("workspace/symbol", { query });
    const lines = formatSymbols(workspace, res);
    if (!lines.length) return ok(`No workspace symbols match '${query}'.`, `No symbols for '${query}'`);
    const shown = lines.slice(0, MAX_RESULTS);
    if (lines.length > MAX_RESULTS) shown.push(`... ${lines.length - MAX_RESULTS} more`);
    return ok(shown.join("\n"), `${lines.length} symbol${lines.length === 1 ? "" : "s"} for '${query}'`);
  }
  const f = await openFile(workspace, String(args.path));
  const res = await f.client.request("textDocument/documentSymbol", { textDocument: { uri: f.uri } });
  const lines = formatSymbols(workspace, res, f.uri);
  if (!lines.length) return ok(`${f.rel}: no symbols.`, `No symbols in ${f.rel}`);
  return ok(`${f.rel}\n${lines.join("\n")}`, `${lines.length} symbols in ${f.rel}`);
}

async function diagnostics(args: Record<string, unknown>, workspace: string): Promise<LspToolResult> {
  const f = await openFile(workspace, String(args.path));
  const diags = await f.client.waitDiagnostics(f.uri);
  if (diags === null) return ok(`${f.rel}: the language server published no diagnostics within ${DIAGNOSTICS_WAIT_MS / 1000}s (none reported so far).`, `No diagnostics yet for ${f.rel}`);
  if (!diags.length) return ok(`${f.rel}: no problems.`, `No problems in ${f.rel}`);
  const errors = diags.filter((d) => (d.severity ?? 1) === 1).length;
  return ok(formatDiagnostics(f.rel, diags).join("\n"), `${errors} error${errors === 1 ? "" : "s"}, ${diags.length - errors} other in ${f.rel}`);
}

export async function executeLspTool(name: string, args: Record<string, unknown>, workspace: string): Promise<LspToolResult> {
  try {
    switch (name) {
      case "lsp_definition":
      case "lsp_references":
      case "lsp_hover":
        return await positional(name, args, workspace);
      case "lsp_symbols": return await symbols(args, workspace);
      case "lsp_diagnostics": return await diagnostics(args, workspace);
      default: return fail(`Unknown tool ${name}`, "Unknown tool");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof LspUnavailableError) return fail(msg, "Language server unavailable", "Fall back to grep_files / read_file, or install the server.");
    if (/ENOENT/.test(msg)) return fail(msg, `${name} failed`, "Check the path with list_files or glob_files.");
    return fail(msg, `${name} failed`);
  }
}
