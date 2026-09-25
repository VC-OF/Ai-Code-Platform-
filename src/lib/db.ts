import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { computeCostUsd } from './models';

// ─── Setup ───────────────────────────────────────────────────────────────────
const PLATFORM_DIR = path.join(process.cwd(), '.platform');
const DB_PATH = path.join(PLATFORM_DIR, 'open-code.db');

fs.mkdirSync(PLATFORM_DIR, { recursive: true });

// ─── Singleton ───────────────────────────────────────────────────────────────
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);

  // Performance + safety pragmas
  _db.pragma('journal_mode = WAL');     // Better concurrency
  _db.pragma('synchronous = NORMAL');   // Faster writes, still safe
  _db.pragma('foreign_keys = ON');      // Enforce FK constraints
  _db.pragma('temp_store = MEMORY');    // Temp tables in memory
  _db.pragma('mmap_size = 268435456'); // 256MB memory map

  _db.exec(SCHEMA);
  runMigrations(_db);

  return _db;
}

// Additive migrations for databases created before a schema change
function runMigrations(db: Database.Database) {
  const messageCols = db
    .prepare(`PRAGMA table_info(messages)`)
    .all() as { name: string }[];
  if (!messageCols.some((c) => c.name === 'seq')) {
    db.exec('ALTER TABLE messages ADD COLUMN seq INTEGER NOT NULL DEFAULT 0');
  }

  const projectCols = db
    .prepare(`PRAGMA table_info(projects)`)
    .all() as { name: string }[];
  if (!projectCols.some((c) => c.name === 'kind')) {
    db.exec("ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'app'");
  }

  const checkpointCols = db
    .prepare(`PRAGMA table_info(checkpoints)`)
    .all() as { name: string }[];
  if (!checkpointCols.some((c) => c.name === 'keep_messages_through_turn')) {
    db.exec(
      'ALTER TABLE checkpoints ADD COLUMN keep_messages_through_turn INTEGER'
    );
  }
}

// ─── Schema ──────────────────────────────────────────────────────────────────
const SCHEMA = `
  -- Projects
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    workspace   TEXT NOT NULL UNIQUE,
    description TEXT,
    -- 'app': managed sandbox under workspaces/<id>, scaffolded from a
    -- template. 'build': points at an arbitrary existing folder on disk
    -- (Build Mode) — no template, no preview/deploy assumptions.
    kind        TEXT NOT NULL DEFAULT 'app' CHECK(kind IN ('app', 'build')),
    created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  -- Chat messages
  CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
    content       TEXT NOT NULL,
    tool_calls    TEXT,     -- JSON array of tool calls
    tool_call_id  TEXT,     -- For tool result messages
    tool_name     TEXT,     -- Tool name for tool results
    turn_index    INTEGER NOT NULL DEFAULT 0,
    seq           INTEGER NOT NULL DEFAULT 0,  -- Stable order within a turn
    tokens_used   INTEGER,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  -- Git checkpoints
  CREATE TABLE IF NOT EXISTS checkpoints (
    sha           TEXT NOT NULL,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    message       TEXT,
    files_changed INTEGER NOT NULL DEFAULT 0,
    insertions    INTEGER NOT NULL DEFAULT 0,
    deletions     INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    PRIMARY KEY (sha, project_id)
  );

  -- LLM usage tracking
  CREATE TABLE IF NOT EXISTS usage_log (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    model             TEXT NOT NULL,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens      INTEGER NOT NULL DEFAULT 0,
    cost_usd          REAL NOT NULL DEFAULT 0,
    turn_index        INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  -- Tool execution log
  CREATE TABLE IF NOT EXISTS tool_log (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tool_name   TEXT NOT NULL,
    args        TEXT,        -- JSON
    result      TEXT,        -- JSON summary
    success     INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    turn_index  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  -- Agent plan (one live task list per project, survives turns)
  CREATE TABLE IF NOT EXISTS project_plans (
    project_id  TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    tasks       TEXT NOT NULL,   -- JSON array of {id, title, status}
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_messages_project
    ON messages(project_id, turn_index, created_at);

  CREATE INDEX IF NOT EXISTS idx_checkpoints_project
    ON checkpoints(project_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_usage_project
    ON usage_log(project_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_tool_log_project
    ON tool_log(project_id, turn_index, created_at);
`;

