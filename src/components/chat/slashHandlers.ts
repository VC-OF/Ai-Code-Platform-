/**
 * Local slash-command handlers. ChatPanel builds a SlashContext and calls
 * runSlashCommand(); each handler either reports into the timeline via
 * ctx.say(), or returns a prompt for the agent (prompt-kind commands).
 */
import {
  buildIssueUrl,
  defaultExportFilename,
  formatConversationMarkdown,
  formatSlashHelp,
  formatUsageReport,
  matchModel,
  normalizeExportFilename,
  resolveCheckpoint,
  resolveProject,
  type ExportableMessage,
  type SlashCommandDefinition,
  type UsageRow,
} from '@/lib/slashCommands';
import { MODEL_OPTIONS } from '@/lib/modelOptions';
import {
  APPROVAL_REQUIRED_TOOLS,
  HOST_ALLOWED_BINS,
  HOST_ALLOWED_GIT_SUBCOMMANDS,
  HOST_BLOCKED_SUMMARY,
} from '@/lib/permissions';
import { OUTPUT_STYLES, isOutputStyle, type OutputStyle } from '@/lib/outputStyle';
import { VIM_STORAGE_KEY, VIM_TOGGLE_EVENT } from './MessageInput';

export type ExecutionMode = 'auto' | 'manual' | 'plan';

export interface SlashContext {
  projectId: string;
  projectName?: string;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  executionMode: ExecutionMode;
  setExecutionMode: (mode: ExecutionMode) => void;
  agentStatus: string;
  loading: boolean;
  statuslineVisible: boolean;
  setStatuslineVisible: (visible: boolean) => void;
  /** Append an assistant-style markdown note to the timeline */
  say: (markdown: string) => void;
  /** Append a structured timeline item (e.g. a skills_report card) */
  push?: (item: { type: string; [key: string]: unknown }) => void;
  /** User/assistant messages currently in the timeline, oldest first */
  getTranscript: () => ExportableMessage[];
}

export type SlashResult =
  | { type: 'handled' }
  | { type: 'prompt'; text: string }
  | { type: 'unhandled' };

const HANDLED: SlashResult = { type: 'handled' };

// ─── Persistence helpers ─────────────────────────────────────────────────────

export const STATUSLINE_STORAGE_KEY = 'oc-statusline-hidden';
const outputStyleKey = (projectId: string) => `oc-output-style:${projectId}`;

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function getOutputStyle(projectId: string): OutputStyle {
  const saved = storageGet(outputStyleKey(projectId));
  return isOutputStyle(saved) ? saved : 'default';
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `${res.status} ${res.statusText}`);
  }
  return data as T;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const q = (projectId: string) => `projectId=${encodeURIComponent(projectId)}`;
const openSurface = (target: string) => window.dispatchEvent(new CustomEvent('oc-open', { detail: { target } }));

// ─── Response types (subset of each API) ─────────────────────────────────────

interface GitStatus { branch?: string; changes?: { code: string; path: string }[] }
interface DockerStatus { available?: boolean; version?: string; sandboxModeActive?: boolean; defaultImage?: string; polyglotImageBuilt?: boolean; sandboxHint?: string; error?: string }
interface McpServer { server: string; connected: boolean; tools: string[]; error?: string }
interface McpInfo { configured: number; configPath: string; servers: McpServer[] }
interface Skill {
  name: string;
  description: string;
  source: string;
  group?: 'project' | 'global';
  listingTokens?: number;
  instructionTokens?: number;
}
interface WorkspaceInfo {
  workspace: string;
  writable: boolean;
  sandbox: 'docker' | 'local';
  version: string;
  hooks: { event: string; matcher?: string; commands: string[]; source?: string; supported?: boolean }[];
  hooksFile: string | null;
  hooksFiles?: string[];
  hooksError?: string;
  agents: { name: string; description?: string; file: string }[];
  commands?: { name: string; description: string; source: string }[];
}
interface ProviderStatus { id: string; label: string; kind: 'cloud' | 'local'; keyEnv: string | null; available: boolean }

// ─── Individual handlers ─────────────────────────────────────────────────────

