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
let _shutdownRegistered = false;

export function closeDb(): void {
  if (_db && _db.open) {
    try {
      _db.pragma('wal_checkpoint(TRUNCATE)');
      _db.close();
    } catch {
      // Ignore errors during exit
    } finally {
      _db = null;
    }
  }
}

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

  if (!_shutdownRegistered) {
    _shutdownRegistered = true;
    process.once('SIGINT', () => { closeDb(); });
    process.once('SIGTERM', () => { closeDb(); });
    process.once('beforeExit', () => { closeDb(); });
  }

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
  if (!projectCols.some((c) => c.name === 'user_id')) {
    db.exec('ALTER TABLE projects ADD COLUMN user_id TEXT');
  }
  if (!projectCols.some((c) => c.name === 'share_token')) {
    db.exec('ALTER TABLE projects ADD COLUMN share_token TEXT');
  }
  if (!projectCols.some((c) => c.name === 'is_public')) {
    db.exec('ALTER TABLE projects ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_projects_share_token ON projects(share_token)');

  const checkpointCols = db
    .prepare(`PRAGMA table_info(checkpoints)`)
    .all() as { name: string }[];
  if (!checkpointCols.some((c) => c.name === 'keep_messages_through_turn')) {
    db.exec(
      'ALTER TABLE checkpoints ADD COLUMN keep_messages_through_turn INTEGER'
    );
  }

  // Prompt tokens served from the provider's prompt cache (null = not reported)
  const usageCols = db
    .prepare(`PRAGMA table_info(usage_log)`)
    .all() as { name: string }[];
  if (!usageCols.some((c) => c.name === 'cached_tokens')) {
    db.exec('ALTER TABLE usage_log ADD COLUMN cached_tokens INTEGER');
  }

  // Open Chat: conversations and conversation messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id            TEXT PRIMARY KEY,
      user_id       TEXT,
      title         TEXT NOT NULL,
      model         TEXT NOT NULL,
      pinned        INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content         TEXT NOT NULL,
      thinking        TEXT,
      thinking_ms     INTEGER,
      artifacts       TEXT,
      model           TEXT,
      tokens_used     INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_convo ON conversation_messages(conversation_id, created_at ASC);
  `);

  const convMsgCols = db
    .prepare(`PRAGMA table_info(conversation_messages)`)
    .all() as { name: string }[];
  if (!convMsgCols.some((c) => c.name === 'attachments')) {
    db.exec('ALTER TABLE conversation_messages ADD COLUMN attachments TEXT');
  }
}

// ─── Schema ──────────────────────────────────────────────────────────────────
const SCHEMA = `
  -- Users
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  -- Sessions
  CREATE TABLE IF NOT EXISTS sessions (
    token         TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at    INTEGER NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

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
    user_id     TEXT,
    share_token TEXT,
    is_public   INTEGER NOT NULL DEFAULT 0,
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

  -- Scheduled agent runs (cron, evaluated in server-local time)
  CREATE TABLE IF NOT EXISTS schedules (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cron        TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    model       TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    next_run_at INTEGER,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  -- Conversations (Open Chat)
  CREATE TABLE IF NOT EXISTS conversations (
    id            TEXT PRIMARY KEY,
    user_id       TEXT,
    title         TEXT NOT NULL,
    model         TEXT NOT NULL,
    pinned        INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  -- Conversation Messages (Open Chat)
  CREATE TABLE IF NOT EXISTS conversation_messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content         TEXT NOT NULL,
    thinking        TEXT,        -- Collapsible reasoning content (Claude 3.7 / R1 style)
    thinking_ms     INTEGER,     -- Time taken to think in milliseconds
    artifacts       TEXT,        -- JSON array of ExtractedArtifact
    model           TEXT,
    tokens_used     INTEGER,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_conversations_user
    ON conversations(user_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_conversation_messages_convo
    ON conversation_messages(conversation_id, created_at ASC);

  CREATE INDEX IF NOT EXISTS idx_schedules_due
    ON schedules(enabled, next_run_at);

  CREATE INDEX IF NOT EXISTS idx_messages_project
    ON messages(project_id, turn_index, created_at);

  CREATE INDEX IF NOT EXISTS idx_checkpoints_project
    ON checkpoints(project_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_usage_project
    ON usage_log(project_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_tool_log_project
    ON tool_log(project_id, turn_index, created_at);

  CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON sessions(user_id);
`;

// ─── Types ───────────────────────────────────────────────────────────────────
export interface DbUser {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  created_at: number;
  updated_at: number;
}

export interface DbSession {
  token: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}

export interface DbProject {
  id: string;
  name: string;
  workspace: string;
  description: string | null;
  kind: 'app' | 'build';
  user_id?: string | null;
  share_token?: string | null;
  is_public?: number;
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
  cached_tokens?: number | null;
}

// ─── User queries ────────────────────────────────────────────────────────────
export const userDb = {
  getById(id: string): DbUser | undefined {
    return getDb()
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as DbUser | undefined;
  },

  getByEmail(email: string): DbUser | undefined {
    return getDb()
      .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)')
      .get(email.trim()) as DbUser | undefined;
  },

  create(user: { id: string; email: string; name: string; password_hash: string; role?: string }): DbUser {
    const now = Date.now();
    getDb()
      .prepare(`
        INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
        VALUES (@id, @email, @name, @password_hash, @role, @created_at, @updated_at)
      `)
      .run({
        id: user.id,
        email: user.email.toLowerCase().trim(),
        name: user.name.trim(),
        password_hash: user.password_hash,
        role: user.role ?? 'user',
        created_at: now,
        updated_at: now,
      });
    return this.getById(user.id)!;
  },

  getAll(): DbUser[] {
    return getDb()
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all() as DbUser[];
  },
};

// ─── Session queries ─────────────────────────────────────────────────────────
export const sessionDb = {
  create(token: string, userId: string, ttlMs: number = 7 * 24 * 60 * 60 * 1000): DbSession {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    getDb()
      .prepare(`
        INSERT INTO sessions (token, user_id, expires_at, created_at)
        VALUES (@token, @user_id, @expires_at, @created_at)
      `)
      .run({ token, user_id: userId, expires_at: expiresAt, created_at: now });
    return { token, user_id: userId, expires_at: expiresAt, created_at: now };
  },

  get(token: string): (DbSession & { user: Omit<DbUser, 'password_hash'> }) | undefined {
    const row = getDb()
      .prepare(`
        SELECT s.token, s.user_id, s.expires_at, s.created_at,
               u.id as u_id, u.email as u_email, u.name as u_name, u.role as u_role,
               u.created_at as u_created_at, u.updated_at as u_updated_at
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > ?
      `)
      .get(token, Date.now()) as {
        token: string;
        user_id: string;
        expires_at: number;
        created_at: number;
        u_id: string;
        u_email: string;
        u_name: string;
        u_role: string;
        u_created_at: number;
        u_updated_at: number;
      } | undefined;
    if (!row) return undefined;
    return {
      token: row.token,
      user_id: row.user_id,
      expires_at: row.expires_at,
      created_at: row.created_at,
      user: {
        id: row.u_id,
        email: row.u_email,
        name: row.u_name,
        role: row.u_role,
        created_at: row.u_created_at,
        updated_at: row.u_updated_at,
      },
    };
  },

  delete(token: string): void {
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },

  cleanExpired(): void {
    getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  },
};

// ─── Project queries ─────────────────────────────────────────────────────────
export const projectDb = {
  getAll(): DbProject[] {
    return getDb()
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all() as DbProject[];
  },

  getByUserId(userId: string): DbProject[] {
    return getDb()
      .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId) as DbProject[];
  },

  getByShareToken(shareToken: string): DbProject | undefined {
    return getDb()
      .prepare('SELECT * FROM projects WHERE share_token = ?')
      .get(shareToken) as DbProject | undefined;
  },

  getById(id: string): DbProject | undefined {
    return getDb()
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as DbProject | undefined;
  },

  create(
    project: Omit<DbProject, 'created_at' | 'updated_at' | 'kind'> & {
      kind?: 'app' | 'build';
      user_id?: string | null;
      share_token?: string | null;
      is_public?: number;
    }
  ): void {
    const now = Date.now();
    getDb()
      .prepare(`
        INSERT INTO projects (id, name, workspace, description, kind, user_id, share_token, is_public, created_at, updated_at)
        VALUES (@id, @name, @workspace, @description, @kind, @user_id, @share_token, @is_public, @created_at, @updated_at)
      `)
      .run({
        kind: 'app',
        user_id: null,
        share_token: null,
        is_public: 0,
        ...project,
        created_at: now,
        updated_at: now,
      });
  },

  setShare(id: string, isPublic: boolean, shareToken?: string | null): void {
    getDb()
      .prepare('UPDATE projects SET is_public = ?, share_token = ?, updated_at = ? WHERE id = ?')
      .run(isPublic ? 1 : 0, shareToken ?? null, Date.now(), id);
  },

  update(
    id: string,
    fields: Partial<Pick<DbProject, 'name' | 'description' | 'user_id'>>
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

  /** Highest seq already stored for a turn (-1 when none), so batches
   *  persisted at different times keep their order. */
  getMaxSeq(projectId: string, turnIndex: number): number {
    const row = getDb()
      .prepare('SELECT MAX(seq) as max_seq FROM messages WHERE project_id = ? AND turn_index = ?')
      .get(projectId, turnIndex) as { max_seq: number | null };
    return row?.max_seq ?? -1;
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
           total_tokens, cost_usd, turn_index, created_at, cached_tokens)
        VALUES
          (@id, @project_id, @model, @prompt_tokens, @completion_tokens,
           @total_tokens, @cost_usd, @turn_index, @created_at, @cached_tokens)
      `)
      .run({
        ...entry,
        cached_tokens: entry.cached_tokens ?? null,
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

  /** Token totals per model for one project (drives /cost and /usage). */
  getModelBreakdown(projectId: string): {
    model: string;
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
  }[] {
    return getDb()
      .prepare(`
        SELECT
          model,
          COUNT(*)                            AS requests,
          COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
          COALESCE(SUM(cost_usd), 0)          AS cost_usd
        FROM usage_log
        WHERE project_id = ?
        GROUP BY model
        ORDER BY prompt_tokens + completion_tokens DESC
      `)
      .all(projectId) as {
        model: string;
        requests: number;
        prompt_tokens: number;
        completion_tokens: number;
        cost_usd: number;
      }[];
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

// ─── Schedule queries ─────────────────────────────────────────────────────────
export interface DbSchedule {
  id: string;
  project_id: string;
  cron: string;
  prompt: string;
  model: string | null;
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number;
}

export const scheduleDb = {
  list(projectId?: string): DbSchedule[] {
    const db = getDb();
    return (projectId
      ? db.prepare('SELECT * FROM schedules WHERE project_id = ? ORDER BY created_at ASC').all(projectId)
      : db.prepare('SELECT * FROM schedules ORDER BY created_at ASC').all()) as DbSchedule[];
  },

  get(id: string): DbSchedule | undefined {
    return getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id) as DbSchedule | undefined;
  },

  /** Enabled schedules whose next run is at or before `now`. */
  due(now: number): DbSchedule[] {
    return getDb()
      .prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC')
      .all(now) as DbSchedule[];
  },

  create(s: Pick<DbSchedule, 'id' | 'project_id' | 'cron' | 'prompt' | 'model' | 'next_run_at'>): void {
    getDb()
      .prepare(`
        INSERT INTO schedules (id, project_id, cron, prompt, model, enabled, last_run_at, next_run_at, created_at)
        VALUES (@id, @project_id, @cron, @prompt, @model, 1, NULL, @next_run_at, @created_at)
      `)
      .run({ ...s, created_at: Date.now() });
  },

  setEnabled(id: string, enabled: boolean, nextRunAt: number | null): boolean {
    return getDb()
      .prepare('UPDATE schedules SET enabled = ?, next_run_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, nextRunAt, id).changes > 0;
  },

  markRun(id: string, lastRunAt: number, nextRunAt: number | null): void {
    getDb()
      .prepare('UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?')
      .run(lastRunAt, nextRunAt, id);
  },

  delete(id: string): boolean {
    return getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
  },
};

// ─── Open Chat queries ───────────────────────────────────────────────────────
export interface DbConversation {
  id: string;
  user_id?: string | null;
  title: string;
  model: string;
  pinned: number;
  created_at: number;
  updated_at: number;
}

export interface ExtractedArtifact {
  id: string;
  title: string;
  type: 'html' | 'svg' | 'react' | 'markdown' | 'mermaid' | 'code';
  language?: string;
  content: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  dataUrl?: string;
  textContent?: string;
  isImage?: boolean;
}

export interface DbConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string | null;
  thinking_ms?: number | null;
  artifacts?: string | null; // JSON string of ExtractedArtifact[]
  attachments?: string | null; // JSON string of ChatAttachment[]
  model?: string | null;
  tokens_used?: number | null;
  created_at: number;
}

export const conversationDb = {
  list(userId?: string | null): DbConversation[] {
    const db = getDb();
    if (userId) {
      return db
        .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC')
        .all(userId) as DbConversation[];
    }
    return db
      .prepare('SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC')
      .all() as DbConversation[];
  },

  get(id: string): (DbConversation & { messages: DbConversationMessage[] }) | undefined {
    const db = getDb();
    const convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as DbConversation | undefined;
    if (!convo) return undefined;
    const messages = db
      .prepare('SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(id) as DbConversationMessage[];
    return { ...convo, messages };
  },

  create(params: {
    id?: string;
    user_id?: string | null;
    title: string;
    model: string;
    pinned?: boolean;
  }): DbConversation {
    const id = params.id || crypto.randomUUID();
    const now = Date.now();
    getDb()
      .prepare(`
        INSERT INTO conversations (id, user_id, title, model, pinned, created_at, updated_at)
        VALUES (@id, @user_id, @title, @model, @pinned, @created_at, @updated_at)
      `)
      .run({
        id,
        user_id: params.user_id ?? null,
        title: params.title,
        model: params.model,
        pinned: params.pinned ? 1 : 0,
        created_at: now,
        updated_at: now,
      });

    return {
      id,
      user_id: params.user_id ?? null,
      title: params.title,
      model: params.model,
      pinned: params.pinned ? 1 : 0,
      created_at: now,
      updated_at: now,
    };
  },

  update(id: string, updates: { title?: string; pinned?: boolean; model?: string }): boolean {
    const fields: string[] = ['updated_at = ?'];
    const values: (string | number)[] = [Date.now()];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.pinned !== undefined) {
      fields.push('pinned = ?');
      values.push(updates.pinned ? 1 : 0);
    }
    if (updates.model !== undefined) {
      fields.push('model = ?');
      values.push(updates.model);
    }

    values.push(id);
    const stmt = getDb().prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`);
    return stmt.run(...values).changes > 0;
  },

  delete(id: string): boolean {
    return getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
  },

  addMessage(msg: {
    id?: string;
    conversation_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    thinking?: string | null;
    thinking_ms?: number | null;
    artifacts?: ExtractedArtifact[] | null;
    attachments?: ChatAttachment[] | string | null;
    model?: string | null;
    tokens_used?: number | null;
  }): DbConversationMessage {
    const id = msg.id || crypto.randomUUID();
    const now = Date.now();
    const artifactsJson = msg.artifacts ? JSON.stringify(msg.artifacts) : null;
    const attachmentsJson = msg.attachments
      ? (typeof msg.attachments === 'string' ? msg.attachments : JSON.stringify(msg.attachments))
      : null;

    getDb()
      .prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, thinking, thinking_ms, artifacts, attachments, model, tokens_used, created_at)
        VALUES (@id, @conversation_id, @role, @content, @thinking, @thinking_ms, @artifacts, @attachments, @model, @tokens_used, @created_at)
      `)
      .run({
        id,
        conversation_id: msg.conversation_id,
        role: msg.role,
        content: msg.content,
        thinking: msg.thinking ?? null,
        thinking_ms: msg.thinking_ms ?? null,
        artifacts: artifactsJson,
        attachments: attachmentsJson,
        model: msg.model ?? null,
        tokens_used: msg.tokens_used ?? null,
        created_at: now,
      });

    // Touch conversation updated_at
    getDb()
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(now, msg.conversation_id);

    return {
      id,
      conversation_id: msg.conversation_id,
      role: msg.role,
      content: msg.content,
      thinking: msg.thinking ?? null,
      thinking_ms: msg.thinking_ms ?? null,
      artifacts: artifactsJson,
      attachments: attachmentsJson,
      model: msg.model ?? null,
      tokens_used: msg.tokens_used ?? null,
      created_at: now,
    };
  },

  clearMessages(conversationId: string): void {
    getDb()
      .prepare('DELETE FROM conversation_messages WHERE conversation_id = ?')
      .run(conversationId);
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