// ─── Types ───────────────────────────────────────────────────────────────────
export interface DbProject {
  id: string;
  name: string;
  workspace: string;
  description: string | null;
  kind: 'app' | 'build';
  created_at: number;
  updated_at: number;
}

export interface DbMessage {
  id: string;
  project_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  turn_index: number;
  seq: number;
  tokens_used: number | null;
  created_at: number;
}

export interface DbCheckpoint {
  sha: string;
  project_id: string;
  message: string | null;
  files_changed: number;
  insertions: number;
  deletions: number;
  /** Chat rewind watermark: reverting to this checkpoint keeps messages
   *  with turn_index <= this value (null = no rewind info) */
  keep_messages_through_turn: number | null;
  created_at: number;
}

export interface DbUsageLog {
  id: string;
  project_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  turn_index: number;
  created_at: number;
}

// ─── Project queries ─────────────────────────────────────────────────────────
export const projectDb = {
  getAll(): DbProject[] {
    return getDb()
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all() as DbProject[];
  },

  getById(id: string): DbProject | undefined {
    return getDb()
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as DbProject | undefined;
  },

  create(
    project: Omit<DbProject, 'created_at' | 'updated_at' | 'kind'> & {
      kind?: 'app' | 'build';
    }
  ): void {
    const now = Date.now();
    getDb()
      .prepare(`
        INSERT INTO projects (id, name, workspace, description, kind, created_at, updated_at)
        VALUES (@id, @name, @workspace, @description, @kind, @created_at, @updated_at)
      `)
      .run({ kind: 'app', ...project, created_at: now, updated_at: now });
  },

  update(
    id: string,
    fields: Partial<Pick<DbProject, 'name' | 'description'>>
  ): void {
    const sets = Object.keys(fields)
      .map((k) => `${k} = @${k}`)
      .join(', ');
    getDb()
      .prepare(
        `UPDATE projects SET ${sets}, updated_at = @updated_at WHERE id = @id`
      )
      .run({ ...fields, updated_at: Date.now(), id });
  },

  touch(id: string): void {
    getDb()
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(Date.now(), id);
  },

  delete(id: string): void {
    // Cascades to messages, checkpoints, usage_log, tool_log
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
  },
};