const MODE_DESCRIPTIONS: Record<ExecutionMode, string> = {
  auto: 'Auto: the agent edits files and runs commands without pausing.',
  manual: `Manual: the agent asks before ${APPROVAL_REQUIRED_TOOLS.map((t) => `\`${t}\``).join(', ')}.`,
  plan: 'Plan: the agent writes a plan with `update_plan` before editing.',
};

function parseMode(arg: string): ExecutionMode | null {
  const a = arg.trim().toLowerCase();
  if (a === 'auto' || a === 'a') return 'auto';
  if (a === 'manual' || a === 'm') return 'manual';
  if (a === 'plan' || a === 'p') return 'plan';
  return null;
}

function switchMode(arg: string, ctx: SlashContext): boolean {
  if (!arg) return false;
  const mode = parseMode(arg);
  if (!mode) {
    ctx.say(`Unknown mode \`${arg}\`. Use \`auto\`, \`manual\` or \`plan\`.`);
    return true;
  }
  ctx.setExecutionMode(mode);
  ctx.say(`Execution mode set to **${mode}**.\n\n${MODE_DESCRIPTIONS[mode]}`);
  return true;
}

function handleMode(args: string, ctx: SlashContext) {
  if (switchMode(args, ctx)) return;
  ctx.say(
    `Execution mode: **${ctx.executionMode}**\n\n` +
    (Object.keys(MODE_DESCRIPTIONS) as ExecutionMode[])
      .map((m) => `- \`/mode ${m}\` — ${MODE_DESCRIPTIONS[m]}`)
      .join('\n')
  );
}

function handlePermissions(args: string, ctx: SlashContext) {
  if (switchMode(args, ctx)) return;
  const approval = ctx.executionMode === 'manual'
    ? `Tools that need your approval: ${APPROVAL_REQUIRED_TOOLS.map((t) => `\`${t}\``).join(', ')}.`
    : `No tools pause for approval in **${ctx.executionMode}** mode. Switch with \`/permissions manual\` to approve ${APPROVAL_REQUIRED_TOOLS.map((t) => `\`${t}\``).join(', ')}.`;
  ctx.say([
    `**Permissions**`,
    '',
    `- Execution mode: **${ctx.executionMode}** (change with \`/permissions auto|manual|plan\`)`,
    `- ${approval}`,
    '- File tools are confined to the project workspace; paths that escape it are rejected.',
    '',
    '**Host command allowlist** (local sandbox mode)',
    HOST_ALLOWED_BINS.map((b) => `\`${b}\``).join(', '),
    '',
    `git subcommands: ${HOST_ALLOWED_GIT_SUBCOMMANDS.map((b) => `\`${b}\``).join(', ')}`,
    '',
    '**Always blocked on the host**',
    ...HOST_BLOCKED_SUMMARY.map((line) => `- ${line}`),
    '',
    'In docker sandbox mode, commands run inside a throwaway container with no network (except package installs).',
  ].join('\n'));
}

function handleModel(args: string, ctx: SlashContext) {
  const current = ctx.selectedModel || 'default';
  if (!args) {
    const lines = MODEL_OPTIONS.map((o) =>
      `- \`${o.value}\` — ${o.label} (${o.group})${o.value === ctx.selectedModel ? ' **current**' : ''}`
    );
    ctx.say(`Current model: \`${current}\`\n\n${lines.join('\n')}\n\nSwitch with \`/model <name>\`.`);
    return;
  }
  if (!ctx.onModelChange) {
    ctx.say('The model can’t be changed from this view. Use the model picker in the top bar.');
    return;
  }
  const { match, candidates } = matchModel(args, MODEL_OPTIONS);
  if (match) {
    ctx.onModelChange(match.value);
    ctx.say(`Model switched to \`${match.value}\` (${match.label}).`);
  } else if (candidates.length > 1) {
    ctx.say(`\`${args}\` matches several models:\n\n${candidates.map((c) => `- \`${c.value}\``).join('\n')}\n\nBe more specific.`);
  } else {
    ctx.say(`Unknown model \`${args}\`. Type \`/model\` to see available models.`);
  }
}

async function handleUsage(ctx: SlashContext) {
  try {
    const data = await fetchJson<{ models: UsageRow[] }>(`/api/usage?${q(ctx.projectId)}`);
    ctx.say(formatUsageReport(data.models, ctx.projectName));
  } catch (err) {
    ctx.say(`Couldn’t load usage: ${errText(err)}`);
  }
}

