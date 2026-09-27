// Turn the agent's NDJSON stream events into short spoken updates.
//
// The agent emits text_done after every LLM step, including the "Let me look
// at the tests" preamble before tool calls. A reply is only treated as final
// once no tool call follows it within `replyHoldMs` (see tick()) or the turn
// ends, so by default only the real answer is read out.

import { toolLabel } from '@/components/toolLabels';
import { toSpeakable } from './speechText';
import type { SpeechPriority } from './speechQueue';

export type NarrationLevel = 'replies' | 'replies+questions' | 'everything';

export const NARRATION_LEVELS: { id: NarrationLevel; label: string }[] = [
  { id: 'replies', label: 'Replies only' },
  { id: 'replies+questions', label: 'Replies and questions' },
  { id: 'everything', label: 'Everything (progress too)' },
];

export function isNarrationLevel(v: unknown): v is NarrationLevel {
  return v === 'replies' || v === 'replies+questions' || v === 'everything';
}

export type UtteranceKind = 'progress' | 'reply' | 'question' | 'done' | 'error';

export interface Utterance {
  text: string;
  priority: SpeechPriority;
  kind: UtteranceKind;
}

/** Loose shape of a stream event (see ChatPanel's TimelineItem). */
export interface NarrationEvent {
  type: string;
  ts?: number;
  [key: string]: unknown;
}

/** How step texts that are followed by more tool calls are handled. */
export type IntermediateReplies = 'never' | 'throttled' | 'always';

export interface NarratorOptions {
  level?: NarrationLevel;
  /** Minimum gap between progress updates (tool calls, plan steps) */
  progressIntervalMs?: number;
  /** Final replies are cut to this length */
  replyMaxChars?: number;
  /** A step's text counts as the final reply when no tool starts within this window */
  replyHoldMs?: number;
  /** Default: 'throttled' at level 'everything', otherwise 'never' */
  intermediateReplies?: IntermediateReplies;
  intermediateIntervalMs?: number;
  intermediateMaxChars?: number;
}

/** Tools that fire in bursts while the agent explores — never narrated. */
const CHATTER_TOOLS = new Set([
  'read_file', 'list_files', 'glob_files', 'grep_files', 'load_skill', 'view_image', 'query_data',
  'job_output', 'list_jobs', 'read_preview_logs', 'fetch_preview', 'check_preview', 'docker_status',
  'mcp_list_resources', 'mcp_read_resource', 'browser_snapshot', 'browser_scroll', 'browser_console',
  'browser_wait', 'github_list_prs', 'github_get_pr', 'github_list_issues', 'github_get_issue',
]);

/** Tools whose own events are narrated separately (questions, plan updates). */
const SILENT_TOOLS = new Set(['ask_user', 'update_plan']);

export function isChatterTool(toolName: string): boolean {
  return CHATTER_TOOLS.has(toolName) || toolName.startsWith('lsp_');
}

function baseName(p: unknown): string {
  const s = String(p ?? '').trim().replace(/[\\/]+$/, '');
  if (!s) return '';
  return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1);
}

/** "npm run test -- --watch=false" → "npm run test"; paths shrink to file names. */
export function spokenCommand(command: unknown): string {
  const first = String(command ?? '').split(/\n|&&|\|\||;|\|/)[0].trim();
  const tokens = first
    .split(/\s+/)
    .filter((t) => t && !/^[A-Z_][A-Z0-9_]*=/.test(t))
    .filter((t) => !t.startsWith('-'))
    .slice(0, 3)
    .map((t) => (/[\\/]/.test(t) ? baseName(t) : t))
    .filter(Boolean);
  return tokens.length ? tokens.join(' ') : 'a command';
}

