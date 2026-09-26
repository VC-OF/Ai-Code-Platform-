import fs from 'fs/promises';
import path from 'path';
import { callLLM, type LLMConfig, type LLMMessage } from './llmClient';
import { appendMemoryLine } from './scienceTools';

/**
 * Auto-memory: after a substantial turn, one cheap model call proposes up to
 * three durable project facts, which are appended to AGENTS.md ## Memory.
 * Opt out with OPEN_CODE_AUTO_MEMORY=0. Failures never affect the turn.
 */

export const AUTO_MEMORY_MIN_TOOL_CALLS = 3;
const MAX_PROPOSALS = 3;
const MAX_LINE_CHARS = 200;
const TRANSCRIPT_CHARS = 12_000;

const AUTO_MEMORY_PROMPT =
  'You maintain a project memory file for a coding agent. From the conversation below, list 0-3 DURABLE, ' +
  'project-specific facts worth remembering for future sessions: build/test/lint commands, conventions, ' +
  'architecture decisions, gotchas. One line each, starting with "- ". Skip anything temporary, task-specific, ' +
  'already obvious from the code, or already in the existing memory. If nothing qualifies, reply exactly NONE.';

export function autoMemoryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !['0', 'false', 'no', 'off'].includes((env.OPEN_CODE_AUTO_MEMORY ?? '').trim().toLowerCase());
}

/** Bullet lines from the model's reply (max 3, one line each). */
export function parseMemoryProposals(reply: string | null | undefined): string[] {
  if (!reply || /^\s*none\.?\s*$/i.test(reply)) return [];
  const out: string[] = [];
  for (const raw of reply.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (!m) continue;
    const line = m[1].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (line.length < 8 || line.length > MAX_LINE_CHARS || /^none\b/i.test(line)) continue;
    out.push(line);
    if (out.length >= MAX_PROPOSALS) break;
  }
  return out;
}

function normalize(line: string): string {
  return line.toLowerCase().replace(/^[-*\s]+/, '').replace(/[`'".,;:!?()]/g, '').replace(/\s+/g, ' ').trim();
}

/** Bullets currently under `## Memory` in AGENTS.md. */
export function existingMemoryLines(agentsMd: string): string[] {
  const lines = agentsMd.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '## Memory');
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    const m = lines[i].match(/^\s*-\s+(.+)$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** Drop proposals already in memory (case/punctuation-insensitive) or repeated. */
export function dedupeProposals(proposals: string[], agentsMd: string): string[] {
  const seen = new Set(existingMemoryLines(agentsMd).map(normalize));
  const out: string[] = [];
  for (const p of proposals) {
    const key = normalize(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Compact, truncated transcript of the turn for the proposal prompt. */
export function summarizeTurn(messages: LLMMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    let text = typeof m.content === 'string' ? m.content : m.content ? JSON.stringify(m.content) : '';
    const calls = (m as { tool_calls?: { function?: { name?: string; arguments?: string } }[] }).tool_calls;
    if (calls?.length) {
      text += calls.map((c) => ` [${c.function?.name}(${(c.function?.arguments ?? '').slice(0, 200)})]`).join('');
    }
    if (text) parts.push(`${m.role}: ${text.slice(0, 1_500)}`);
  }
  const joined = parts.join('\n');
  return joined.length > TRANSCRIPT_CHARS ? joined.slice(-TRANSCRIPT_CHARS) : joined;
}

/** Propose, dedupe and append memory lines. Returns the lines added. */
export async function runAutoMemory(opts: {
  workspace: string;
  llmConfig: LLMConfig;
  messages: LLMMessage[];
  signal?: AbortSignal;
}): Promise<string[]> {
  const file = path.join(opts.workspace, 'AGENTS.md');
  let current = '';
  try { current = await fs.readFile(file, 'utf8'); } catch {}

  const existing = existingMemoryLines(current);
  const resp = await callLLM(
    opts.llmConfig,
    [
      { role: 'system', content: AUTO_MEMORY_PROMPT },
      {
        role: 'user',
        content:
          `Existing memory:\n${existing.length ? existing.map((l) => `- ${l}`).join('\n') : '(empty)'}\n\n` +
          `Conversation:\n${summarizeTurn(opts.messages)}`,
      },
    ],
    undefined,
    { toolChoice: 'none', signal: opts.signal }
  );

  const lines = dedupeProposals(parseMemoryProposals(resp.content), current);
  if (lines.length === 0) return [];
  let next = current;
  const added: string[] = [];
  for (const line of lines) {
    const r = appendMemoryLine(next, line);
    if (r.added) {
      next = r.next;
      added.push(line);
    }
  }
  if (added.length) await fs.writeFile(file, next, 'utf8');
  return added;
}