// ─── Message queries ─────────────────────────────────────────────────────────
export const messageDb = {
  getByProject(
    projectId: string,
    opts: { limit?: number; offset?: number } = {}
  ): DbMessage[] {
    const { limit = 500, offset = 0 } = opts;
    return getDb()
      .prepare(`
        SELECT * FROM messages
        WHERE project_id = ?
        ORDER BY turn_index ASC, seq ASC, created_at ASC
        LIMIT ? OFFSET ?
      `)
      .all(projectId, limit, offset) as DbMessage[];
  },

  /** The most recent `limit` messages, in chronological order. */
  getRecent(projectId: string, limit = 300): DbMessage[] {
    const rows = getDb()
      .prepare(`
        SELECT * FROM messages
        WHERE project_id = ?
        ORDER BY turn_index DESC, seq DESC, created_at DESC
        LIMIT ?
      `)
      .all(projectId, limit) as DbMessage[];
    return rows.reverse();
  },

  getByTurn(projectId: string, turnIndex: number): DbMessage[] {
    return getDb()
      .prepare(`
        SELECT * FROM messages
        WHERE project_id = ? AND turn_index = ?
        ORDER BY created_at ASC
      `)
      .all(projectId, turnIndex) as DbMessage[];
  },

  insert(msg: Omit<DbMessage, 'created_at' | 'seq'> & { seq?: number }): void {
    getDb()
      .prepare(`
        INSERT INTO messages (
          id, project_id, role, content,
          tool_calls, tool_call_id, tool_name,
          turn_index, seq, tokens_used, created_at
        ) VALUES (
          @id, @project_id, @role, @content,
          @tool_calls, @tool_call_id, @tool_name,
          @turn_index, @seq, @tokens_used, @created_at
        )
      `)
      .run({ seq: 0, ...msg, created_at: Date.now() });
  },

  insertMany(msgs: (Omit<DbMessage, 'created_at' | 'seq'> & { seq?: number })[]): void {
    const stmt = getDb().prepare(`
      INSERT INTO messages (
        id, project_id, role, content,
        tool_calls, tool_call_id, tool_name,
        turn_index, seq, tokens_used, created_at
      ) VALUES (
        @id, @project_id, @role, @content,
        @tool_calls, @tool_call_id, @tool_name,
        @turn_index, @seq, @tokens_used, @created_at
      )
    `);

    const now = Date.now();
    const insertAll = getDb().transaction(
      (rows: (Omit<DbMessage, 'created_at' | 'seq'> & { seq?: number })[]) => {
        rows.forEach((row, i) => {
          stmt.run({ seq: i, ...row, created_at: now });
        });
      }
    );

    insertAll(msgs);
  },

  clearProject(projectId: string): void {
    getDb()
      .prepare('DELETE FROM messages WHERE project_id = ?')
      .run(projectId);
  },

  getLatestTurnIndex(projectId: string): number {
    const row = getDb()
      .prepare(
        'SELECT MAX(turn_index) as max_turn FROM messages WHERE project_id = ?'
      )
      .get(projectId) as { max_turn: number | null };
    return row?.max_turn ?? 0;
  },

  /** Rewind: drop all messages after the given turn (chat follows the
   *  workspace when a checkpoint is restored). Returns rows deleted. */
  deleteAfterTurn(projectId: string, keepThroughTurn: number): number {
    return getDb()
      .prepare(
        'DELETE FROM messages WHERE project_id = ? AND turn_index > ?'
      )
      .run(projectId, keepThroughTurn).changes;
  },
};