async function handleStatus(ctx: SlashContext) {
  const [git, docker, info] = await Promise.all([
    fetchJson<GitStatus>(`/api/git/status?${q(ctx.projectId)}`).catch(() => null),
    fetchJson<DockerStatus>('/api/docker/status').catch(() => null),
    fetchJson<WorkspaceInfo>(`/api/workspace/info?${q(ctx.projectId)}`).catch(() => null),
  ]);
  ctx.say([
    '**Status**',
    '',
    `- Agent: ${ctx.agentStatus}${ctx.loading ? ' (running)' : ''}`,
    `- Model: \`${ctx.selectedModel || 'default'}\``,
    `- Execution mode: ${ctx.executionMode}`,
    `- Output style: ${getOutputStyle(ctx.projectId)}`,
    `- Project: ${ctx.projectName ?? 'untitled'} (\`${ctx.projectId}\`)`,
    `- Git branch: ${git?.branch ? `\`${git.branch}\`` : 'unavailable'}${git?.changes ? `, ${git.changes.length} changed file(s)` : ''}`,
    `- Docker: ${docker ? (docker.available ? `available${docker.version ? ` (${docker.version})` : ''}` : 'not running') : 'unknown'}`,
    `- Sandbox: ${info?.sandbox ?? 'unknown'}`,
    `- App version: ${info?.version ?? 'unknown'}`,
  ].join('\n'));
}

async function handleMcp(ctx: SlashContext) {
  try {
    const data = await fetchJson<McpInfo>('/api/mcp');
    if (data.servers.length === 0) {
      ctx.say(`No MCP servers configured. Add them to \`${data.configPath}\`.`);
      return;
    }
    const lines = data.servers.map((s) =>
      s.connected
        ? `- **${s.server}** — connected, ${s.tools.length} tool(s)${s.tools.length ? `: ${s.tools.map((t) => `\`${t}\``).join(', ')}` : ''}`
        : `- **${s.server}** — not connected${s.error ? `: ${s.error}` : ''}`
    );
    ctx.say(`**MCP servers** (${data.configured} configured in \`${data.configPath}\`)\n\n${lines.join('\n')}`);
  } catch (err) {
    ctx.say(`Couldn’t load MCP status: ${errText(err)}`);
  }
}

async function handleHooks(ctx: SlashContext) {
  try {
    const info = await fetchJson<WorkspaceInfo>(`/api/workspace/info?${q(ctx.projectId)}`);
    if (info.hooksError) {
      ctx.say(`Couldn’t read hooks: ${info.hooksError}`);
      return;
    }
    if (info.hooks.length === 0) {
      ctx.say('No hooks configured. Add a `hooks` key to `.claude/settings.json` in the project workspace.');
      return;
    }
    const lines = info.hooks.map((h) =>
      `- **${h.event}**${h.matcher ? ` (matcher \`${h.matcher}\`)` : ''}: ${h.commands.length ? h.commands.map((c) => `\`${c}\``).join(', ') : 'no commands'}${h.supported === false ? ' — _not run by this platform_' : ''}`
    );
    ctx.say([
      `**Hooks** from \`${(info.hooksFiles ?? [info.hooksFile]).filter(Boolean).join('`, `')}\``,
      '',
      ...lines,
      '',
      'The agent loop runs **PreToolUse**, **PostToolUse**, **UserPromptSubmit**, **Stop** and **SubagentStop** hooks. Each command gets the Claude Code JSON payload on stdin; exit code 2 blocks the action and feeds stderr back to the model. Commands run through the same sandbox as run_command.',
    ].join('\n'));
  } catch (err) {
    ctx.say(`Couldn’t read hooks: ${errText(err)}`);
  }
}

async function readAgentsMd(projectId: string): Promise<string> {
  const res = await fetch(`/api/files?path=AGENTS.md&${q(projectId)}`);
  if (!res.ok) return '';
  const data = await res.json().catch(() => ({}));
  return typeof data.content === 'string' ? data.content : '';
}

async function handleMemory(args: string, ctx: SlashContext) {
  try {
    const current = await readAgentsMd(ctx.projectId);
    if (!args) {
      ctx.say(
        current.trim()
          ? `**AGENTS.md** (project memory)\n\n\`\`\`markdown\n${current.trim()}\n\`\`\`\n\nAppend with \`/memory <text>\`, or edit it in Settings > Project memory (opened).`
          : 'AGENTS.md is empty. Append with `/memory <text>`, or edit it in Settings > Project memory (opened).'
      );
      openSurface('settings');
      return;
    }
    const line = `- ${args.replace(/\s*\n\s*/g, ' ').trim()}`;
    const next = current.trim() ? `${current.replace(/\s+$/, '')}\n${line}\n` : `# Project memory\n\n${line}\n`;
    await fetchJson('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: ctx.projectId, path: 'AGENTS.md', content: next }),
    });
    ctx.say(`Added to AGENTS.md:\n\n${line}`);
  } catch (err) {
    ctx.say(`Couldn’t update AGENTS.md: ${errText(err)}`);
  }
}

