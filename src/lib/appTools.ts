import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import Database from "better-sqlite3";
import { safeResolve } from "./safeResolve";
import { getPreviewStatus } from "./previewManager";
import { checkUrlAllowed } from "./browserSession";
import { executeCode, imageUrl, type ScienceTurnContext, type ScienceToolResult } from "./scienceTools";

const execFileAsync = promisify(execFile);

/**
 * Application-building tools: exercise an API (the project's own preview or
 * a public one), query data files with SQL, make a chart from data, and
 * review the turn's diff. Same module layout as scienceTools/browserTools:
 * schemas, zod validators and the executor live here.
 */

export type AppToolResult = ScienceToolResult;
export type AppTurnContext = ScienceTurnContext;

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required } },
});

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export const PLOT_KINDS = ["line", "scatter", "bar", "step"] as const;

export const APP_TOOL_SCHEMAS = [
  fn(
    "http_request",
    "Send an HTTP request and return status, headers and body (JSON pretty-printed). Use it to exercise the API you are building (the project's running preview, e.g. 'http://localhost:4001/api/items' or just '/api/items') or a public API. Any method, custom headers and a JSON or text body. Redirects are not followed (the Location header is reported). The platform's own port and private networks are blocked. Never put secrets in the request unless the user provided them for this purpose.",
    {
      url: { type: "string", description: "Absolute http(s) URL, or a path starting with '/' on the running preview" },
      method: { type: "string", enum: HTTP_METHODS, description: "Default GET" },
      headers: { type: "object", description: "Request headers, e.g. {\"Authorization\": \"Bearer …\"}", additionalProperties: { type: "string" } },
      body: { description: "Request body: a string, or an object/array sent as JSON (sets Content-Type: application/json unless given)" },
      timeout_seconds: { type: "integer", description: "1-120, default 20" },
    },
    ["url"]
  ),
  fn(
    "query_data",
    "Run read-only SQL over a data file in the workspace: .csv/.tsv (table 'data'), .json (array of objects) / .jsonl (table 'data'), or a SQLite database (.sqlite/.db/.sqlite3, its own tables). Omit sql to get the schema (columns, inferred types, row count, sample rows). Use it to inspect datasets, check aggregates and validate outputs without writing a script.",
    {
      source: { type: "string", description: "Workspace-relative path of the data file" },
      sql: { type: "string", description: "SELECT/WITH query (optional). CSV/JSON: the table is called data" },
      limit: { type: "integer", description: "Max rows returned (1-500, default 50)" },
    },
    ["source"]
  ),
  fn(
    "plot_data",
    "Make a chart (PNG) with matplotlib from inline series or from a data file, saved into the workspace and shown in the UI. Give x plus one or more series, or source + x_column + y_columns (optionally sql to select/aggregate first). Axis labels with units are expected; use logx/logy for data spanning decades. Returns the file path — reference it in reports and with view_image.",
    {
      path: { type: "string", description: "Output PNG path, default results/plot-<timestamp>.png" },
      kind: { type: "string", enum: PLOT_KINDS, description: "Default line" },
      title: { type: "string" },
      xlabel: { type: "string" },
      ylabel: { type: "string" },
      logx: { type: "boolean" },
      logy: { type: "boolean" },
      x: { type: "array", items: {}, description: "Inline x values (numbers or category labels)" },
      series: {
        type: "array",
        description: "Inline series: [{name, y: number[]}]",
        items: { type: "object", properties: { name: { type: "string" }, y: { type: "array", items: { type: "number" } } }, required: ["y"] },
      },
      source: { type: "string", description: "Data file (csv/tsv/json/jsonl/sqlite) instead of inline data" },
      sql: { type: "string", description: "Query to run on source first (optional)" },
      x_column: { type: "string" },
      y_columns: { type: "array", items: { type: "string" } },
    },
    []
  ),
  fn(
    "review_changes",
    "Show what has changed in the workspace: git status, diff stat and the unified diff against a base (default HEAD = everything this turn changed so far; 'HEAD~1' = the previous checkpoint; or a commit sha). Review it before declaring work done, or give it to a verify sub-agent.",
    {
      base: { type: "string", description: "HEAD (default), HEAD~n, or a commit sha" },
      path: { type: "string", description: "Limit the diff to this file or directory (optional)" },
      max_chars: { type: "integer", description: "Diff size cap (1000-40000, default 12000)" },
    },
    []
  ),
];

