import { z } from 'zod';
import type { LLMConfig, LLMTool } from './llmClient';
import { EventEmitter } from './events';
import type { CancellationSource } from './cancellation';

/**
 * Sub-agents: the main agent can delegate a self-contained task to a fresh
 * agent loop with its own context window and a restricted tool set, then
 * gets back only the final report. Several spawn_agent calls in one reply
 * run in parallel. Sub-agents cannot spawn further sub-agents, talk to the
 * user, or touch the shared plan.
 */

export type SubagentKind = 'explore' | 'research' | 'verify' | 'general';

export const SUBAGENT_KINDS: SubagentKind[] = ['explore', 'research', 'verify', 'general'];

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_files', 'glob_files', 'grep_files', 'load_skill',
  'web_search', 'fetch_url', 'view_image',
  'read_preview_logs', 'fetch_preview', 'check_preview', 'docker_status',
  'browser_open', 'browser_snapshot', 'browser_scroll', 'browser_console', 'browser_wait', 'browser_close',
]);

const VERIFY_TOOLS = new Set([
  'run_lint', 'run_tests', 'run_command', 'execute_code', 'run_notebook', 'docker_run',
  'browser_click', 'browser_type', 'browser_press', 'browser_select', 'browser_screenshot',
]);

/** Never available inside a sub-agent, whatever its kind. */
export const SUBAGENT_EXCLUDED_TOOLS = new Set(['spawn_agent', 'ask_user', 'update_plan', 'deploy_app', 'save_memory']);

interface KindSpec {
  summary: string;
  maxSteps: number;
  maxDurationMs: number;
  allows: (toolName: string) => boolean;
  instructions: string;
  /** May change workspace files — the parent checkpoints before spawning */
  edits: boolean;
}

const KIND_SPECS: Record<SubagentKind, KindSpec> = {
  explore: {
    summary: 'read-only exploration of the workspace',
    maxSteps: 40,
    maxDurationMs: 15 * 60_000,
    allows: (n) => READ_ONLY_TOOLS.has(n),
    edits: false,
    instructions:
      'Find and understand the code, data and documents relevant to the task with list_files, glob_files, grep_files and read_file. You cannot modify anything. ' +
      'Report where things are (paths and line numbers), how they work, and — if asked — exactly what to change and where.',
  },
  research: {
    summary: 'documentation / literature research with quick calculations',
    maxSteps: 50,
    maxDurationMs: 20 * 60_000,
    allows: (n) => READ_ONLY_TOOLS.has(n) || n === 'execute_code',
    edits: false,
    instructions:
      'Investigate with web_search and fetch_url (always cite the URLs you relied on), the workspace files, and execute_code for quick checks and calculations. ' +
      'Separate established facts (with sources) from your own inferences, give numbers with units, and note anything you could not confirm.',
  },
  verify: {
    summary: 'independent verification (tests, checks, reproductions)',
    maxSteps: 60,
    maxDurationMs: 20 * 60_000,
    allows: (n) => READ_ONLY_TOOLS.has(n) || VERIFY_TOOLS.has(n),
    edits: false,
    instructions:
      'Independently check the claim, change or result you were given: run the tests, linters and commands, reproduce numbers with execute_code, compare against analytic expectations or reference values, exercise the UI in the browser. ' +
      'Do NOT fix anything. Report pass/fail per check with the exact evidence (command, output, numbers) and list what you could not verify.',
  },
  general: {
    summary: 'autonomous implementation of a delegated sub-task',
    maxSteps: envInt('SUBAGENT_MAX_STEPS', 100),
    maxDurationMs: envInt('SUBAGENT_MAX_DURATION_MIN', 30) * 60_000,
    allows: () => true,
    edits: true,
    instructions:
      'Carry the task out end to end: read before you edit, keep changes scoped to the task, and verify with run_lint / run_tests / execute_code before you report. ' +
      'Report every file you created or changed and how you verified the result.',
  },
};

export function subagentKindSpec(kind: SubagentKind): { summary: string; maxSteps: number; edits: boolean } {
  const s = KIND_SPECS[kind];
  return { summary: s.summary, maxSteps: s.maxSteps, edits: s.edits };
}