async function buildReviewPrompt(command: SlashCommandDefinition, args: string, ctx: SlashContext): Promise<string> {
  const base = command.prompt?.(args) ?? args;
  const git = await fetchJson<GitStatus>(`/api/git/status?${q(ctx.projectId)}`).catch(() => null);
  if (!git?.changes) return base;
  if (git.changes.length === 0) {
    return `${base}\n\nGit reports no uncommitted changes on \`${git.branch}\`; review the most recent commit instead (git show HEAD).`;
  }
  const files = git.changes.slice(0, 50).map((c) => `- ${c.code.trim() || '?'} ${c.path}`).join('\n');
  const more = git.changes.length > 50 ? `\n- …and ${git.changes.length - 50} more` : '';
  return `${base}\n\nChanged files on \`${git.branch}\` (git status):\n${files}${more}\n\nInspect the diffs with git diff before reporting.`;
}

async function handleDoctor(ctx: SlashContext) {
  const lines: string[] = [];
  const mark = (level: 'pass' | 'warn' | 'fail', text: string) =>
    lines.push(`- \`${level.toUpperCase()}\` ${text}`);

  const [health, docker, providers, mcp, info] = await Promise.all([
    fetchJson<{ status: string; database?: { ok: boolean; error?: string } }>('/api/health').catch((e) => e as Error),
    fetchJson<DockerStatus>('/api/docker/status').catch((e) => e as Error),
    fetchJson<{ providers: ProviderStatus[] }>('/api/providers').catch((e) => e as Error),
    fetchJson<McpInfo>('/api/mcp').catch((e) => e as Error),
    fetchJson<WorkspaceInfo>(`/api/workspace/info?${q(ctx.projectId)}`).catch((e) => e as Error),
  ]);

  if (health instanceof Error) mark('fail', `API health: ${health.message}`);
  else {
    mark(health.status === 'healthy' ? 'pass' : 'fail', `API health: ${health.status}`);
    mark(health.database?.ok ? 'pass' : 'fail', `Database: ${health.database?.ok ? 'ok' : health.database?.error ?? 'unavailable'}`);
  }

  if (docker instanceof Error) mark('warn', `Docker: ${docker.message}`);
  else if (docker.available) mark('pass', `Docker: running${docker.version ? ` (${docker.version})` : ''}, sandbox ${docker.sandboxModeActive ? 'on' : 'off'}`);
  else mark(info instanceof Error || info.sandbox === 'docker' ? 'fail' : 'warn', `Docker: not running${docker.error ? ` (${docker.error})` : ''}`);
  if (!(docker instanceof Error) && docker.available) {
    mark(
      docker.polyglotImageBuilt ? 'pass' : 'warn',
      `Sandbox image: ${docker.defaultImage ?? 'unknown'}${docker.polyglotImageBuilt
        ? ' (polyglot: Python/Rust/Go/Java)'
        : ` — ${docker.sandboxHint ?? 'Run npm run sandbox:build for Python/Rust/Go/Java support'}`}`,
    );
  }

  if (providers instanceof Error) mark('fail', `Providers: ${providers.message}`);
  else {
    const cloud = providers.providers.filter((p) => p.kind === 'cloud');
    const keyed = cloud.filter((p) => p.available);
    const local = providers.providers.filter((p) => p.kind === 'local' && p.available);
    mark(
      keyed.length + local.length > 0 ? 'pass' : 'fail',
      `Provider keys configured: ${keyed.length ? keyed.map((p) => `${p.label} (\`${p.keyEnv}\`)`).join(', ') : 'none'}` +
      (local.length ? `; local endpoints reachable: ${local.map((p) => p.label).join(', ')}` : '')
    );
    const missing = cloud.filter((p) => !p.available && p.keyEnv);
    if (missing.length) mark('warn', `No key for: ${missing.map((p) => `\`${p.keyEnv}\``).join(', ')}`);
  }

  if (mcp instanceof Error) mark('warn', `MCP: ${mcp.message}`);
  else if (mcp.servers.length === 0) mark('pass', 'MCP: no servers configured');
  else {
    const down = mcp.servers.filter((s) => !s.connected);
    mark(down.length ? 'warn' : 'pass', `MCP: ${mcp.servers.length - down.length}/${mcp.servers.length} server(s) connected${down.length ? ` (down: ${down.map((s) => s.server).join(', ')})` : ''}`);
  }

  if (info instanceof Error) mark('fail', `Workspace: ${info.message}`);
  else mark(info.writable ? 'pass' : 'fail', `Workspace ${info.writable ? 'writable' : 'not writable'}: \`${info.workspace}\``);

  ctx.say(`**Doctor**\n\n${lines.join('\n')}`);
}

