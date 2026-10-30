// Message building, status, persistence and timeout helpers for the agent loop
import type { AgentLoopResult } from '../agentLoop';
import { type LLMMessage } from '../llmClient';
import { EventEmitter, type AgentStatus, type DoneReason } from '../events';
import { type ContextMessage } from '../contextManager';
import { messageDb } from '../db';
import { type HookRunResult } from '../hooks';
import { type SubagentRunResult } from '../subagents';
import crypto from 'crypto';

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function buildInitialMessages(
  systemPrompt: string,
  agentsMemory: string | undefined,
  userMessages: LLMMessage[]
): ContextMessage[] {
  // Keep the system prompt byte-stable across requests: providers cache the
  // longest unchanged message prefix, so per-request state (the active file)
  // is appended to the NEWEST user message instead of the system prompt.
  const system = [
    systemPrompt,
    agentsMemory ? `\n\n## Project Memory (AGENTS.md)\n${agentsMemory}` : '',
  ].filter(Boolean).join('');

  return [
    { role: 'system', content: system },
    ...userMessages,
  ] as ContextMessage[];
}

export function toolStatusFor(toolName: string): AgentStatus {
  const map: Record<string, AgentStatus> = {
    read_file:    'reading',
    load_skill:   'reading',
    list_files:   'reading',
    glob_files:   'reading',
    grep_files:   'reading',
    web_search:   'reading',
    fetch_url:    'reading',
    lsp_definition: 'reading', lsp_references: 'reading', lsp_hover: 'reading',
    lsp_symbols: 'reading', lsp_diagnostics: 'reading',
    create_file:  'writing',
    append_file:  'writing',
    edit_file:    'writing',
    delete_file:  'writing',
    replace_lines: 'writing',
    generate_image: 'writing',
    create_artifact: 'writing',
    run_lint:     'linting',
    run_tests:    'testing',
    run_command:  'running',
    read_preview_logs: 'reading',
    fetch_preview: 'reading',
    check_preview: 'testing',
    browser_open: 'testing', browser_snapshot: 'reading', browser_click: 'testing',
    browser_type: 'testing', browser_press: 'testing', browser_select: 'testing',
    browser_scroll: 'reading', browser_wait: 'testing', browser_console: 'reading',
    browser_screenshot: 'testing', browser_close: 'testing',
    update_plan:  'planning',
    deploy_app:   'running',
    ask_user:     'waiting',
    exit_plan_mode: 'waiting',
    execute_code: 'running',
    view_image:   'reading',
    mcp_list_resources: 'reading',
    mcp_read_resource:  'reading',
    notebook_edit: 'writing',
    run_notebook: 'running',
    save_memory:  'writing',
    spawn_agent:  'running',
    http_request: 'running',
    query_data:   'reading',
    plot_data:    'writing',
    review_changes: 'reading',
    multi_edit:   'writing',
    run_background: 'running',
    job_output:   'reading',
    kill_job:     'running',
    list_jobs:    'reading',
    github_create_pr: 'running', github_comment: 'running',
    github_list_prs: 'reading', github_get_pr: 'reading',
    github_list_issues: 'reading', github_get_issue: 'reading',
  };
  return map[toolName] ?? 'planning';
}

export function emitHookResults(emitter: EventEmitter, stepIndex: number, results: HookRunResult[]): void {
  for (const r of results) {
    emitter.emit({
      type: 'hook',
      stepIndex,
      event: r.event,
      command: r.command,
      source: r.source,
      exitCode: r.exitCode,
      blocked: r.blocked,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
      output: r.feedback.slice(0, 2_000),
      error: r.error,
    });
  }
}

export function failedSubagent(label: string, message: string): SubagentRunResult {
  return {
    success: false,
    output: `[Sub-agent "${label}" could not run: ${message}]`,
    summary: `${label}: failed to start`,
    reason: 'error',
    filesChanged: [],
    totalTokens: 0,
    steps: 0,
    toolCalls: 0,
    durationMs: 0,
  };
}

export function persistMessages(
  projectId: string,
  messages: ContextMessage[],
  turnIndex: number
): void {
  // The turn is saved in several batches (one per step) — continue the
  // sequence so the history reads back in order
  const base = messageDb.getMaxSeq(projectId, turnIndex) + 1;
  const rows = messages
    .filter((m) => m.role !== 'system')
    .map((m, i) => ({
      id:           crypto.randomUUID(),
      seq:          base + i,
      project_id:   projectId,
      role:         m.role,
      // Multimodal parts (view_image attachments) are stored as JSON
      content:      typeof m.content === 'string' ? m.content : m.content == null ? '' : JSON.stringify(m.content),
      tool_calls:   m.tool_calls ? JSON.stringify(m.tool_calls) : null,
      tool_call_id: m.tool_call_id ?? null,
      tool_name:    m.tool_name ?? null,
      turn_index:   turnIndex,
      tokens_used:  null,
    }));

  messageDb.insertMany(rows);
}

export function buildResult(
  reason: DoneReason,
  steps: number,
  filesChanged: string[],
  totalTokens: number,
  startTime: number,
  finalMessage?: string
): AgentLoopResult {
  return {
    success:        reason === 'completed',
    reason,
    stepsCompleted: steps,
    filesChanged,
    totalTokens,
    durationMs:     Date.now() - startTime,
    finalMessage,
  };
}

export async function callWithTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Call timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