/** Make a timeline label pleasant to hear: file names instead of paths, no URLs or line counts. */
function speakLabel(label: string): string {
  return label
    .replace(/\s*\(\d+ lines?\)/g, '')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/(?:[\w.-]+[\\/])+([\w.-]+)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One short spoken line for a tool call, or null when it should stay silent. */
export function spokenToolLine(toolName: string, args: Record<string, unknown> | undefined): string | null {
  if (!toolName || SILENT_TOOLS.has(toolName) || isChatterTool(toolName)) return null;
  const a = args ?? {};
  const file = baseName(a.path ?? a.file);
  switch (toolName) {
    case 'create_file': return file ? `Creating ${file}` : 'Creating a file';
    case 'edit_file':
    case 'replace_lines':
    case 'multi_edit':
    case 'append_file':
    case 'notebook_edit':
      return file ? `Editing ${file}` : 'Editing a file';
    case 'delete_file': return file ? `Deleting ${file}` : 'Deleting a file';
    case 'run_command': return `Running ${spokenCommand(a.command)}`;
    case 'run_background': return `Starting ${spokenCommand(a.command)} in the background`;
    case 'run_tests': return 'Running the tests';
    case 'run_lint': return 'Running the linter';
    case 'execute_code': {
      const lang = String(a.language ?? '').slice(0, 12);
      const what = a.description ? `: ${toSpeakable(String(a.description), 80)}` : '';
      return `Running ${lang ? `some ${lang}` : 'some code'}${what}`;
    }
    case 'web_search': return a.query ? `Searching the web for ${toSpeakable(String(a.query), 80)}` : 'Searching the web';
    case 'fetch_url': return 'Reading a web page';
    case 'http_request': return 'Calling an API';
    case 'generate_image': return 'Generating an image';
    case 'deploy_app': return 'Deploying the app';
    case 'docker_run': return 'Running a container';
    case 'create_artifact': return 'Writing an artifact';
    case 'exit_plan_mode': return 'The plan is ready for your approval';
  }
  const label = toolLabel(toolName, a);
  if (label) return speakLabel(label);
  if (toolName.startsWith('mcp_')) return 'Calling an external tool';
  return `Using ${toolName.replace(/_+/g, ' ').trim()}`;
}

function doneLine(reason: string, filesChanged: unknown): string {
  switch (reason) {
    case 'user_cancelled': return 'Stopped.';
    case 'max_steps': return 'I hit the step limit. Say "continue" to keep going.';
    case 'timeout': return 'I ran out of time for this turn. Say "continue" to keep going.';
  }
  const files = Array.isArray(filesChanged) ? filesChanged.filter((f) => typeof f === 'string') : [];
  if (files.length === 1) return `Done. I changed ${baseName(files[0])}.`;
  if (files.length > 1) return `Done. I changed ${files.length} files.`;
  return 'Done.';
}

function questionLine(question: string, options: unknown): string {
  const q = toSpeakable(question, 300) || 'I have a question.';
  const opts = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string' && !!o.trim()) : [];
  if (!opts.length) return q;
  const spoken = opts.slice(0, 5).map((o, i) => `Option ${i + 1}: ${toSpeakable(o, 80).replace(/[.!?]+$/, '')}.`);
  const more = opts.length > 5 ? ` And ${opts.length - 5} more on screen.` : '';
  return `${q} ${spoken.join(' ')}${more}`;
}

export class Narrator {
  private opts: Required<Omit<NarratorOptions, 'intermediateReplies'>> & { intermediateReplies?: IntermediateReplies };
  private pendingReply: { text: string; at: number } | null = null;
  private lastProgressAt = Number.NEGATIVE_INFINITY;
  private lastIntermediateAt = Number.NEGATIVE_INFINITY;
  private lastPlanTask: string | null = null;
  private lastError: string | null = null;
  private spokeError = false;
  private ignoreBefore = 0;

  constructor(options: NarratorOptions = {}) {
    this.opts = {
      level: options.level ?? 'everything',
      progressIntervalMs: options.progressIntervalMs ?? 8_000,
      replyMaxChars: options.replyMaxChars ?? 400,
      replyHoldMs: options.replyHoldMs ?? 1_500,
      intermediateReplies: options.intermediateReplies,
      intermediateIntervalMs: options.intermediateIntervalMs ?? 20_000,
      intermediateMaxChars: options.intermediateMaxChars ?? 200,
    };
  }

  get level(): NarrationLevel {
    return this.opts.level;
  }

  setLevel(level: NarrationLevel): void {
    this.opts.level = level;
  }

  /** Skip events stamped before `ts` (replayed history when reattaching to a run). */
  setIgnoreBefore(ts: number): void {
    this.ignoreBefore = ts;
  }

  /** Forget the current turn (new stream, voice toggled off). */
  reset(): void {
    this.pendingReply = null;
    this.lastProgressAt = Number.NEGATIVE_INFINITY;
    this.lastIntermediateAt = Number.NEGATIVE_INFINITY;
    this.lastPlanTask = null;
    this.lastError = null;
    this.spokeError = false;
  }

  /** Discard a held reply without speaking it (the user said "be quiet" or "stop"). */
  dropPending(): void {
    this.pendingReply = null;
  }

  private get intermediateMode(): IntermediateReplies {
    return this.opts.intermediateReplies ?? (this.opts.level === 'everything' ? 'throttled' : 'never');
  }

  private reply(text: string): Utterance[] {
    const spoken = toSpeakable(text, this.opts.replyMaxChars);
    return spoken ? [{ text: spoken, priority: 'normal', kind: 'reply' }] : [];
  }

  private flushReply(): Utterance[] {
    if (!this.pendingReply) return [];
    const { text } = this.pendingReply;
    this.pendingReply = null;
    return this.reply(text);
  }

  /** A step's text that turned out not to be the final reply. */
  private intermediate(text: string, now: number): Utterance[] {
    const mode = this.intermediateMode;
    if (mode === 'never') return [];
    if (mode === 'throttled' && now - this.lastIntermediateAt < this.opts.intermediateIntervalMs) return [];
    const spoken = toSpeakable(text, this.opts.intermediateMaxChars);
    if (!spoken) return [];
    this.lastIntermediateAt = now;
    this.lastProgressAt = now;
    return [{ text: spoken, priority: 'low', kind: 'progress' }];
  }

  private progress(text: string, now: number, force = false): Utterance[] {
    if (this.opts.level !== 'everything') return [];
    if (!force && now - this.lastProgressAt < this.opts.progressIntervalMs) return [];
    this.lastProgressAt = now;
    return [{ text, priority: 'low', kind: 'progress' }];
  }

  handle(event: NarrationEvent, now: number = Date.now()): Utterance[] {
    if (!event || typeof event.type !== 'string') return [];
    const replayed = this.ignoreBefore > 0 && typeof event.ts === 'number' && event.ts < this.ignoreBefore;

    switch (event.type) {
      case 'text_done': {
        if (replayed) return [];
        const text = String(event.content ?? '').trim();
        // Two texts in a row: the earlier one was not the answer
        const out = this.pendingReply ? this.intermediate(this.pendingReply.text, now) : [];
        this.pendingReply = text ? { text, at: now } : null;
        return out;
      }

      case 'tool_start': {
        if (replayed) return [];
        const toolName = String(event.toolName ?? '');
        if (toolName === 'ask_user') return [];
        const out: Utterance[] = [];
        if (this.pendingReply) {
          out.push(...this.intermediate(this.pendingReply.text, now));
          this.pendingReply = null;
        }
        if (out.length) return out;
        const line = spokenToolLine(toolName, event.args as Record<string, unknown> | undefined);
        return line ? this.progress(line, now) : [];
      }

      case 'plan_update': {
        const tasks = Array.isArray(event.tasks) ? (event.tasks as { title?: unknown; status?: unknown }[]) : [];
        const current = tasks.find((t) => t && t.status === 'in_progress');
        const title = current ? String(current.title ?? '').trim() : '';
        if (!title || title === this.lastPlanTask) return [];
        this.lastPlanTask = title;
        if (replayed) return [];
        return this.progress(`Now: ${toSpeakable(title, 140)}`, now, true);
      }

      case 'verification': {
        if (replayed) return [];
        const tests = event.tool === 'run_tests';
        const count = Number(event.errorCount ?? 0);
        const line = event.passed
          ? tests ? 'Tests passed.' : 'Lint is clean.'
          : tests
            ? 'Some tests failed.'
            : `Lint found ${count > 0 ? `${count} ${count === 1 ? 'problem' : 'problems'}` : 'problems'}.`;
        return this.progress(line, now, true);
      }

      case 'user_input_request': {
        if (replayed) return [];
        if (this.opts.level === 'replies') return this.flushReply();
        // The question carries the context; the preamble before it is dropped
        this.pendingReply = null;
        return [{ text: questionLine(String(event.question ?? ''), event.options), priority: 'high', kind: 'question' }];
      }

      case 'error': {
        const message = String(event.message ?? event.error ?? '').trim();
        // Recoverable errors are retry notices; the done event reports a real failure
        if (event.recoverable === true) {
          if (message) this.lastError = message;
          return [];
        }
        if (replayed) return [];
        const out = this.flushReply();
        this.spokeError = true;
        out.push({
          text: message ? `Something went wrong: ${toSpeakable(message, 160)}` : 'Something went wrong.',
          priority: 'normal',
          kind: 'error',
        });
        return out;
      }

      case 'done': {
        if (replayed) {
          this.reset();
          return [];
        }
        const out = this.flushReply();
        const reason = String(event.reason ?? 'completed');
        if (reason === 'error') {
          out.push({
            text: this.spokeError
              ? 'Stopped.'
              : `Something went wrong${this.lastError ? `: ${toSpeakable(this.lastError, 160)}` : '.'}`,
            priority: 'normal',
            kind: 'error',
          });
        } else {
          out.push({ text: doneLine(reason, event.filesChanged), priority: 'normal', kind: 'done' });
        }
        this.reset();
        return out;
      }

      default:
        return [];
    }
  }

  /** Call periodically: releases a held reply once no tool call has followed it. */
  tick(now: number = Date.now()): Utterance[] {
    if (this.pendingReply && now - this.pendingReply.at >= this.opts.replyHoldMs) return this.flushReply();
    return [];
  }
}