function handleExport(args: string, ctx: SlashContext) {
  const messages = ctx.getTranscript();
  if (messages.length === 0) {
    ctx.say('Nothing to export yet.');
    return;
  }
  const title = ctx.projectName || 'Conversation';
  const fallback = defaultExportFilename(title);
  const filename = normalizeExportFilename(args, fallback);
  const blob = new Blob([formatConversationMarkdown(messages, title)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ctx.say(`Exported ${messages.length} message(s) to \`${filename}\`.`);
}

async function handleCopy(ctx: SlashContext) {
  const last = [...ctx.getTranscript()].reverse().find((m) => m.role === 'assistant');
  if (!last) {
    ctx.say('There is no assistant reply to copy yet.');
    return;
  }
  try {
    await navigator.clipboard.writeText(last.text);
    ctx.say(`Copied the last reply (${last.text.length.toLocaleString()} characters) to the clipboard.`);
  } catch (err) {
    ctx.say(`Couldn’t copy to the clipboard: ${errText(err)}`);
  }
}

async function handleRewind(args: string, ctx: SlashContext) {
  let checkpoints: { sha: string; timestamp: number; message: string }[];
  try {
    checkpoints = (await fetchJson<{ checkpoints: typeof checkpoints }>(`/api/git/checkpoints?${q(ctx.projectId)}`)).checkpoints;
  } catch (err) {
    ctx.say(`Couldn’t load checkpoints: ${errText(err)}`);
    return;
  }
  if (!args) {
    if (checkpoints.length === 0) {
      ctx.say('No checkpoints yet. The agent creates one before it edits files.');
      return;
    }
    const lines = checkpoints.map((c, i) =>
      `${i + 1}. \`${c.sha.slice(0, 8)}\` ${new Date(c.timestamp).toLocaleString()} — ${c.message}`
    );
    ctx.say(`**Checkpoints** (newest first)\n\n${lines.join('\n')}\n\nRestore with \`/rewind <n>\` or \`/rewind <hash>\`.`);
    return;
  }
  const target = resolveCheckpoint(args, checkpoints);
  if (!target) {
    ctx.say(`No single checkpoint matches \`${args}\`. Type \`/rewind\` to list them.`);
    return;
  }
  if (ctx.loading) {
    ctx.say('Stop the running agent before rewinding.');
    return;
  }
  if (!window.confirm(`Revert the whole workspace to ${target.sha.slice(0, 8)} (“${target.message}”)? Changes after it will be overwritten.`)) {
    ctx.say('Rewind cancelled.');
    return;
  }
  try {
    const data = await fetchJson<{ messagesRewound?: number }>('/api/git/revert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: ctx.projectId, sha: target.sha }),
    });
    // ChatPanel reloads its (now-truncated) history on this event
    window.dispatchEvent(new CustomEvent('oc-history-rewound'));
    setTimeout(() => ctx.say(
      `Workspace reverted to \`${target.sha.slice(0, 8)}\`.${data.messagesRewound ? ` ${data.messagesRewound} newer chat message(s) were rewound.` : ''}`
    ), 0);
  } catch (err) {
    ctx.say(`Rewind failed: ${errText(err)}`);
  }
}

async function handleResume(args: string, ctx: SlashContext) {
  let projects: { id: string; title: string; updatedAt?: number }[];
  try {
    projects = (await fetchJson<{ projects: typeof projects }>('/api/projects')).projects ?? [];
  } catch (err) {
    ctx.say(`Couldn’t load projects: ${errText(err)}`);
    return;
  }
  const recent = [...projects].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  if (!args) {
    const lines = recent.slice(0, 15).map((p) =>
      `- **${p.title}** \`${p.id}\`${p.id === ctx.projectId ? ' (open)' : ''}${p.updatedAt ? ` — ${new Date(p.updatedAt).toLocaleString()}` : ''}`
    );
    ctx.say(lines.length ? `**Recent projects**\n\n${lines.join('\n')}\n\nOpen one with \`/resume <id or name>\`.` : 'No projects yet.');
    return;
  }
  const target = resolveProject(args, recent);
  if (!target) {
    ctx.say(`No single project matches \`${args}\`. Type \`/resume\` to list them.`);
    return;
  }
  if (target.id === ctx.projectId) {
    ctx.say(`**${target.title}** is already open.`);
    return;
  }
  window.location.assign(`/?projectId=${encodeURIComponent(target.id)}`);
}

async function handleTodos(ctx: SlashContext) {
  try {
    const { tasks } = await fetchJson<{ tasks: { title: string; status: string }[] }>(`/api/plan?${q(ctx.projectId)}`);
    if (!tasks?.length) {
      ctx.say('No plan tasks yet. The agent creates them with `update_plan`.');
      return;
    }
    const done = tasks.filter((t) => t.status === 'completed').length;
    const lines = tasks.map((t) =>
      `- [${t.status === 'completed' ? 'x' : ' '}] ${t.title}${t.status === 'in_progress' ? ' (in progress)' : ''}`
    );
    ctx.say(`**Todos** — ${done}/${tasks.length} done\n\n${lines.join('\n')}`);
  } catch (err) {
    ctx.say(`Couldn’t load the plan: ${errText(err)}`);
  }
}

async function handleTasks(ctx: SlashContext) {
  const preview = await fetchJson<{ status: string; url: string | null }>(`/api/preview?${q(ctx.projectId)}`).catch(() => null);
  ctx.say([
    '**Background work**',
    '',
    `- Agent: ${ctx.loading ? `running (${ctx.agentStatus})` : 'idle'}`,
    `- Preview server: ${preview ? `${preview.status}${preview.url && preview.status !== 'stopped' ? ` at ${preview.url}` : ''}` : 'unknown'}`,
  ].join('\n'));
}

async function loadSkills(projectId: string): Promise<Skill[]> {
  const data = await fetchJson<{ skills?: Skill[] }>(`/api/skills?${q(projectId)}`);
  return data.skills ?? [];
}

async function handleSkills(ctx: SlashContext) {
  let skills: Skill[];
  try {
    skills = await loadSkills(ctx.projectId);
  } catch (err) {
    ctx.say(`Couldn’t load skills: ${errText(err)}`);
    return;
  }
  if (ctx.push) {
    ctx.push({ type: 'skills_report', skills, ts: Date.now() });
    return;
  }
  ctx.say(
    skills.length
      ? `**Skills** (${skills.length})\n\n${skills.map((s) => `- \`${s.name}\` — ${s.description} _(${s.source})_`).join('\n')}`
      : 'No skills yet. Add a SKILL.md under `.agents/skills/<name>/` in this project.'
  );
}

async function handleAgents(ctx: SlashContext) {
  const [skills, info] = await Promise.all([
    loadSkills(ctx.projectId).catch(() => [] as Skill[]),
    fetchJson<WorkspaceInfo>(`/api/workspace/info?${q(ctx.projectId)}`).catch(() => null),
  ]);
  const agents = info?.agents ?? [];
  ctx.say([
    '**Agents**',
    '',
    agents.length
      ? agents.map((a) => `- \`${a.name}\`${a.description ? ` — ${a.description}` : ''} _(${a.file})_`).join('\n')
      : '- No `.claude/agents/*.md` definitions in this workspace.',
    '',
    `**Skills** (${skills.length})`,
    '',
    skills.length ? skills.map((s) => `- \`${s.name}\` — ${s.description}`).join('\n') : '- None found.',
    '',
    `**Project commands** (${info?.commands?.length ?? 0})`,
    '',
    info?.commands?.length
      ? info.commands.map((c) => `- \`/${c.name}\` — ${c.description} _(${c.source})_`).join('\n')
      : '- None. Add `.claude/commands/<name>.md` files (use `$ARGUMENTS` in the body).',
    '',
    'The main agent can delegate with `spawn_agent` to sub-agents of kind `explore`, `research`, `verify` or `general`, each with its own context window and a restricted tool set; several run in parallel. Skills load on demand with load_skill. `.claude/agents/*.md` definitions are listed for reference.',
  ].join('\n'));
}