// ─── Checkpoint queries ───────────────────────────────────────────────────────
export const checkpointDb = {
  getByProject(
    projectId: string,
    limit = 50
  ): DbCheckpoint[] {
    return getDb()
      .prepare(`
        SELECT * FROM checkpoints
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(projectId, limit) as DbCheckpoint[];
  },

  insert(
    cp: Omit<DbCheckpoint, 'created_at' | 'keep_messages_through_turn'> & {
      keep_messages_through_turn?: number | null;
    }
  ): void {
    getDb()
      .prepare(`
        INSERT OR REPLACE INTO checkpoints
          (sha, project_id, message, files_changed, insertions, deletions,
           keep_messages_through_turn, created_at)
        VALUES
          (@sha, @project_id, @message, @files_changed, @insertions, @deletions,
           @keep_messages_through_turn, @created_at)
      `)
      .run({
        keep_messages_through_turn: null,
        ...cp,
        created_at: Date.now(),
      });
  },

  getBySha(sha: string, projectId: string): DbCheckpoint | undefined {
    return getDb()
      .prepare(
        'SELECT * FROM checkpoints WHERE sha = ? AND project_id = ?'
      )
      .get(sha, projectId) as DbCheckpoint | undefined;
  },
};

// ─── Usage queries ────────────────────────────────────────────────────────────
export const usageDb = {
  insert(entry: Omit<DbUsageLog, 'id' | 'created_at' | 'cost_usd' | 'total_tokens'>): void {
    const cost_usd = computeCostUsd(
      entry.model,
      entry.prompt_tokens,
      entry.completion_tokens
    );

    getDb()
      .prepare(`
        INSERT INTO usage_log
          (id, project_id, model, prompt_tokens, completion_tokens,
           total_tokens, cost_usd, turn_index, created_at)
        VALUES
          (@id, @project_id, @model, @prompt_tokens, @completion_tokens,
           @total_tokens, @cost_usd, @turn_index, @created_at)
      `)
      .run({
        ...entry,
        id: crypto.randomUUID(),
        total_tokens: entry.prompt_tokens + entry.completion_tokens,
        cost_usd,
        created_at: Date.now(),
      });
  },

  getSummaryByProject(projectId: string): {
    total_tokens: number;
    total_cost_usd: number;
    turn_count: number;
  } {
    return getDb()
      .prepare(`
        SELECT
          COALESCE(SUM(total_tokens), 0)  AS total_tokens,
          COALESCE(SUM(cost_usd), 0)      AS total_cost_usd,
          COUNT(DISTINCT turn_index)      AS turn_count
        FROM usage_log
        WHERE project_id = ?
      `)
      .get(projectId) as {
        total_tokens: number;
        total_cost_usd: number;
        turn_count: number;
      };
  },

  getByProject(projectId: string, limit = 100): DbUsageLog[] {
    return getDb()
      .prepare(`
        SELECT * FROM usage_log
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(projectId, limit) as DbUsageLog[];
  },
};

// ─── Plan queries ─────────────────────────────────────────────────────────────
export interface PlanTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export const planDb = {
  get(projectId: string): PlanTask[] {
    const row = getDb()
      .prepare('SELECT tasks FROM project_plans WHERE project_id = ?')
      .get(projectId) as { tasks: string } | undefined;
    if (!row) return [];
    try {
      return JSON.parse(row.tasks) as PlanTask[];
    } catch {
      return [];
    }
  },

  set(projectId: string, tasks: PlanTask[]): void {
    getDb()
      .prepare(`
        INSERT INTO project_plans (project_id, tasks, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET tasks = excluded.tasks, updated_at = excluded.updated_at
      `)
      .run(projectId, JSON.stringify(tasks), Date.now());
  },

  clear(projectId: string): void {
    getDb()
      .prepare('DELETE FROM project_plans WHERE project_id = ?')
      .run(projectId);
  },
};

// ─── Tool log queries ─────────────────────────────────────────────────────────
export const toolLogDb = {
  insert(entry: {
    project_id: string;
    tool_name: string;
    args?: unknown;
    result?: unknown;
    success: boolean;
    duration_ms: number;
    turn_index: number;
  }): void {
    getDb()
      .prepare(`
        INSERT INTO tool_log
          (id, project_id, tool_name, args, result, success, duration_ms, turn_index, created_at)
        VALUES
          (@id, @project_id, @tool_name, @args, @result, @success, @duration_ms, @turn_index, @created_at)
      `)
      .run({
        id: crypto.randomUUID(),
        project_id: entry.project_id,
        tool_name: entry.tool_name,
        args: entry.args ? JSON.stringify(entry.args) : null,
        result: entry.result ? JSON.stringify(entry.result) : null,
        success: entry.success ? 1 : 0,
        duration_ms: entry.duration_ms,
        turn_index: entry.turn_index,
        created_at: Date.now(),
      });
  },

  getStats(projectId: string): {
    tool_name: string;
    call_count: number;
    success_count: number;
    avg_duration_ms: number;
  }[] {
    return getDb()
      .prepare(`
        SELECT
          tool_name,
          COUNT(*) AS call_count,
          SUM(success) AS success_count,
          AVG(duration_ms) AS avg_duration_ms
        FROM tool_log
        WHERE project_id = ?
        GROUP BY tool_name
        ORDER BY call_count DESC
      `)
      .all(projectId) as {
        tool_name: string;
        call_count: number;
        success_count: number;
        avg_duration_ms: number;
      }[];
  },
};

// ─── Health check ─────────────────────────────────────────────────────────────
export function dbHealthCheck(): {
  ok: boolean;
  tables: string[];
  size_bytes: number;
} {
  try {
    const tables = getDb()
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      )
      .all()
      .map((r) => (r as { name: string }).name);

    const stat = fs.statSync(DB_PATH);

    return { ok: true, tables, size_bytes: stat.size };
  } catch {
    return { ok: false, tables: [], size_bytes: 0 };
  }
}
