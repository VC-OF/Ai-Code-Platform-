import fs from 'fs/promises';
import path from 'path';
import { safeExec, CommandError } from './safeExec';

/**
 * Claude Code-compatible hooks: shell commands declared in the workspace's
 * `.claude/settings.json` (or `.claude/settings.local.json`,
 * `.opencode/settings.json`) that run around agent events.
 *
 *   {
 *     "hooks": {
 *       "PreToolUse":  [{ "matcher": "edit_file|create_file", "hooks": [{ "type": "command", "command": "node scripts/guard.js" }] }],
 *       "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "npm run lint" }] }],
 *       "Stop":        [{ "hooks": [{ "type": "command", "command": "npm test" }] }]
 *     }
 *   }
 *
 * Each hook receives a JSON payload on stdin (`hook_event_name`, `tool_name`,
 * `tool_input`, `tool_response`, `prompt`, `cwd`) plus OC_HOOK_* env vars.
 * Exit code 2 blocks the action (PreToolUse: the tool is not run; Stop: the
 * agent keeps working) and its stderr is fed back to the model. Any other
 * non-zero exit is reported but does not block. Commands go through
 * safeExec, so the host allowlist / docker sandbox apply exactly as they do
 * for run_command.
 */

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'Stop' | 'SubagentStop';

export const HOOK_EVENTS: HookEvent[] = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop'];

export const HOOK_SETTINGS_FILES = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.opencode/settings.json',
] as const;

export interface HookCommand {
  command: string;
  /** Per-hook timeout in ms (config `timeout` is in seconds, like Claude Code) */
  timeoutMs?: number;
}

export interface HookGroup {
  event: string;
  matcher?: string;
  commands: HookCommand[];
  /** Settings file the group came from (workspace-relative) */
  source: string;
}

export interface HookConfig {
  hooks: HookGroup[];
  /** Settings files that were found */
  files: string[];
  errors: string[];
}

export const EMPTY_HOOKS: HookConfig = { hooks: [], files: [], errors: [] };

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_PAYLOAD_CHARS = 16_000;
const MAX_FEEDBACK_CHARS = 4_000;

/** Flatten `{ Event: [{ matcher, hooks: [{ type, command, timeout }] }] }`. */
export function parseHooks(raw: unknown, source = ''): HookGroup[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: HookGroup[] = [];
  for (const [event, groups] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== 'object') continue;
      const g = group as { matcher?: unknown; hooks?: unknown };
      const commands: HookCommand[] = [];
      if (Array.isArray(g.hooks)) {
        for (const h of g.hooks) {
          if (!h || typeof h !== 'object') continue;
          const { type, command, timeout } = h as { type?: unknown; command?: unknown; timeout?: unknown };
          if (type !== undefined && type !== 'command') continue;
          if (typeof command !== 'string' || !command.trim()) continue;
          const seconds = Number(timeout);
          commands.push({
            command: command.trim(),
            timeoutMs: Number.isFinite(seconds) && seconds > 0
              ? Math.min(MAX_TIMEOUT_MS, Math.round(seconds * 1000))
              : undefined,
          });
        }
      }
      out.push({
        event,
        matcher: typeof g.matcher === 'string' ? g.matcher : undefined,
        commands,
        source,
      });
    }
  }
  return out;
}