async function handlePlugin(ctx: SlashContext) {
  const [mcp, skills] = await Promise.all([
    fetchJson<McpInfo>('/api/mcp').catch(() => null),
    loadSkills(ctx.projectId).catch(() => null),
  ]);
  ctx.say([
    '**Installed extensions**',
    '',
    `- MCP servers: ${mcp ? (mcp.servers.length ? mcp.servers.map((s) => `${s.server} (${s.connected ? `${s.tools.length} tools` : 'down'})`).join(', ') : 'none') : 'unavailable'}`,
    `- Skills: ${skills ? (skills.length ? `${skills.length} (${skills.map((s) => s.name).join(', ')})` : 'none') : 'unavailable'}`,
    '',
    'Details: `/mcp`, `/skills`. There is no plugin marketplace in this self-hosted app.',
  ].join('\n'));
}

async function handleDocker(ctx: SlashContext) {
  try {
    const data = await fetchJson<DockerStatus & {
      containers?: { names?: string; id: string; image: string; status: string }[];
      containersRunning?: number; containersTotal?: number;
    }>('/api/docker/status?containers=true&refresh=true');
    if (!data.available) {
      ctx.say(`Docker isn’t running${data.error ? `: ${data.error}` : ''}. Commands run on the host until Docker Desktop starts.`);
      return;
    }
    const containers = (data.containers ?? []).slice(0, 5)
      .map((c) => `- \`${c.names || c.id.slice(0, 10)}\` ${c.image} — ${c.status}`);
    ctx.say([
      '**Docker**',
      '',
      `- Engine: ${data.version ?? 'online'}`,
      `- Sandbox mode: ${data.sandboxModeActive ? 'on' : 'off'}`,
      `- Default image: \`${data.defaultImage ?? 'unknown'}\``,
      `- Containers: ${data.containersRunning ?? 0} running / ${data.containersTotal ?? 0} total`,
      ...(containers.length ? ['', ...containers] : []),
    ].join('\n'));
  } catch (err) {
    ctx.say(`Couldn’t inspect Docker: ${errText(err)}`);
  }
}

