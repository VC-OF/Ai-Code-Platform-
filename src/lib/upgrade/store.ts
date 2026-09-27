import crypto from 'crypto';
import { getDb } from '../db';

/**
 * Persistence for "Upgrade OpenCode" runs. Part of the protected core:
 * candidates may not modify anything under src/lib/upgrade/ (see guard.ts).
 */

export type UpgradeStatus =
  | 'analyzing' | 'analyzed'
  | 'developing' | 'reviewing' | 'verifying'
  | 'ready' | 'rejected' | 'inconclusive'
  | 'committed' | 'pushed'
  | 'failed' | 'discarded';

export type GateResult = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type Risk = 'low' | 'medium' | 'high';

export interface GateCheck {
  name: string;
  result: GateResult;
  detail: string;
}

export interface UpgradeRecord {
  id: string;
  goal: string;
  status: UpgradeStatus;
  base_commit: string;
  base_branch: string;
  candidate_branch: string;
  worktree: string;
  project_id: string;
  analysis: string | null;
  affected_areas: string | null; // JSON string[]
  proposed_plan: string | null;  // JSON string[]
  risk: Risk | null;
  gate_result: GateResult | null;
  gate_checks: string | null;    // JSON GateCheck[]
  /** sha256 of the candidate diff the gate evaluated; commit refuses if it changed */
  gate_diff_hash: string | null;
  candidate_commit: string | null;
  pr_url: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface UpgradeChange { upgrade_id: string; path: string; additions: number; deletions: number; status: string }
export interface UpgradeTest {
  upgrade_id: string; target: 'base' | 'candidate'; command: string;
  passed: number; failed: number; skipped: number; total: number; exit_code: number | null; output: string; created_at: number;
}
export interface UpgradeReview { upgrade_id: string; verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; findings: string; reviewer: string; created_at: number }

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS upgrades (
    id               TEXT PRIMARY KEY,
    goal             TEXT NOT NULL,
    status           TEXT NOT NULL,
    base_commit      TEXT NOT NULL,
    base_branch      TEXT NOT NULL,
    candidate_branch TEXT NOT NULL,
    worktree         TEXT NOT NULL,
    project_id       TEXT NOT NULL,
    analysis         TEXT,
    affected_areas   TEXT,
    proposed_plan    TEXT,
    risk             TEXT,
    gate_result      TEXT,
    gate_checks      TEXT,
    gate_diff_hash   TEXT,
    candidate_commit TEXT,
    pr_url           TEXT,
    error            TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    completed_at     INTEGER
  );
  CREATE TABLE IF NOT EXISTS upgrade_changes (
    upgrade_id TEXT NOT NULL REFERENCES upgrades(id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    additions  INTEGER NOT NULL,
    deletions  INTEGER NOT NULL,
    status     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS upgrade_tests (
    upgrade_id TEXT NOT NULL REFERENCES upgrades(id) ON DELETE CASCADE,
    target     TEXT NOT NULL,
    command    TEXT NOT NULL,
    passed     INTEGER NOT NULL,
    failed     INTEGER NOT NULL,
    skipped    INTEGER NOT NULL,
    total      INTEGER NOT NULL,
    exit_code  INTEGER,
    output     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS upgrade_review (
    upgrade_id TEXT NOT NULL REFERENCES upgrades(id) ON DELETE CASCADE,
    verdict    TEXT NOT NULL,
    findings   TEXT NOT NULL,
    reviewer   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(SCHEMA);
    ready = true;
  }
  return d;
}

/** UPG-20260927-001 style ids: date + per-day sequence. */
export function nextUpgradeId(now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `upg-${day}-`;
  const rows = db().prepare('SELECT id FROM upgrades WHERE id LIKE ?').all(`${prefix}%`) as { id: string }[];
  const max = rows.reduce((m, r) => Math.max(m, Number(r.id.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export const upgradeStore = {
  create(rec: Omit<UpgradeRecord, 'created_at' | 'updated_at' | 'completed_at' | 'analysis' | 'affected_areas' | 'proposed_plan' | 'risk' | 'gate_result' | 'gate_checks' | 'gate_diff_hash' | 'candidate_commit' | 'pr_url' | 'error'>): UpgradeRecord {
    const now = Date.now();
    db().prepare(`
      INSERT INTO upgrades (id, goal, status, base_commit, base_branch, candidate_branch, worktree, project_id, created_at, updated_at)
      VALUES (@id, @goal, @status, @base_commit, @base_branch, @candidate_branch, @worktree, @project_id, @now, @now)
    `).run({ ...rec, now });
    return this.get(rec.id)!;
  },

  get(id: string): UpgradeRecord | undefined {
    return db().prepare('SELECT * FROM upgrades WHERE id = ?').get(id) as UpgradeRecord | undefined;
  },

  list(): UpgradeRecord[] {
    return db().prepare('SELECT * FROM upgrades ORDER BY created_at DESC').all() as UpgradeRecord[];
  },

  update(id: string, fields: Partial<Omit<UpgradeRecord, 'id' | 'created_at'>>): UpgradeRecord {
    const keys = Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined);
    if (keys.length) {
      const set = keys.map((k) => `${k} = @${k}`).join(', ');
      db().prepare(`UPDATE upgrades SET ${set}, updated_at = @__now WHERE id = @__id`).run({ ...fields, __now: Date.now(), __id: id });
    }
    return this.get(id)!;
  },

  setChanges(id: string, changes: Omit<UpgradeChange, 'upgrade_id'>[]): void {
    const d = db();
    d.transaction(() => {
      d.prepare('DELETE FROM upgrade_changes WHERE upgrade_id = ?').run(id);
      const ins = d.prepare('INSERT INTO upgrade_changes (upgrade_id, path, additions, deletions, status) VALUES (?, ?, ?, ?, ?)');
      for (const c of changes) ins.run(id, c.path, c.additions, c.deletions, c.status);
    })();
  },

  changes(id: string): UpgradeChange[] {
    return db().prepare('SELECT * FROM upgrade_changes WHERE upgrade_id = ? ORDER BY path').all(id) as UpgradeChange[];
  },

  addTest(t: Omit<UpgradeTest, 'created_at'>): void {
    db().prepare(`
      INSERT INTO upgrade_tests (upgrade_id, target, command, passed, failed, skipped, total, exit_code, output, created_at)
      VALUES (@upgrade_id, @target, @command, @passed, @failed, @skipped, @total, @exit_code, @output, @now)
    `).run({ ...t, now: Date.now() });
  },

  clearTests(id: string): void {
    db().prepare('DELETE FROM upgrade_tests WHERE upgrade_id = ?').run(id);
  },

  tests(id: string): UpgradeTest[] {
    return db().prepare('SELECT * FROM upgrade_tests WHERE upgrade_id = ? ORDER BY created_at').all(id) as UpgradeTest[];
  },

  addReview(r: Omit<UpgradeReview, 'created_at'>): void {
    db().prepare('INSERT INTO upgrade_review (upgrade_id, verdict, findings, reviewer, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(r.upgrade_id, r.verdict, r.findings, r.reviewer, Date.now());
  },

  latestReview(id: string): UpgradeReview | undefined {
    return db().prepare('SELECT * FROM upgrade_review WHERE upgrade_id = ? ORDER BY created_at DESC LIMIT 1').get(id) as UpgradeReview | undefined;
  },
};

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