/** Read every settings file in the workspace; missing files are fine. */
export async function loadHooks(workspace: string): Promise<HookConfig> {
  const config: HookConfig = { hooks: [], files: [], errors: [] };
  for (const rel of HOOK_SETTINGS_FILES) {
    const file = path.join(workspace, rel);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        config.errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }
    config.files.push(rel);
    try {
      const parsed = JSON.parse(text) as { hooks?: unknown };
      config.hooks.push(...parseHooks(parsed.hooks, rel));
    } catch (err) {
      config.errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return config;
}

/**
 * Claude Code matcher semantics: empty or "*" matches every tool; otherwise
 * the matcher is a regex that must match the whole tool name (so
 * "edit_file|create_file" works and "edit" does not match "edit_file").
 * An invalid regex falls back to an exact string comparison.
 */
export function matchesHook(matcher: string | undefined, toolName: string | undefined): boolean {
  const m = (matcher ?? '').trim();
  if (!m || m === '*') return true;
  if (!toolName) return false;
  try {
    return new RegExp(`^(?:${m})$`).test(toolName);
  } catch {
    return m === toolName;
  }
}

export function hooksFor(config: HookConfig, event: HookEvent, toolName?: string): HookGroup[] {
  return config.hooks.filter((g) => g.event === event && g.commands.length > 0 && matchesHook(g.matcher, toolName));
}

export interface HookInput {
  event: HookEvent;
  projectId: string;
  workspace: string;
  toolName?: string;
  toolInput?: unknown;
  /** Tool output text (PostToolUse) */
  toolOutput?: string;
  /** The user's prompt (UserPromptSubmit) */
  prompt?: string;
  /** The agent's final message (Stop / SubagentStop) */
  finalMessage?: string;
}

export interface HookRunResult {
  event: HookEvent;
  command: string;
  source: string;
  exitCode: number;
  /** Exit code 2 — the action must not proceed */
  blocked: boolean;
  /** Text to feed back to the model (stderr, falling back to stdout) */
  feedback: string;
  durationMs: number;
  timedOut: boolean;
  /** The command could not be started (e.g. not on the host allowlist) */
  error?: string;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

function payloadFor(input: HookInput): string {
  const payload = {
    hook_event_name: input.event,
    project_id: input.projectId,
    cwd: input.workspace,
    tool_name: input.toolName,
    tool_input: input.toolInput,
    tool_response: input.toolOutput !== undefined ? clip(input.toolOutput, MAX_PAYLOAD_CHARS) : undefined,
    prompt: input.prompt,
    final_message: input.finalMessage !== undefined ? clip(input.finalMessage, MAX_PAYLOAD_CHARS) : undefined,
  };
  return JSON.stringify(payload);
}

/** Run every hook registered for the event, in declaration order. */
export async function runHooks(
  config: HookConfig,
  input: HookInput,
  opts: { signal?: AbortSignal } = {}
): Promise<HookRunResult[]> {
  const groups = hooksFor(config, input.event, input.toolName);
  if (groups.length === 0) return [];

  const stdin = payloadFor(input);
  let toolInputJson = '';
  try {
    toolInputJson = clip(JSON.stringify(input.toolInput ?? null), 8_000);
  } catch {
    toolInputJson = '';
  }
  const env: Record<string, string> = {
    OC_HOOK_EVENT: input.event,
    OC_PROJECT_ID: input.projectId,
    OC_TOOL_NAME: input.toolName ?? '',
    OC_TOOL_INPUT: toolInputJson,
  };

  const results: HookRunResult[] = [];
  for (const group of groups) {
    for (const hook of group.commands) {
      const started = Date.now();
      try {
        const res = await safeExec(hook.command, input.workspace, {
          env,
          stdin,
          signal: opts.signal,
          timeoutMs: hook.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        const feedback = clip((res.stderr.trim() || res.stdout.trim()), MAX_FEEDBACK_CHARS);
        results.push({
          event: input.event,
          command: hook.command,
          source: group.source,
          exitCode: res.code,
          blocked: res.code === 2 && !res.timedOut,
          feedback,
          durationMs: Date.now() - started,
          timedOut: res.timedOut,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          event: input.event,
          command: hook.command,
          source: group.source,
          exitCode: -1,
          blocked: false,
          feedback: '',
          durationMs: Date.now() - started,
          timedOut: false,
          error: err instanceof CommandError
            ? `${message} (hooks run through the same sandbox as run_command)`
            : message,
        });
      }
    }
  }
  return results;
}

/** Collapse hook results into one decision + one note for the model. */
export function summarizeHookResults(results: HookRunResult[]): {
  blocked: boolean;
  reason: string;
  notes: string[];
} {
  const blocked = results.filter((r) => r.blocked);
  const notes: string[] = [];
  for (const r of results) {
    if (r.error) notes.push(`hook "${r.command}" could not run: ${r.error}`);
    else if (r.timedOut) notes.push(`hook "${r.command}" timed out`);
    else if (r.exitCode !== 0 && !r.blocked) {
      notes.push(`hook "${r.command}" exited ${r.exitCode}${r.feedback ? `: ${r.feedback}` : ''}`);
    }
  }
  const reason = blocked
    .map((r) => r.feedback || `hook "${r.command}" blocked this action (exit 2)`)
    .join('\n');
  return { blocked: blocked.length > 0, reason, notes };
}