async function handleSandbox(args: string, ctx: SlashContext) {
  const [docker, info] = await Promise.all([
    fetchJson<DockerStatus>('/api/docker/status').catch(() => null),
    fetchJson<WorkspaceInfo>(`/api/workspace/info?${q(ctx.projectId)}`).catch(() => null),
  ]);
  const active = info?.sandbox === 'docker';
  const status = [
    `**Sandbox**: ${active ? 'on — commands run in throwaway Docker containers' : 'off — commands run on the host through the allowlist'}`,
    `- Docker engine: ${docker?.available ? 'running' : 'not running'}`,
  ];
  const a = args.trim().toLowerCase();
  if (a === 'on' || a === 'off') {
    status.push(
      '',
      `The sandbox is a server setting, so it can’t be switched from the chat. Set \`SANDBOX_MODE=${a === 'on' ? 'docker' : 'local'}\` in \`.env.local\` and restart the server.`
    );
  } else if (a) {
    status.push('', 'Usage: `/sandbox [on|off]`.');
  }
  ctx.say(status.join('\n'));
}

async function handleReleaseNotes(ctx: SlashContext) {
  try {
    const { commits } = await fetchJson<{ commits: { sha: string; author: string; when: string; subject: string }[] }>(
      `/api/git/log?${q(ctx.projectId)}&limit=20`
    );
    ctx.say(
      commits.length
        ? `**Recent commits**\n\n${commits.map((c) => `- \`${c.sha}\` ${c.subject} — ${c.author}, ${c.when}`).join('\n')}`
        : 'No commits in this workspace yet.'
    );
  } catch (err) {
    ctx.say(`Couldn’t read the git log: ${errText(err)}`);
  }
}

async function handleAddDir(args: string, ctx: SlashContext) {
  const info = await fetchJson<WorkspaceInfo>(`/api/workspace/info?${q(ctx.projectId)}`).catch(() => null);
  ctx.say(
    `Additional directories aren’t supported${args ? `, so \`${args}\` was not added` : ''}. ` +
    'For safety, each project’s agent is confined to a single workspace and paths outside it are rejected.\n\n' +
    `Workspace: \`${info?.workspace ?? 'unknown'}\`\n\n` +
    'To work on another folder, open it as its own Build Mode project.'
  );
}

