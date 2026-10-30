// Shared tool types, per-turn context and output helpers
import fs from "fs/promises";
import path from "path";
import { OPEN_CODE_DIR, ensureOpenCodeIgnored, openCodePath } from "../openCodeDir";
import { type PlanTask } from "../db";

// ─── Constants ─────────────────────────────────────────────────────────────────

export const MAX_READ_CHARS = 32_000;
const MAX_OUTPUT_CHARS = 8_000;

export function truncate(s: string, max = MAX_OUTPUT_CHARS): string {
  if (s.length <= max) return s;
  // Keep head AND tail: build/test runners print their summary and final
  // failures last, which a head-only cut silently dropped
  const head = Math.floor(max * 0.4);
  const tail = max - head;
  return `${s.slice(0, head)}\n...[truncated ${s.length - max} chars]...\n${s.slice(-tail)}`;
}

// ─── Turn context ──────────────────────────────────────────────────────────────

/**
 * Tracks per-turn state: which files the model has read (fresh-read
 * enforcement for edits), what it changed, and which verifications ran.
 */
export interface TurnContext {
  filesRead: Set<string>;
  filesEdited: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
  hasEdits: boolean;
  hasRunLint: boolean;
  hasRunTests: boolean;
  /** Outcome of the most recent run_lint / run_tests / run_notebook this turn */
  lastVerification?: { tool: string; passed: boolean; summary: string };
  /** Subdirectory memory files (e.g. "sub/CLAUDE.md") already surfaced by read_file this turn */
  memoryFilesLoaded?: Set<string>;
}

export function createTurnContext(): TurnContext {
  return {
    filesRead: new Set(),
    filesEdited: new Set(),
    filesCreated: new Set(),
    commandsRun: [],
    hasEdits: false,
    hasRunLint: false,
    hasRunTests: false,
    memoryFilesLoaded: new Set(),
  };
}

// ─── Result shape ──────────────────────────────────────────────────────────────

export interface VerificationOutcome {
  passed: boolean;
  errorCount?: number;
  warningCount?: number;
  total?: number;
  failed?: number;
  skipped?: boolean;
}

/** Machine-readable payload attached by tools that produce one:
 *  lint/test outcomes, plan snapshots, deploy URLs. */
export type StructuredOutcome = Partial<VerificationOutcome> & {
  tasks?: PlanTask[];
  url?: string | null;
  artifactId?: string;
  title?: string;
};

export interface ToolResult {
  success: boolean;
  /** Full text fed back to the LLM as the tool message */
  output: string;
  /** One-line human-readable summary for the UI timeline */
  summary: string;
  error?: string;
  suggestion?: string;
  changedFile?: string;
  extra?: Record<string, unknown>;
  structured?: StructuredOutcome;
  /** data: URL of an image the loop should attach to the conversation
   *  (view_image) when the model accepts images */
  attachImage?: string;
  /** Untruncated output. When it is longer than `output`, executeTool saves
   *  it under .open-code/outputs/ and points the model at the file */
  fullOutput?: string;
}

// ─── Large output spill ────────────────────────────────────────────────────────

const OUTPUTS_KEEP = 50;

/** Save a tool's full output to .open-code/outputs/ and return the note to
 *  append to the truncated output. Keeps the newest OUTPUTS_KEEP files. */
export async function spillFullOutput(workspace: string, toolName: string, full: string): Promise<string> {
  const safeTool = toolName.replace(/[^a-z0-9_-]/gi, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rel = openCodePath("outputs", `${safeTool}-${stamp}-${Math.random().toString(36).slice(2, 6)}.txt`);
  const dir = path.join(workspace, OPEN_CODE_DIR, "outputs");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(workspace, rel), full, "utf-8");
  await ensureOpenCodeIgnored(workspace);
  try {
    const entries = await Promise.all(
      (await fs.readdir(dir)).map(async (f) => ({ f, t: (await fs.stat(path.join(dir, f))).mtimeMs }))
    );
    entries.sort((a, b) => b.t - a.t || b.f.localeCompare(a.f));
    for (const e of entries.slice(OUTPUTS_KEEP)) await fs.rm(path.join(dir, e.f), { force: true });
  } catch {}
  return `\n[Full output (${full.length} chars) saved to ${rel} — read it with read_file start_line/end_line or grep_files]`;
}