/** Kinds whose sub-agent may modify workspace files. */
export function subagentEdits(kind: string): boolean {
  return KIND_SPECS[kind as SubagentKind]?.edits ?? true;
}

// ─── Tool schema ───────────────────────────────────────────────────────────────

export const SPAWN_AGENT_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'spawn_agent',
    description:
      'Delegate a self-contained task to a sub-agent that runs its own agent loop with a fresh context window and returns only a final report. Kinds: ' +
      "'explore' (read-only: find and explain code/files), 'research' (docs/literature + quick calculations, cites sources), " +
      "'verify' (independently re-run tests/reproduce results/compare with expectations without fixing anything), " +
      "'general' (implements a delegated sub-task end to end, may edit files). " +
      'Use it to keep your own context small (broad searches, long documents), to run independent workstreams in parallel (issue several spawn_agent calls in ONE reply — they execute concurrently; give them non-overlapping files), and to get an independent check of your work before declaring it done. ' +
      'The sub-agent only knows what you put in task/context: state the goal, what a good report contains, relevant paths, constraints and what you already know.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: SUBAGENT_KINDS, description: 'What the sub-agent may do' },
        task: { type: 'string', description: 'Complete, self-contained instructions (what to do, where to look, what to report)' },
        context: { type: 'string', description: 'Facts, findings and constraints the sub-agent should start from (optional)' },
        label: { type: 'string', description: 'Short name shown in the UI, e.g. "boundary-conditions research" (optional)' },
      },
      required: ['kind', 'task'],
    },
  },
};

export const SPAWN_AGENT_ZOD = z.object({
  kind: z.enum(SUBAGENT_KINDS as [SubagentKind, ...SubagentKind[]]),
  task: z.string().min(10).max(30_000),
  context: z.string().max(30_000).optional(),
  label: z.string().max(60).optional(),
});

function toolName(tool: LLMTool): string {
  return (tool as { function?: { name?: string } }).function?.name ?? '';
}

/** Tools a sub-agent of this kind may call. MCP tools count as mutating. */
export function subagentToolSet(kind: SubagentKind, tools: LLMTool[]): LLMTool[] {
  const spec = KIND_SPECS[kind];
  return tools.filter((t) => {
    const name = toolName(t);
    if (!name || SUBAGENT_EXCLUDED_TOOLS.has(name)) return false;
    if (name.startsWith('mcp_')) return kind === 'general';
    return spec.allows(name);
  });
}

export function subagentSystemPrompt(kind: SubagentKind, parentPrompt: string, label: string): string {
  const spec = KIND_SPECS[kind];
  return (
    `${parentPrompt}\n\n` +
    `## Sub-agent mode: ${kind} ("${label}")\n` +
    `You are a sub-agent spawned by the main agent for ONE delegated task. You do not talk to the user, and your tools are limited to ${spec.summary}. ` +
    `${spec.instructions}\n` +
    'When done, reply with a plain-text report and no tool calls. That report is the ONLY thing the main agent receives, so make it complete and self-contained: ' +
    'concrete findings, exact file paths and line numbers, commands you ran with their results, numbers with units, URLs for external facts, and open questions. ' +
    'Never claim work you did not do. Do not ask questions — decide, and state your assumptions.'
  );
}

// ─── Running ───────────────────────────────────────────────────────────────────

export interface SubagentRequest {
  kind: SubagentKind;
  task: string;
  context?: string;
  label?: string;
}

export interface SubagentEnv {
  projectId: string;
  workspaceRoot: string;
  llmConfig: LLMConfig;
  /** The parent's full tool list; filtered per kind */
  tools: LLMTool[];
  /** The parent's composed system prompt */
  systemPrompt: string;
  emitter: EventEmitter;
  cancellation: CancellationSource;
  turnIndex: number;
  parentStep: number;
  toolCallId: string;
  /** Nesting depth of the parent (0 = main agent) */
  depth: number;
}

export interface SubagentRunResult {
  success: boolean;
  /** Text fed back to the parent as the tool result */
  output: string;
  summary: string;
  reason: string;
  filesChanged: string[];
  totalTokens: number;
  steps: number;
  toolCalls: number;
  durationMs: number;
}

/**
 * Forwards the child loop's events to the parent stream wrapped as
 * `subagent_event`, so the UI can nest them under the spawn_agent call and
 * the parent's own status/text is never confused with the child's.
 */
