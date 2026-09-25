import { NextRequest, NextResponse } from "next/server";
import { getDb, dbHealthCheck, projectDb, messageDb, usageDb, checkpointDb, toolLogDb } from "@/lib/db";

// ─── GET: full project data from SQLite ───────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId") || "default";
    const section   = searchParams.get("section");   // optional: messages|usage|tools|checkpoints|tables|overview

    const db = getDb();

    // ── DB health / table list ────────────────────────────────────────────────
    if (section === "health") {
      return NextResponse.json(dbHealthCheck());
    }

    // ── Overview stats for this project ──────────────────────────────────────
    if (!section || section === "overview") {
      const health    = dbHealthCheck();
      const usage     = usageDb.getSummaryByProject(projectId);
      const project   = projectDb.getById(projectId);
      type CountRow = { c: number } | undefined;
      const msgCount  = (db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id = ?").get(projectId) as CountRow)?.c ?? 0;
      const toolCount = (db.prepare("SELECT COUNT(*) AS c FROM tool_log WHERE project_id = ?").get(projectId) as CountRow)?.c ?? 0;
      const cpCount   = (db.prepare("SELECT COUNT(*) AS c FROM checkpoints WHERE project_id = ?").get(projectId) as CountRow)?.c ?? 0;

      // Per-table row counts + data
      const tables = health.tables.map((name: string) => {
        try {
          const row = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as CountRow;
          const data = db.prepare(`SELECT * FROM "${name}" LIMIT 100`).all() as Record<string, unknown>[];
          return { name, rows: row?.c ?? 0, data };
        } catch { return { name, rows: 0, data: [] }; }
      });

      return NextResponse.json({
        project,
        health,
        tables,
        stats: {
          messages:       msgCount,
          tool_calls:     toolCount,
          checkpoints:    cpCount,
          total_tokens:   usage?.total_tokens   ?? 0,
          total_cost_usd: usage?.total_cost_usd ?? 0,
          turn_count:     usage?.turn_count     ?? 0,
        },
      });
    }

    // ── Messages ──────────────────────────────────────────────────────────────
    if (section === "messages") {
      const limit  = parseInt(searchParams.get("limit")  ?? "100");
      const offset = parseInt(searchParams.get("offset") ?? "0");
      const rows   = messageDb.getByProject(projectId, { limit, offset });
      return NextResponse.json({ rows });
    }

    // ── LLM Usage log ─────────────────────────────────────────────────────────
    if (section === "usage") {
      const limit   = parseInt(searchParams.get("limit") ?? "100");
      const rows    = usageDb.getByProject(projectId, limit);
      const summary = usageDb.getSummaryByProject(projectId);
      const byModel = db.prepare(`
        SELECT model,
               COUNT(*) as calls,
               SUM(prompt_tokens) as prompt_tokens,
               SUM(completion_tokens) as completion_tokens,
               SUM(total_tokens) as total_tokens,
               SUM(cost_usd) as cost_usd
        FROM usage_log WHERE project_id = ?
        GROUP BY model ORDER BY total_tokens DESC
      `).all(projectId);
      return NextResponse.json({ rows, summary, byModel });
    }

    // ── Tool log ──────────────────────────────────────────────────────────────
    if (section === "tools") {
      const limit = parseInt(searchParams.get("limit") ?? "100");
      const rows  = db.prepare(
        "SELECT * FROM tool_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
      ).all(projectId, limit);
      const stats = toolLogDb.getStats(projectId);
      return NextResponse.json({ rows, stats });
    }

    // ── Checkpoints ───────────────────────────────────────────────────────────
    if (section === "checkpoints") {
      const rows = checkpointDb.getByProject(projectId);
      return NextResponse.json({ rows });
    }

    // ── Table listing with schema ─────────────────────────────────────────────
    if (section === "tables") {
      const health = dbHealthCheck();
      const tables = health.tables.map((name: string) => {
        try {
          const row  = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number } | undefined;
          const cols = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string; type: string }[];
          return {
            name,
            rows: row?.c ?? 0,
            columns: cols.map((c) => ({ name: c.name, type: c.type })),
          };
        } catch { return { name, rows: 0, columns: [] }; }
      });
      return NextResponse.json({ tables, size_bytes: health.size_bytes });
    }

    return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  } catch (error) {
    console.error("Database API Error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ─── POST: run a raw SQL query ────────────────────────────────────────────────
/**
 * Guarded SQL console. Rules:
 *  - exactly one statement (comments stripped, one trailing ";" allowed)
 *  - read-only by default (SELECT / WITH / EXPLAIN / read-form PRAGMA);
 *    INSERT/UPDATE/DELETE/REPLACE only when the body passes `allowWrite: true`
 *  - never: DDL (incl. CREATE TRIGGER), ATTACH/DETACH, VACUUM (INTO), PRAGMA assignments
 * Read-only is enforced finally via better-sqlite3's `stmt.readonly`.
 */
const STRING_LITERALS = /'(?:[^']|'')*'|"(?:[^"]|"")*"/g;

function stripSqlComments(sql: string): string {
  // Remove comments while leaving string literals intact.
  return sql.replace(
    /('(?:[^']|'')*'|"(?:[^"]|"")*")|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g,
    (_m, str: string | undefined) => (str ? str : " ")
  );
}

const FORBIDDEN = /\b(ATTACH|DETACH|VACUUM|DROP|ALTER|TRUNCATE|CREATE|REINDEX)\b/;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      sql?: unknown;
      projectId?: string;
      allowWrite?: unknown;
    };
    const rawSql = typeof body.sql === "string" ? body.sql : "";
    const allowWrite = body.allowWrite === true;

    const sql = stripSqlComments(rawSql).trim().replace(/;\s*$/, "").trim();
    if (!sql) {
      return NextResponse.json({ error: "No SQL provided" }, { status: 400 });
    }

    const upperSql = sql.replace(STRING_LITERALS, "''").toUpperCase();
    if (upperSql.includes(";")) {
      return NextResponse.json({ error: "Only a single SQL statement is allowed." }, { status: 400 });
    }
    if (FORBIDDEN.test(upperSql)) {
      return NextResponse.json(
        { error: "DDL, ATTACH/DETACH, VACUUM and trigger statements are not allowed." },
        { status: 403 }
      );
    }
    if (upperSql.startsWith("PRAGMA") && upperSql.includes("=")) {
      return NextResponse.json({ error: "PRAGMA assignments are not allowed." }, { status: 403 });
    }

    const isRead = /^(SELECT|WITH|EXPLAIN|PRAGMA)\b/.test(upperSql);
    const isDml  = /^(INSERT|UPDATE|DELETE|REPLACE)\b/.test(upperSql);
    if (!isRead && !isDml) {
      return NextResponse.json(
        { error: "Only SELECT/WITH/EXPLAIN/PRAGMA (or INSERT/UPDATE/DELETE with allowWrite) are allowed." },
        { status: 400 }
      );
    }

    const db = getDb();
    const stmt = db.prepare(sql);
    // Also catches writes hidden in WITH ... / PRAGMA forms.
    if (!stmt.readonly && !allowWrite) {
      return NextResponse.json(
        { error: "Write statements require allowWrite: true in the request body." },
        { status: 403 }
      );
    }

    const t0 = Date.now();
    if (stmt.reader) {
      const rows = stmt.all();
      return NextResponse.json({ rows, elapsed_ms: Date.now() - t0, count: rows.length });
    }

    const info = stmt.run();
    return NextResponse.json({
      rows: [],
      elapsed_ms: Date.now() - t0,
      changes: info.changes,
      lastInsertRowid: String(info.lastInsertRowid),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
