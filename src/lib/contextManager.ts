import { getContextWindow } from './models';

/** OpenAI-style multimodal content part (text or image) */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ContextMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | ContentPart[];
  tool_calls?: unknown;
  tool_call_id?: string;
  tool_name?: string;
};

export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 3.5);
}

// Rough per-image budget (providers bill a few hundred to ~1.5k tokens)
const IMAGE_TOKENS = 1_000;

/** Text of a message, ignoring image parts. */
export function messageText(msg: ContextMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  return msg.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

function imageCount(msg: ContextMessage): number {
  return Array.isArray(msg.content) ? msg.content.filter((p) => p.type === 'image_url').length : 0;
}

/** Estimate a whole message, including serialized tool-call payloads. */
export function estimateMessageTokens(msg: ContextMessage): number {
  let tokens = estimateTokens(messageText(msg)) + imageCount(msg) * IMAGE_TOKENS;
  if (msg.tool_calls) {
    try {
      tokens += estimateTokens(JSON.stringify(msg.tool_calls));
    } catch {}
  }
  return tokens;
}

export function shouldCompact(
  messages: ContextMessage[],
  opts: { model: string; targetRatio: number }
): boolean {
  const windowSize = getContextWindow(opts.model);
  const limit = windowSize * opts.targetRatio;

  const total = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
  return total > limit;
}

export function compactMessages(
  messages: ContextMessage[],
  opts: { model: string; targetRatio: number; minRatio: number; preserveLastN: number }
) {
  const windowSize = getContextWindow(opts.model);
  const targetTokens = windowSize * opts.minRatio;

  let currentTokens = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
  
  if (currentTokens <= targetTokens) {
    return { messages, tokensAfter: currentTokens };
  }
  
  const preservedCount = Math.min(messages.length, opts.preserveLastN);
  const toCompact = messages.slice(0, messages.length - preservedCount);
  const preserved = messages.slice(messages.length - preservedCount);
  
  const scored = toCompact
    .map((msg, i) => ({
      msg,
      score: scoreMessage(msg, i, toCompact.length),
      index: i,
    }))
    .sort((a, b) => a.score - b.score);
    
  const compacted = [...toCompact];
  
  for (const { msg, index } of scored) {
    if (currentTokens <= targetTokens) break;
    if (msg.role === 'system') continue;

    const tokens = estimateMessageTokens(msg);
    const summary = buildSummary(msg);
    
    compacted[index] = { ...msg, content: summary };
    currentTokens -= (tokens - estimateTokens(summary));
  }
  
  return {
    messages: [...compacted, ...preserved],
    tokensAfter: currentTokens,
  };
}

function scoreMessage(msg: ContextMessage, index: number, total: number): number {
  let score = 0;
  
  const recencyRatio = index / total;
  if (recencyRatio > 0.8) score += 100;
  else if (recencyRatio > 0.5) score += 50;
  
  if (msg.role === 'system') score += 1000;
  if (msg.role === 'user') score += 80;
  
  if (msg.tool_name === 'read_file') score -= 20;
  if (msg.tool_name === 'run_lint') score += 60;
  if (msg.tool_name === 'run_tests') score += 60;
  if (msg.tool_name === 'edit_file') score += 40;
  
  const tokens = estimateMessageTokens(msg);
  if (tokens > 2000) score -= 30;
  if (tokens > 5000) score -= 60;

  return score;
}

function buildSummary(msg: ContextMessage): string {
  const text = messageText(msg);
  if (msg.tool_name === 'read_file') {
    const pathMatch = text.match(/path['":\s]+([^\s'"]+)/);
    const lineMatch = text.match(/(\d+)\s+lines?/);
    return `[read_file: ${pathMatch?.[1] ?? 'unknown'}, ${lineMatch?.[1] ?? '?'} lines — compacted]`;
  }
  if (msg.tool_name === 'list_files') {
    return `[list_files result — compacted]`;
  }
  if (msg.tool_name === 'grep_files') {
    const matchCount = (text.match(/\n/g) ?? []).length;
    return `[grep_files: ${matchCount} matches found — compacted]`;
  }
  if (Array.isArray(msg.content) && imageCount(msg) > 0) {
    return `[${imageCount(msg)} image(s) viewed earlier — compacted]`;
  }
  return `[${msg.role} message — compacted, ${estimateMessageTokens(msg)} tokens removed]`;
}

// ─── Summarizing compaction support ──────────────────────────────────────────

export interface CompactionSplit {
  /** Leading system message (if present) */
  head: ContextMessage[];
  /** Span to summarize away */
  evicted: ContextMessage[];
  /** Recent messages kept verbatim */
  preserved: ContextMessage[];
}

/**
 * Split messages into [head | evicted | preserved] for summary-based
 * compaction. The preserved span never starts with a `tool` message —
 * that would orphan tool results from their assistant tool_calls and
 * fail OpenAI message validation — so the boundary walks back to the
 * nearest safe cut point.
 */
export function splitForCompaction(
  messages: ContextMessage[],
  preserveLastN: number
): CompactionSplit | null {
  const startIdx = messages[0]?.role === 'system' ? 1 : 0;
  let boundary = Math.max(startIdx, messages.length - preserveLastN);

  while (boundary > startIdx && messages[boundary]?.role === 'tool') {
    boundary--;
  }

  const evicted = messages.slice(startIdx, boundary);
  if (evicted.length < 4) return null; // not worth a summary call

  return {
    head: messages.slice(0, startIdx),
    evicted,
    preserved: messages.slice(boundary),
  };
}

const MAX_SERIALIZED_CHARS = 24_000;
const MAX_PER_MESSAGE_CHARS = 1_500;

/** Flatten an evicted span into role-labeled text for the summarizer. */
export function serializeForSummary(messages: ContextMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    let body = messageText(m) + (imageCount(m) ? ` [${imageCount(m)} image(s)]` : '');
    if (m.tool_calls) {
      try {
        body += `\n[tool calls: ${JSON.stringify(m.tool_calls).slice(0, 500)}]`;
      } catch {}
    }
    if (body.length > MAX_PER_MESSAGE_CHARS) {
      body = body.slice(0, MAX_PER_MESSAGE_CHARS) + ' …[truncated]';
    }
    const label = m.role === 'tool' ? `tool(${m.tool_name ?? '?'})` : m.role;
    parts.push(`### ${label}\n${body}`);
  }
  let out = parts.join('\n\n');
  if (out.length > MAX_SERIALIZED_CHARS) {
    // Keep the tail — recent evicted context matters more than the oldest
    out = '…[earlier span omitted]\n\n' + out.slice(-MAX_SERIALIZED_CHARS);
  }
  return out;
}

export const SUMMARIZE_SYSTEM_PROMPT =
  'You compress a coding-agent conversation into a dense factual brief that a ' +
  'coding agent will rely on as its only memory of this span. Include: the ' +
  "user's goals and requirements; every file created or edited (exact paths) " +
  'and what each contains or does; key API shapes, function names, and data ' +
  'structures; commands run and their outcomes; errors encountered and how ' +
  'they were fixed; decisions made and why; current state and what remains ' +
  'to be done. Be specific — exact paths, names, and values. No filler.';

export function getContextStatus(messages: ContextMessage[], model: string) {
  const windowSize = getContextWindow(model);
  const currentTokens = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
  return {
    currentTokens,
    windowSize,
    ratio: currentTokens / windowSize,
  };
}