const relPath = z.string().min(1).max(500);
const dataSource = relPath.regex(/\.(csv|tsv|json|jsonl|ndjson|sqlite|sqlite3|db)$/i, "source must be a .csv/.tsv/.json/.jsonl/.sqlite/.db file");
export const APP_ZOD_SCHEMAS = {
  http_request: z.object({
    url: z.string().min(1).max(4000),
    method: z.enum(HTTP_METHODS).optional(),
    headers: z.record(z.string(), z.string().max(8000)).optional(),
    body: z.union([z.string().max(2_000_000), z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
    timeout_seconds: z.number().int().min(1).max(120).optional(),
  }),
  query_data: z.object({
    source: dataSource,
    sql: z.string().min(1).max(20_000).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  plot_data: z
    .object({
      path: relPath.regex(/\.png$/i, "path must end in .png").optional(),
      kind: z.enum(PLOT_KINDS).optional(),
      title: z.string().max(200).optional(),
      xlabel: z.string().max(200).optional(),
      ylabel: z.string().max(200).optional(),
      logx: z.boolean().optional(),
      logy: z.boolean().optional(),
      x: z.array(z.union([z.number(), z.string().max(200)])).max(100_000).optional(),
      series: z.array(z.object({ name: z.string().max(100).optional(), y: z.array(z.number()).max(100_000) })).max(20).optional(),
      source: dataSource.optional(),
      sql: z.string().max(20_000).optional(),
      x_column: z.string().max(200).optional(),
      y_columns: z.array(z.string().max(200)).max(20).optional(),
    })
    .refine((d) => (d.series && d.series.length > 0) || (d.source && d.y_columns && d.y_columns.length > 0), {
      message: "give inline `series` (with `x`), or `source` + `x_column` + `y_columns`",
    }),
  review_changes: z.object({
    base: z.string().regex(/^(HEAD(~\d{1,3})?|[0-9a-f]{4,40})$/i, "base must be HEAD, HEAD~n or a commit sha").optional(),
    path: relPath.optional(),
    max_chars: z.number().int().min(1000).max(40_000).optional(),
  }),
};

export function isAppTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(APP_ZOD_SCHEMAS, name);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.6);
  return `${s.slice(0, head)}\n...[truncated ${s.length - max} chars]...\n${s.slice(-(max - head))}`;
}

function ok(output: string, summary: string, rest: Partial<AppToolResult> = {}): AppToolResult {
  return { success: true, output, summary, ...rest };
}

function fail(error: string, summary: string, suggestion?: string): AppToolResult {
  return { success: false, output: `Error: ${error}${suggestion ? `\n${suggestion}` : ""}`, summary, error, suggestion };
}

function kb(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

// ─── http_request ──────────────────────────────────────────────────────────────

const MAX_BODY_SHOWN = 16_000;
const MAX_BODY_READ = 2 * 1024 * 1024;

async function httpRequest(args: Record<string, unknown>, projectId: string, signal?: AbortSignal): Promise<AppToolResult> {
  let raw = String(args.url).trim();
  const preview = getPreviewStatus(projectId);
  const previewUrl = preview.status === "running" && preview.url ? preview.url : null;
  if (raw.startsWith("/")) {
    if (!previewUrl) {
      return fail(
        `The project's preview is not running (status: ${preview.status}), so the path ${raw} has no server.`,
        "Preview not running",
        "Ask the user to press Run in the Preview tab, or pass an absolute URL."
      );
    }
    raw = previewUrl.replace(/\/$/, "") + raw;
  }

  let url: URL;
  try {
    url = await checkUrlAllowed(raw, { previewUrl });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), "Request blocked");
  }

  const method = (typeof args.method === "string" ? args.method.toUpperCase() : "GET") as (typeof HTTP_METHODS)[number];
  const headers = new Headers();
  for (const [k, v] of Object.entries((args.headers as Record<string, string> | undefined) ?? {})) {
    if (/^(host|content-length|connection)$/i.test(k)) continue;
    headers.set(k, String(v));
  }
  let body: string | undefined;
  if (args.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof args.body === "string") body = args.body;
    else {
      body = JSON.stringify(args.body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
  }
  if (!headers.has("user-agent")) headers.set("user-agent", "open-code-agent/1.0");

  const timeoutMs = Math.min(120, Math.max(1, Number(args.timeout_seconds) || 20)) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  const started = Date.now();
  try {
    const res = await fetch(url, { method, headers, body, redirect: "manual", signal: controller.signal });
    const ms = Date.now() - started;
    const ct = res.headers.get("content-type") ?? "";
    let text = "";
    if (method !== "HEAD") {
      const buf = Buffer.from(await res.arrayBuffer());
      text = buf.subarray(0, MAX_BODY_READ).toString("utf8");
      if (buf.length > MAX_BODY_READ) text += `\n...[body truncated: ${buf.length} bytes total]`;
    }
    let shown = text;
    if (/json/i.test(ct) && text.trim()) {
      try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON after all */ }
    }
    const interesting = ["content-type", "content-length", "location", "set-cookie", "cache-control", "x-request-id", "www-authenticate"];
    const headerLines = interesting
      .filter((h) => res.headers.has(h))
      .map((h) => `${h}: ${h === "set-cookie" ? "(present)" : res.headers.get(h)}`);
    const lines = [
      `HTTP ${res.status} ${res.statusText} — ${method} ${url.href} — ${ms} ms${text ? ` — ${kb(Buffer.byteLength(text))}` : ""}`,
      ...headerLines,
      "--- body ---",
      shown ? clip(shown, MAX_BODY_SHOWN) : "(empty)",
    ];
    const success = res.status < 400;
    return {
      success,
      output: lines.join("\n"),
      summary: `${method} ${url.pathname}${url.search ? "?" : ""} → ${res.status} (${ms} ms)`,
      error: success ? undefined : `HTTP ${res.status}`,
      extra: { status: res.status, url: url.href, method, ms },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = controller.signal.aborted && !signal?.aborted;
    return fail(
      timedOut ? `No response within ${timeoutMs / 1000}s` : msg,
      `${method} ${url.pathname} failed`,
      /ECONNREFUSED/.test(msg) ? "Nothing is listening at that address — is the server running (read_preview_logs)?" : undefined
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ─── Data loading (query_data / plot_data) ─────────────────────────────────────

const MAX_ROWS_LOADED = 500_000;
const MAX_DATA_BYTES = 200 * 1024 * 1024;

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, newlines in quotes. */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

type ColType = "REAL" | "INTEGER" | "TEXT";

function inferType(values: unknown[]): ColType {
  let sawNumber = false;
  let allInt = true;
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "number") { sawNumber = true; if (!Number.isInteger(v)) allInt = false; continue; }
    const s = String(v).trim();
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return "TEXT";
    sawNumber = true;
    if (!/^[-+]?\d+$/.test(s) || Math.abs(Number(s)) > Number.MAX_SAFE_INTEGER) allInt = false;
  }
  return sawNumber ? (allInt ? "INTEGER" : "REAL") : "TEXT";
}

export interface LoadedTable {
  db: Database.Database;
  /** Table names available for querying */
  tables: string[];
  /** For file-backed loads: how many rows were read, and whether capped */
  rowsLoaded?: number;
  truncated?: boolean;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function loadRows(db: Database.Database, table: string, columns: string[], rows: unknown[][]): void {
  const types = columns.map((_, i) => inferType(rows.map((r) => r[i])));
  db.exec(`CREATE TABLE ${quoteIdent(table)} (${columns.map((c, i) => `${quoteIdent(c)} ${types[i]}`).join(", ")})`);
  const insert = db.prepare(`INSERT INTO ${quoteIdent(table)} VALUES (${columns.map(() => "?").join(", ")})`);
  const tx = db.transaction((all: unknown[][]) => {
    for (const r of all) {
      insert.run(columns.map((_, i) => {
        const v = r[i];
        if (v === undefined || v === null || v === "") return null;
        if (types[i] === "TEXT") return typeof v === "object" ? JSON.stringify(v) : String(v);
        return Number(v);
      }));
    }
  });
  tx(rows);
}

/** Open a data file as a queryable SQLite handle (caller must close it). */
export async function openDataSource(workspace: string, source: string): Promise<LoadedTable> {
  const full = safeResolve(workspace, source);
  const st = await fs.stat(full);
  if (!st.isFile()) throw new Error(`${source} is not a file`);
  if (st.size > MAX_DATA_BYTES) throw new Error(`${source} is ${kb(st.size)} — larger than the ${kb(MAX_DATA_BYTES)} limit`);
  const ext = source.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

  if (ext === "sqlite" || ext === "sqlite3" || ext === "db") {
    const db = new Database(full, { readonly: true, fileMustExist: true });
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    return { db, tables };
  }

  const text = await fs.readFile(full, "utf8");
  const db = new Database(":memory:");
  let columns: string[];
  let rows: unknown[][];
  if (ext === "csv" || ext === "tsv") {
    const parsed = parseDelimited(text.replace(/^﻿/, ""), ext === "tsv" ? "\t" : ",");
    if (parsed.length === 0) throw new Error(`${source} is empty`);
    columns = parsed[0].map((c, i) => c.trim() || `col${i + 1}`);
    rows = parsed.slice(1).map((r) => columns.map((_, i) => r[i] ?? ""));
  } else {
    let records: unknown[];
    if (ext === "jsonl" || ext === "ndjson") {
      records = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    } else {
      const parsed = JSON.parse(text);
      records = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
          ? (Object.values(parsed).find(Array.isArray) as unknown[] | undefined) ?? [parsed]
          : [parsed];
    }
    const keys = new Set<string>();
    for (const r of records) {
      if (r && typeof r === "object" && !Array.isArray(r)) for (const k of Object.keys(r)) keys.add(k);
    }
    columns = keys.size ? [...keys] : ["value"];
    rows = records.map((r) =>
      r && typeof r === "object" && !Array.isArray(r)
        ? columns.map((k) => (r as Record<string, unknown>)[k])
        : [r]
    );
  }
  const truncated = rows.length > MAX_ROWS_LOADED;
  if (truncated) rows = rows.slice(0, MAX_ROWS_LOADED);
  loadRows(db, "data", columns, rows);
  return { db, tables: ["data"], rowsLoaded: rows.length, truncated };
}

function formatTable(columns: string[], rows: unknown[][], cellMax = 80): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : String(v).replace(/\s+/g, " ");
    return s.length > cellMax ? `${s.slice(0, cellMax - 1)}…` : s;
  };
  const head = `| ${columns.join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  return [head, sep, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

function describeTable(db: Database.Database, table: string, sample = 5): string {
  const cols = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as { name: string; type: string }[];
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`).get() as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM ${quoteIdent(table)} LIMIT ${sample}`).all() as Record<string, unknown>[];
  const names = cols.map((c) => c.name);
  const lines = [
    `Table ${table}: ${count} rows, ${cols.length} columns`,
    cols.map((c) => `  ${c.name} (${c.type || "ANY"})`).join("\n"),
  ];
  if (rows.length) lines.push(`Sample (${rows.length}):`, formatTable(names, rows.map((r) => names.map((n) => r[n])), 40));
  return lines.join("\n");
}

async function queryData(args: Record<string, unknown>, workspace: string, ctx: AppTurnContext): Promise<AppToolResult> {
  const source = String(args.source).replace(/\\/g, "/");
  let loaded: LoadedTable;
  try {
    loaded = await openDataSource(workspace, source);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), `Could not open ${source}`);
  }
  ctx.filesRead.add(source);
  const { db, tables } = loaded;
  try {
    db.pragma("query_only = 1");
    const loadNote = loaded.rowsLoaded !== undefined
      ? `Loaded ${loaded.rowsLoaded} rows from ${source} into table data${loaded.truncated ? ` (capped at ${MAX_ROWS_LOADED})` : ""}.`
      : `Opened ${source} read-only: ${tables.length} table(s): ${tables.join(", ") || "(none)"}.`;

    if (!args.sql) {
      const described = tables.slice(0, 20).map((t) => describeTable(db, t)).join("\n\n");
      return ok(`${loadNote}\n\n${described || "(no tables)"}`, `Schema of ${source}: ${tables.length} table(s)`);
    }

    const sql = String(args.sql).trim().replace(/;\s*$/, "");
    const limit = Math.min(500, Math.max(1, Number(args.limit) || 50));
    let stmt: Database.Statement;
    try {
      stmt = db.prepare(sql);
    } catch (err) {
      return fail(`SQL error: ${err instanceof Error ? err.message : String(err)}`, "Query failed", `Tables: ${tables.join(", ")}. Omit sql to see the schema.`);
    }
    if (!stmt.readonly) return fail("Only read-only queries are allowed (SELECT / WITH / EXPLAIN / PRAGMA).", "Query rejected");
    const columns = stmt.columns().map((c) => c.name);
    const rows: unknown[][] = [];
    let more = false;
    for (const r of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
      if (rows.length >= limit) { more = true; break; }
      rows.push(columns.map((c) => r[c]));
    }
    const table = rows.length ? formatTable(columns, rows) : "(no rows)";
    return ok(
      `${loadNote}\n\n${rows.length} row(s)${more ? ` shown (limit ${limit}; more available)` : ""}:\n${table}`,
      `Query on ${source}: ${rows.length}${more ? "+" : ""} row(s)`,
      { extra: { rows: rows.length, more, columns } }
    );
  } finally {
    db.close();
  }
}

// ─── plot_data ─────────────────────────────────────────────────────────────────

export interface PlotSpec {
  kind: (typeof PLOT_KINDS)[number];
  title?: string;
  xlabel?: string;
  ylabel?: string;
  logx?: boolean;
  logy?: boolean;
  x: (number | string)[];
  series: { name: string; y: (number | null)[] }[];
  path: string;
}

/** The matplotlib program for a spec (data travels as base64 JSON, so no quoting issues). */
export function buildPlotScript(spec: PlotSpec): string {
  const payload = Buffer.from(JSON.stringify(spec)).toString("base64");
  return `import base64, json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

spec = json.loads(base64.b64decode("${payload}").decode("utf-8"))
x = spec["x"]
categorical = any(isinstance(v, str) for v in x)
fig, ax = plt.subplots(figsize=(7.5, 4.5), dpi=120)
xs = list(range(len(x))) if categorical else x
for i, s in enumerate(spec["series"]):
    y = [float("nan") if v is None else v for v in s["y"]]
    n = min(len(xs), len(y))
    label = s.get("name") or f"series {i + 1}"
    if spec["kind"] == "scatter":
        ax.scatter(xs[:n], y[:n], s=14, label=label)
    elif spec["kind"] == "bar":
        w = 0.8 / max(1, len(spec["series"]))
        ax.bar([v + (i - (len(spec["series"]) - 1) / 2) * w for v in (xs[:n] if categorical else range(n))], y[:n], width=w, label=label)
    elif spec["kind"] == "step":
        ax.step(xs[:n], y[:n], where="mid", label=label)
    else:
        ax.plot(xs[:n], y[:n], marker="o" if n <= 30 else None, ms=3, lw=1.4, label=label)
if categorical or spec["kind"] == "bar":
    ax.set_xticks(range(len(x)))
    ax.set_xticklabels([str(v) for v in x], rotation=30 if len(x) > 8 else 0, ha="right" if len(x) > 8 else "center")
if spec.get("logx") and not categorical: ax.set_xscale("log")
if spec.get("logy"): ax.set_yscale("log")
if spec.get("title"): ax.set_title(spec["title"])
if spec.get("xlabel"): ax.set_xlabel(spec["xlabel"])
if spec.get("ylabel"): ax.set_ylabel(spec["ylabel"])
ax.grid(True, alpha=0.3)
if len(spec["series"]) > 1 or spec["series"][0].get("name"): ax.legend()
os.makedirs(os.path.dirname(spec["path"]) or ".", exist_ok=True)
fig.savefig(spec["path"], bbox_inches="tight")
print("saved", spec["path"], "points:", sum(min(len(xs), len(s["y"])) for s in spec["series"]))
`;
}

async function plotData(args: Record<string, unknown>, workspace: string, ctx: AppTurnContext, projectId: string, signal?: AbortSignal): Promise<AppToolResult> {
  const outPath = (typeof args.path === "string" && args.path.trim() ? args.path.trim() : `results/plot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`).replace(/\\/g, "/");
  safeResolve(workspace, outPath); // must stay inside the workspace

  let x: (number | string)[];
  let series: { name: string; y: (number | null)[] }[];

  if (args.source) {
    const source = String(args.source).replace(/\\/g, "/");
    const xCol = typeof args.x_column === "string" ? args.x_column : undefined;
    const yCols = (args.y_columns as string[] | undefined) ?? [];
    let loaded: LoadedTable;
    try {
      loaded = await openDataSource(workspace, source);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), `Could not open ${source}`);
    }
    ctx.filesRead.add(source);
    try {
      loaded.db.pragma("query_only = 1");
      const sql = typeof args.sql === "string" && args.sql.trim()
        ? args.sql.trim().replace(/;\s*$/, "")
        : `SELECT * FROM ${quoteIdent(loaded.tables[0] ?? "data")}`;
      const stmt = loaded.db.prepare(sql);
      if (!stmt.readonly) return fail("Only read-only queries are allowed.", "Query rejected");
      const rows = stmt.all() as Record<string, unknown>[];
      if (!rows.length) return fail("The query returned no rows.", "Nothing to plot");
      const cols = Object.keys(rows[0]);
      const missing = [...(xCol ? [xCol] : []), ...yCols].filter((c) => !cols.includes(c));
      if (missing.length) return fail(`Unknown column(s): ${missing.join(", ")}. Available: ${cols.join(", ")}`, "Bad column");
      const capped = rows.slice(0, 100_000);
      x = capped.map((r, i) => (xCol ? (r[xCol] as number | string) : i));
      series = yCols.map((c) => ({ name: c, y: capped.map((r) => (typeof r[c] === "number" ? (r[c] as number) : r[c] == null ? null : Number(r[c]))) }));
    } catch (err) {
      return fail(`SQL error: ${err instanceof Error ? err.message : String(err)}`, "Query failed");
    } finally {
      loaded.db.close();
    }
  } else {
    series = ((args.series as { name?: string; y: number[] }[]) ?? []).map((s, i) => ({ name: s.name ?? `series ${i + 1}`, y: s.y }));
    x = (args.x as (number | string)[] | undefined) ?? series[0].y.map((_, i) => i);
  }

  const spec: PlotSpec = {
    kind: (args.kind as PlotSpec["kind"]) ?? "line",
    title: args.title as string | undefined,
    xlabel: args.xlabel as string | undefined,
    ylabel: args.ylabel as string | undefined,
    logx: Boolean(args.logx),
    logy: Boolean(args.logy),
    x,
    series,
    path: outPath,
  };

  const run = await executeCode(
    { language: "python", code: buildPlotScript(spec), description: `plot_data → ${outPath}`, timeout_seconds: 120 },
    workspace, ctx, projectId, signal
  );
  if (!run.success) {
    const noMpl = /No module named 'matplotlib'/.test(run.output);
    return fail(
      noMpl ? "matplotlib is not available where python runs." : `The plot script failed:\n${clip(run.output, 3000)}`,
      "Plot failed",
      noMpl ? "Build the sandbox image (npm run sandbox:build) or pip install matplotlib on the host." : undefined
    );
  }
  const st = await fs.stat(safeResolve(workspace, outPath)).catch(() => null);
  if (!st) return fail(`The script ran but ${outPath} was not written.\n${clip(run.output, 2000)}`, "Plot missing");
  ctx.filesCreated.add(outPath);
  const url = imageUrl(projectId, outPath);
  return ok(
    `Saved ${spec.kind} chart to ${outPath} (${kb(st.size)}): ${series.length} series, ${x.length} points.${spec.title ? ` Title: ${spec.title}.` : ""} Reference it as ![${spec.title ?? "chart"}](${outPath}) in reports; inspect with view_image if needed.`,
    `Plotted ${outPath}`,
    { changedFile: outPath, extra: { images: [{ path: outPath, url, bytes: st.size }], path: outPath } }
  );
}

// ─── review_changes ────────────────────────────────────────────────────────────

async function git(workspace: string, argv: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", argv, { cwd: workspace, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  return stdout;
}

async function reviewChanges(args: Record<string, unknown>, workspace: string): Promise<AppToolResult> {
  const base = typeof args.base === "string" && args.base ? args.base : "HEAD";
  const maxChars = Math.min(40_000, Math.max(1000, Number(args.max_chars) || 12_000));
  let scope: string[] = [];
  if (typeof args.path === "string" && args.path.trim()) {
    const full = safeResolve(workspace, args.path);
    scope = ["--", path.relative(workspace, full).replace(/\\/g, "/") || "."];
  }
  try {
    await git(workspace, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return fail("This workspace is not a git repository.", "No git repo", "Run `git init` with run_command to start tracking changes.");
  }
  try {
    const [status, stat, diff] = await Promise.all([
      git(workspace, ["status", "--porcelain=v1", "--untracked-files=all", ...scope]),
      git(workspace, ["diff", "--stat", base, ...scope]),
      git(workspace, ["diff", base, ...scope]),
    ]);
    const untracked = status.split("\n").filter((l) => l.startsWith("??")).map((l) => l.slice(3));
    const changed = status.split("\n").filter((l) => l.trim() && !l.startsWith("??")).length;
    const lines = [
      `Changes vs ${base}${scope.length ? ` in ${scope[1]}` : ""}: ${changed} tracked file(s) modified, ${untracked.length} untracked.`,
      untracked.length ? `Untracked (not in the diff):\n${untracked.slice(0, 50).map((f) => `  ${f}`).join("\n")}${untracked.length > 50 ? `\n  …and ${untracked.length - 50} more` : ""}` : "",
      stat.trim() ? `--- stat ---\n${stat.trim()}` : "",
      "--- diff ---",
      diff.trim() ? clip(diff, maxChars) : "(no differences)",
    ].filter(Boolean);
    return ok(lines.join("\n"), `Reviewed changes vs ${base}: ${changed} modified, ${untracked.length} untracked`, {
      extra: { modified: changed, untracked: untracked.length, base },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(msg.split("\n")[0], "git diff failed", /unknown revision|bad revision/i.test(msg) ? "Use HEAD, HEAD~1 or a sha from /rewind." : undefined);
  }
}

// ─── Executor ──────────────────────────────────────────────────────────────────

export async function executeAppTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
  ctx: AppTurnContext,
  projectId: string,
  signal?: AbortSignal
): Promise<AppToolResult> {
  try {
    switch (name) {
      case "http_request": return await httpRequest(args, projectId, signal);
      case "query_data": return await queryData(args, workspace, ctx);
      case "plot_data": return await plotData(args, workspace, ctx, projectId, signal);
      case "review_changes": return await reviewChanges(args, workspace);
      default: return fail(`Unknown tool ${name}`, "Unknown tool");
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), `${name} failed`);
  }
}