function handleOutputStyle(args: string, ctx: SlashContext) {
  const current = getOutputStyle(ctx.projectId);
  const a = args.trim().toLowerCase();
  if (!a) {
    ctx.say(`Output style: **${current}**\n\nOptions: ${OUTPUT_STYLES.map((s) => `\`${s}\``).join(', ')}. Set with \`/output-style <style>\`.`);
    return;
  }
  if (!isOutputStyle(a)) {
    ctx.say(`Unknown style \`${args}\`. Options: ${OUTPUT_STYLES.map((s) => `\`${s}\``).join(', ')}.`);
    return;
  }
  storageSet(outputStyleKey(ctx.projectId), a);
  ctx.say(`Output style set to **${a}** for this project. It applies from the next message.`);
}

function handleTheme(args: string, ctx: SlashContext) {
  const a = args.trim().toLowerCase();
  if (a && a !== 'light' && a !== 'dark') {
    ctx.say('Usage: `/theme [light|dark]`.');
    return;
  }
  const currentDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const theme = a || (currentDark ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', theme);
  storageSet('oc-theme', theme);
  window.dispatchEvent(new CustomEvent('oc-theme-change', { detail: { theme } }));
  ctx.say(`Theme set to ${theme}.`);
}

function handleVim(ctx: SlashContext) {
  const enabled = storageGet(VIM_STORAGE_KEY) !== 'on';
  storageSet(VIM_STORAGE_KEY, enabled ? 'on' : 'off');
  window.dispatchEvent(new CustomEvent(VIM_TOGGLE_EVENT, { detail: { enabled } }));
  ctx.say(
    enabled
      ? 'Vim keybindings on. Press Esc for normal mode (`h l 0 $ w b x dd`), and `i a A I` to insert. Ctrl + Enter still sends.'
      : 'Vim keybindings off.'
  );
}

function handleStatusline(ctx: SlashContext) {
  const next = !ctx.statuslineVisible;
  ctx.setStatuslineVisible(next);
  storageSet(STATUSLINE_STORAGE_KEY, next ? 'false' : 'true');
  ctx.say(`Chat status row ${next ? 'shown' : 'hidden'}.`);
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function runSlashCommand(
  command: SlashCommandDefinition,
  args: string,
  ctx: SlashContext
): Promise<SlashResult> {
  switch (command.name) {
    case 'help': ctx.say(formatSlashHelp()); return HANDLED;
    case 'status': await handleStatus(ctx); return HANDLED;
    case 'model': handleModel(args, ctx); return HANDLED;
    case 'cost':
    case 'usage': await handleUsage(ctx); return HANDLED;
    case 'config': openSurface('settings'); ctx.say('Opened Settings.'); return HANDLED;
    case 'permissions': handlePermissions(args, ctx); return HANDLED;
    case 'mode': handleMode(args, ctx); return HANDLED;
    case 'mcp': await handleMcp(ctx); return HANDLED;
    case 'hooks': await handleHooks(ctx); return HANDLED;
    case 'memory': await handleMemory(args, ctx); return HANDLED;
    case 'review':
    case 'security-review':
    case 'pr-comments': return { type: 'prompt', text: await buildReviewPrompt(command, args, ctx) };
    case 'doctor': await handleDoctor(ctx); return HANDLED;
    case 'export': handleExport(args, ctx); return HANDLED;
    case 'copy': await handleCopy(ctx); return HANDLED;
    case 'rewind': await handleRewind(args, ctx); return HANDLED;
    case 'resume': await handleResume(args, ctx); return HANDLED;
    case 'todos': await handleTodos(ctx); return HANDLED;
    case 'tasks': await handleTasks(ctx); return HANDLED;
    case 'agents': await handleAgents(ctx); return HANDLED;
    case 'skills': await handleSkills(ctx); return HANDLED;
    case 'plugin': await handlePlugin(ctx); return HANDLED;
    case 'docker': await handleDocker(ctx); return HANDLED;
    case 'add-dir': await handleAddDir(args, ctx); return HANDLED;
    case 'output-style': handleOutputStyle(args, ctx); return HANDLED;
    case 'theme': handleTheme(args, ctx); return HANDLED;
    case 'vim': handleVim(ctx); return HANDLED;
    case 'statusline': handleStatusline(ctx); return HANDLED;
    case 'terminal-setup':
      openSurface('terminal');
      ctx.say('Opened the terminal panel.\n\nComposer keys: Enter or Shift + Enter inserts a newline, Ctrl/Cmd + Enter sends, Esc stops a running agent. No terminal configuration is needed in the browser.');
      return HANDLED;
    case 'ide':
      window.open(`/editor?${q(ctx.projectId)}`, '_blank', 'noopener');
      ctx.say('Opened the code editor in a new tab.');
      return HANDLED;
    case 'sandbox': await handleSandbox(args, ctx); return HANDLED;
    case 'login':
      openSurface('keys');
      ctx.say('Opened the API keys dialog. Keys are stored encrypted on this machine.');
      return HANDLED;
    case 'logout':
      openSurface('keys');
      ctx.say('There is no account session to sign out of. Provider API keys are managed in the API keys dialog (opened); remove a key there to stop using it.');
      return HANDLED;
    case 'bug':
      window.open(buildIssueUrl(args), '_blank', 'noopener');
      ctx.say('Opened a new GitHub issue in a new tab.');
      return HANDLED;
    case 'release-notes': await handleReleaseNotes(ctx); return HANDLED;
    case 'privacy-settings':
      ctx.say([
        '**Where your data lives** — everything stays on this machine unless you send it to a model provider.',
        '',
        '- Projects, chat history, usage and checkpoints: SQLite database in `.platform/` (`open-code.db`).',
        '- Project files: `workspaces/<project id>/` (Build Mode projects use their own folder).',
        '- API keys and settings: stored encrypted in the platform settings store, never in the workspace.',
        '- Prompts and file contents are sent only to the model provider you select.',
      ].join('\n'));
      return HANDLED;
    case 'upgrade':
      ctx.say('`/upgrade` doesn’t apply: this is a self-hosted app with no subscription plan. Update it by pulling the repository.');
      return HANDLED;
    case 'install-github-app':
      ctx.say('`/install-github-app` doesn’t apply: this self-hosted app has no GitHub App. Use git remotes from the source control panel instead.');
      return HANDLED;
    case 'exit':
      window.location.assign('/');
      return HANDLED;
    default:
      return { type: 'unhandled' };
  }
}

