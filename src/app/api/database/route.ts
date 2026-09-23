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
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sql } = body as { sql: string; projectId?: string };

    if (!sql?.trim()) {
      return NextResponse.json({ error: "No SQL provided" }, { status: 400 });
    }

    const upperSql = sql.trim().toUpperCase();
    const isSelect = upperSql.startsWith("SELECT") || upperSql.startsWith("PRAGMA") || upperSql.startsWith("EXPLAIN");
    const isDml    = upperSql.startsWith("INSERT") || upperSql.startsWith("UPDATE") || upperSql.startsWith("DELETE");
    const isDdl    = upperSql.startsWith("DROP") || upperSql.startsWith("ALTER") || upperSql.startsWith("TRUNCATE");

    if (isDdl) {
      return NextResponse.json(
        { error: "DDL statements (DROP/ALTER/TRUNCATE) are not allowed." },
        { status: 403 }
      );
    }

    const db = getDb();
    const t0 = Date.now();

    if (isSelect) {
      const rows    = db.prepare(sql).all();
      const elapsed = Date.now() - t0;
      return NextResponse.json({ rows, elapsed_ms: elapsed, count: rows.length });
    }

    if (isDml) {
      const info    = db.prepare(sql).run();
      const elapsed = Date.now() - t0;
      return NextResponse.json({
        rows: [],
        elapsed_ms: elapsed,
        changes: info.changes,
        lastInsertRowid: String(info.lastInsertRowid),
      });
    }

    return NextResponse.json({ error: "Only SELECT, INSERT, UPDATE, DELETE are allowed." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