class SubagentEmitter extends EventEmitter {
  toolCalls = 0;
  lastText = '';
  lastError = '';

  constructor(
    private parent: EventEmitter,
    private meta: { toolCallId: string; stepIndex: number; label: string; kind: SubagentKind }
  ) {
    super(null as unknown as ReadableStreamDefaultController);
  }

  override emit(event: Record<string, unknown>) {
    if (event.type === 'tool_start') this.toolCalls++;
    if (event.type === 'text_done' && typeof event.content === 'string') this.lastText = event.content;
    if (event.type === 'error' && typeof event.message === 'string') this.lastError = event.message;
    // Token-level deltas are too chatty to relay and replay
    if (event.type === 'text_delta' || event.type === 'reasoning_delta') return;
    this.parent.emit({
      type: 'subagent_event',
      stepIndex: this.meta.stepIndex,
      toolCallId: this.meta.toolCallId,
      label: this.meta.label,
      kind: this.meta.kind,
      event: { ...event, ts: Date.now() },
    });
  }
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.6);
  return `${s.slice(0, head)}\n…[report truncated: ${s.length - max} chars omitted]…\n${s.slice(-(max - head))}`;
}

const MAX_REPORT_CHARS = 16_000;

export async function runSubagent(req: SubagentRequest, env: SubagentEnv): Promise<SubagentRunResult> {
  const spec = KIND_SPECS[req.kind];
  const label = (req.label?.trim() || `${req.kind} agent`).slice(0, 60);
  const child = new SubagentEmitter(env.emitter, {
    toolCallId: env.toolCallId,
    stepIndex: env.parentStep,
    label,
    kind: req.kind,
  });

  // Lazy: agentLoop imports this module for the spawn_agent handling
  const { runAgentLoop } = await import('./agentLoop');

  const task =
    req.task.trim() +
    (req.context?.trim() ? `\n\n## Context from the main agent\n${req.context.trim()}` : '');

  const started = Date.now();
  const result = await runAgentLoop({
    projectId: env.projectId,
    workspaceRoot: env.workspaceRoot,
    messages: [{ role: 'user', content: task }],
    persistedCount: 0,
    llmConfig: env.llmConfig,
    tools: subagentToolSet(req.kind, env.tools),
    systemPrompt: subagentSystemPrompt(req.kind, env.systemPrompt, label),
    turnIndex: env.turnIndex,
    emitter: child,
    cancellation: env.cancellation,
    executionMode: 'auto',
    nested: {
      depth: env.depth + 1,
      label,
      kind: req.kind,
      maxSteps: spec.maxSteps,
      maxDurationMs: spec.maxDurationMs,
    },
  });

  const durationMs = Date.now() - started;
  const files = result.filesChanged;
  const report = (result.finalMessage ?? child.lastText ?? '').trim();
  const status = result.reason === 'completed' ? 'finished' : `stopped (${result.reason})`;
  const header =
    `[Sub-agent "${label}" (${req.kind}) ${status} — ${result.stepsCompleted} steps, ${child.toolCalls} tool calls, ` +
    `${result.totalTokens} tokens, ${(durationMs / 1000).toFixed(0)}s${files.length ? `; files changed: ${files.join(', ')}` : ''}]`;

  let body = report || (child.lastError ? `The sub-agent failed: ${child.lastError}` : '(the sub-agent produced no final report)');
  if (result.reason === 'max_steps' || result.reason === 'timeout') {
    body += `\n\n(The sub-agent hit its ${result.reason === 'timeout' ? 'time' : 'step'} limit before finishing — treat this report as partial.)`;
  } else if (result.reason === 'error' && child.lastError && report) {
    body += `\n\n(The sub-agent ended with an error: ${child.lastError})`;
  }

  return {
    success: result.reason === 'completed',
    output: `${header}\n\n${clip(body, MAX_REPORT_CHARS)}`,
    summary: `${label}: ${status}${files.length ? `, ${files.length} file${files.length > 1 ? 's' : ''} changed` : ''} (${child.toolCalls} tool calls)`,
    reason: result.reason,
    filesChanged: files,
    totalTokens: result.totalTokens,
    steps: result.stepsCompleted,
    toolCalls: child.toolCalls,
    durationMs,
  };
}
