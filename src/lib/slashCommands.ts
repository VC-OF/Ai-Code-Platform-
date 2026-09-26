/**
 * Slash-command registry and pure helpers (parsing, lookup, autocomplete
 * matching, help grouping, formatting). No React or browser APIs here —
 * the handlers that touch the UI live in components/chat/slashHandlers.ts.
 */

export type SlashCommandKind = 'local' | 'prompt';

export type SlashCommandGroup = 'Session' | 'Context' | 'Project' | 'Config' | 'Agent';

export const SLASH_COMMAND_GROUPS: SlashCommandGroup[] = ['Session', 'Context', 'Project', 'Config', 'Agent'];

export interface SlashCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  kind: SlashCommandKind;
  group: SlashCommandGroup;
  /** Argument syntax shown in help and autocomplete, e.g. "[model]" or "<path>" */
  args?: string;
  /** True when the argument is mandatory (Enter completes instead of running) */
  argsRequired?: boolean;
  prompt?: (args: string) => string;
}

export interface ParsedSlashCommand {
  name: string;
  args: string;
  raw: string;
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  // ── Session ────────────────────────────────────────────────────────────────
  { name: 'help', group: 'Session', kind: 'local', description: 'List all slash commands' },
  { name: 'clear', aliases: ['reset', 'new'], group: 'Session', kind: 'local', description: 'Clear the conversation timeline' },
  { name: 'resume', group: 'Session', kind: 'local', args: '[id or name]', description: 'List recent projects or open one' },
  { name: 'rewind', aliases: ['checkpoint'], group: 'Session', kind: 'local', args: '[n or hash]', description: 'List checkpoints or restore one' },
  { name: 'export', group: 'Session', kind: 'local', args: '[filename]', description: 'Download the conversation as Markdown' },
  { name: 'copy', group: 'Session', kind: 'local', description: 'Copy the last assistant reply to the clipboard' },
  { name: 'exit', aliases: ['quit'], group: 'Session', kind: 'local', description: 'Close the project and return to the welcome screen' },

  // ── Context ────────────────────────────────────────────────────────────────
  { name: 'context', aliases: ['tokens', 'ctx'], group: 'Context', kind: 'local', description: 'Show context window usage' },
  { name: 'compact', aliases: ['compress'], group: 'Context', kind: 'local', args: '[instructions]', description: 'Summarize older messages to free context' },
  { name: 'cost', group: 'Context', kind: 'local', description: 'Show token usage and estimated cost for this project' },
  { name: 'usage', group: 'Context', kind: 'local', description: 'Show token usage per model for this project' },
  { name: 'memory', group: 'Context', kind: 'local', args: '[text]', description: 'Show AGENTS.md or append a line to it' },
  { name: 'todos', group: 'Context', kind: 'local', description: 'Show the current plan tasks' },

  // ── Project ────────────────────────────────────────────────────────────────
  { name: 'init', group: 'Project', kind: 'prompt', args: '[notes]', description: 'Inspect the project and write AGENTS.md guidance',
    prompt: (args) => `Inspect this project and create or update AGENTS.md with accurate conventions, architecture notes and verification commands (build, lint, test). ${args}`.trim() },
  { name: 'review', aliases: ['pr-review'], group: 'Project', kind: 'prompt', args: '[focus]', description: 'Review the current changes for bugs and missing tests',
    prompt: (args) => `Review the current changes like a code reviewer. Prioritize bugs, regressions, security risks, and missing tests. ${args}`.trim() },
  { name: 'security-review', aliases: ['security'], group: 'Project', kind: 'prompt', args: '[focus]', description: 'Review the current changes for security risks',
    prompt: (args) => `Perform a focused security review of the pending changes. Report concrete, exploitable risks with file paths and fixes. ${args}`.trim() },
  { name: 'pr-comments', group: 'Project', kind: 'prompt', args: '[focus]', description: 'Write pull-request review comments for the changes',
    prompt: (args) => `Review the current changes as pull-request feedback. Group findings by severity and include file paths. ${args}`.trim() },
  { name: 'release-notes', group: 'Project', kind: 'local', description: 'Show recent commits in this workspace' },
  { name: 'status', group: 'Project', kind: 'local', description: 'Show agent, model, mode, branch and version' },
  { name: 'doctor', group: 'Project', kind: 'local', description: 'Run local health diagnostics' },
  { name: 'ide', group: 'Project', kind: 'local', description: 'Open the code editor page' },
  { name: 'add-dir', group: 'Project', kind: 'local', args: '<path>', description: 'Explain workspace confinement (extra directories are not supported)' },
  { name: 'bug', aliases: ['feedback'], group: 'Project', kind: 'local', args: '[title]', description: 'Open a GitHub issue for this platform' },

  // ── Config ─────────────────────────────────────────────────────────────────
  { name: 'config', aliases: ['settings'], group: 'Config', kind: 'local', description: 'Open the Settings tab' },
  { name: 'model', group: 'Config', kind: 'local', args: '[name]', description: 'List models or switch the selected model' },
  { name: 'permissions', aliases: ['allowed-tools', 'permission'], group: 'Config', kind: 'local', args: '[auto|manual|plan]', description: 'Show approval rules and blocked commands, or switch mode' },
  { name: 'mode', aliases: ['exec-mode'], group: 'Config', kind: 'local', args: '[auto|manual|plan]', description: 'Show or switch the execution mode' },
  { name: 'output-style', group: 'Config', kind: 'local', args: '[default|explanatory|learning|concise]', description: 'Show or set the response style' },
  { name: 'theme', group: 'Config', kind: 'local', args: '[light|dark]', description: 'Toggle or set the color theme' },
  { name: 'vim', group: 'Config', kind: 'local', description: 'Toggle vim keybindings in the composer' },
  { name: 'statusline', group: 'Config', kind: 'local', description: 'Toggle the chat status row' },
  { name: 'terminal-setup', group: 'Config', kind: 'local', description: 'Open the terminal and show composer key bindings' },
  { name: 'sandbox', group: 'Config', kind: 'local', args: '[on|off]', description: 'Show sandboxed execution status' },
  { name: 'login', group: 'Config', kind: 'local', description: 'Open the API keys dialog' },
  { name: 'logout', group: 'Config', kind: 'local', description: 'Explain key management and open the API keys dialog' },
  { name: 'privacy-settings', group: 'Config', kind: 'local', description: 'Explain where data is stored' },
  { name: 'upgrade', group: 'Config', kind: 'local', description: 'Not applicable to this self-hosted app' },
  { name: 'install-github-app', group: 'Config', kind: 'local', description: 'Not applicable to this self-hosted app' },

  // ── Agent ──────────────────────────────────────────────────────────────────
  { name: 'agents', group: 'Agent', kind: 'local', description: 'List skills and .claude/agents definitions' },
  { name: 'skills', aliases: ['skill'], group: 'Agent', kind: 'local', description: 'List active skills' },
  { name: 'mcp', group: 'Agent', kind: 'local', description: 'List MCP servers, tools and connection status' },
  { name: 'hooks', group: 'Agent', kind: 'local', description: 'Show hooks configured in .claude/settings.json' },
  { name: 'plugin', aliases: ['plugins'], group: 'Agent', kind: 'local', description: 'List installed extensions (MCP servers and skills)' },
  { name: 'tasks', aliases: ['bashes'], group: 'Agent', kind: 'local', description: 'Show running background work' },
  { name: 'docker', aliases: ['container', 'containers'], group: 'Agent', kind: 'local', description: 'Inspect Docker engine and containers' },
  { name: 'plan', group: 'Agent', kind: 'prompt', args: '<goal>', argsRequired: true, description: 'Create or continue an implementation plan',
    prompt: (args) => `Create or continue a concrete implementation plan for: ${args}` },
  { name: 'build', group: 'Agent', kind: 'prompt', args: '<feature>', argsRequired: true, description: 'Build a feature and verify it',
    prompt: (args) => `Build this feature, then run the narrowest useful verification: ${args}` },
  { name: 'fix', group: 'Agent', kind: 'prompt', args: '<bug>', argsRequired: true, description: 'Find and fix a bug',
    prompt: (args) => `Find and fix this bug, then verify the fix: ${args}` },
  { name: 'test', aliases: ['tests'], group: 'Agent', kind: 'prompt', args: '<target>', argsRequired: true, description: 'Add or run focused tests',
    prompt: (args) => `Add or run focused tests for this request, then report the results: ${args}` },
  { name: 'refactor', group: 'Agent', kind: 'prompt', args: '<target>', argsRequired: true, description: 'Refactor without changing behavior',
    prompt: (args) => `Refactor this without changing behavior, then verify it: ${args}` },
  { name: 'explain', group: 'Agent', kind: 'prompt', args: '<topic>', argsRequired: true, description: 'Explain the relevant code',
    prompt: (args) => `Read the relevant files and explain how this works: ${args}` },
];

// ─── Parsing & lookup ────────────────────────────────────────────────────────

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  // Names may carry one namespace segment for project commands ("/db:migrate")
  const match = input.trim().match(/^\/([\w-]+(?::[\w-]+)?)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: match[2]?.trim() ?? '', raw: input.trim() };
}

export function findSlashCommand(
  name: string,
  commands: SlashCommandDefinition[] = SLASH_COMMANDS
): SlashCommandDefinition | undefined {
  const normalized = name.toLowerCase();
  return commands.find((command) =>
    command.name === normalized || command.aliases?.includes(normalized)
  );
}

/** Text typed so far is a command name being completed ("/co", not "/compact x"). */
export function getSlashQuery(input: string): string | null {
  const match = input.match(/^\/([\w-]*(?::[\w-]*)?)$/);
  return match ? match[1].toLowerCase() : null;
}

// ─── Project (custom) commands ───────────────────────────────────────────────

/** A `.claude/commands/<name>.md` command as served by /api/commands. */
export interface CustomCommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
  body: string;
  source: string;
}

/**
 * Substitute `$ARGUMENTS` and `$1`…`$9` (whitespace-separated, quotes
 * respected) in a command body. A body without placeholders gets the
 * arguments appended, so `/cmd extra notes` still passes them along.
 */
export function expandCommandBody(body: string, args: string): string {
  const trimmed = args.trim();
  const words = trimmed.match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^(["'])(.*)\1$/, '$2')) ?? [];
  const hasPlaceholder = /\$ARGUMENTS\b|\$[1-9]\b/.test(body);
  const expanded = body
    .replace(/\$ARGUMENTS\b/g, trimmed)
    .replace(/\$([1-9])\b/g, (_, n: string) => words[Number(n) - 1] ?? '');
  if (hasPlaceholder || !trimmed) return expanded.trim();
  return `${expanded.trim()}\n\n${trimmed}`;
}

/** Turn served project commands into registry entries (listed under "Project"). */
export function customCommandDefinitions(commands: CustomCommandInfo[]): SlashCommandDefinition[] {
  const builtin = new Set(SLASH_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]));
  return commands
    .filter((c) => /^[\w-]+(:[\w-]+)?$/.test(c.name) && !builtin.has(c.name.toLowerCase()))
    .map((c) => ({
      name: c.name.toLowerCase(),
      group: 'Project' as const,
      kind: 'prompt' as const,
      description: c.description,
      args: c.argumentHint ?? '[arguments]',
      prompt: (args: string) => expandCommandBody(c.body, args),
    }));
}

/**
 * Autocomplete: name prefix matches first, then alias prefix matches, then
 * substring matches in the name or description. Registry order breaks ties.
 */
export function matchSlashCommands(
  query: string,
  commands: SlashCommandDefinition[] = SLASH_COMMANDS
): SlashCommandDefinition[] {
  const q = query.toLowerCase().replace(/^\//, '');
  if (!q) return [...commands];
  const rank = (c: SlashCommandDefinition): number => {
    if (c.name.startsWith(q)) return 0;
    if (c.aliases?.some((a) => a.startsWith(q))) return 1;
    if (c.name.includes(q)) return 2;
    if (c.aliases?.some((a) => a.includes(q))) return 3;
    if (c.description.toLowerCase().includes(q)) return 4;
    return -1;
  };
  return commands
    .map((command, index) => ({ command, index, score: rank(command) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((r) => r.command);
}

export function groupSlashCommands(
  commands: SlashCommandDefinition[] = SLASH_COMMANDS
): { group: SlashCommandGroup; commands: SlashCommandDefinition[] }[] {
  return SLASH_COMMAND_GROUPS
    .map((group) => ({ group, commands: commands.filter((c) => c.group === group) }))
    .filter((g) => g.commands.length > 0);
}

export function formatSlashUsage(command: SlashCommandDefinition): string {
  return command.args ? `/${command.name} ${command.args}` : `/${command.name}`;
}

export function formatSlashHelp(commands: SlashCommandDefinition[] = SLASH_COMMANDS): string {
  const sections = groupSlashCommands(commands).map(({ group, commands: list }) => {
    const lines = list.map((command) => {
      const aliases = command.aliases?.length
        ? ` (${command.aliases.map((a) => `/${a}`).join(', ')})`
        : '';
      return `- \`${formatSlashUsage(command)}\`${aliases} — ${command.description}`;
    });
    return `**${group}**\n${lines.join('\n')}`;
  });
  return [
    'Slash commands. Type `/` to autocomplete. Add your own as `.claude/commands/<name>.md` in the project (use `$ARGUMENTS` in the body).',
    ...sections,
  ].join('\n\n');
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function formatTokenCount(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

export function formatUsd(n: number): string {
  const value = Number(n) || 0;
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export interface UsageRow {
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

export function formatUsageReport(rows: UsageRow[], projectName?: string): string {
  const title = `Token usage${projectName ? ` for ${projectName}` : ''}`;
  if (rows.length === 0) return `${title}\n\nNo model requests have been recorded for this project yet.`;
  const totals = rows.reduce(
    (acc, r) => ({
      requests: acc.requests + r.requests,
      input: acc.input + r.prompt_tokens,
      output: acc.output + r.completion_tokens,
      cost: acc.cost + r.cost_usd,
    }),
    { requests: 0, input: 0, output: 0, cost: 0 }
  );
  const lines = rows.map((r) =>
    `| \`${r.model}\` | ${r.requests} | ${formatTokenCount(r.prompt_tokens)} | ${formatTokenCount(r.completion_tokens)} | ${r.cost_usd > 0 ? formatUsd(r.cost_usd) : '—'} |`
  );
  return [
    `**${title}**`,
    '',
    `- Requests: ${totals.requests}`,
    `- Input tokens: ${formatTokenCount(totals.input)}`,
    `- Output tokens: ${formatTokenCount(totals.output)}`,
    `- Estimated cost: ${totals.cost > 0 ? formatUsd(totals.cost) : 'no pricing data for these models'}`,
    '',
    '| Model | Requests | Input | Output | Cost |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...lines,
  ].join('\n');
}

/**
 * Resolve a /model argument: exact value, then exact label, then a unique
 * case-insensitive substring match over value and label.
 */
export function matchModel<T extends { value: string; label: string }>(
  query: string,
  options: T[]
): { match?: T; candidates: T[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { candidates: [] };
  const exact = options.find((o) => o.value.toLowerCase() === q || o.label.toLowerCase() === q);
  if (exact) return { match: exact, candidates: [exact] };
  const normalize = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, '');
  const nq = normalize(q);
  const candidates = options.filter(
    (o) => normalize(o.value).includes(nq) || normalize(o.label).includes(nq)
  );
  return { match: candidates.length === 1 ? candidates[0] : undefined, candidates };
}

/** Pick a checkpoint by 1-based list index or by (prefix of) its hash. */
export function resolveCheckpoint<T extends { sha: string }>(arg: string, checkpoints: T[]): T | undefined {
  const a = arg.trim().toLowerCase();
  if (!a) return undefined;
  if (/^\d{1,3}$/.test(a)) {
    const n = Number(a);
    return n >= 1 && n <= checkpoints.length ? checkpoints[n - 1] : undefined;
  }
  if (!/^[0-9a-f]{4,40}$/.test(a)) return undefined;
  const matches = checkpoints.filter((c) => c.sha.toLowerCase().startsWith(a));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Pick a project by exact id, exact title, or unique title substring. */
export function resolveProject<T extends { id: string; title: string }>(arg: string, projects: T[]): T | undefined {
  const a = arg.trim().toLowerCase();
  if (!a) return undefined;
  const exact = projects.find((p) => p.id.toLowerCase() === a || p.title.toLowerCase() === a);
  if (exact) return exact;
  const matches = projects.filter((p) => p.title.toLowerCase().includes(a));
  return matches.length === 1 ? matches[0] : undefined;
}

export interface ExportableMessage {
  role: string;
  text: string;
  ts?: number;
}

export function formatConversationMarkdown(messages: ExportableMessage[], title: string, exportedAt = new Date()): string {
  const body = messages
    .filter((m) => m.text.trim())
    .map((m) => `## ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.text.trim()}`)
    .join('\n\n');
  return `# ${title}\n\nExported ${exportedAt.toISOString()}\n\n${body}\n`;
}

export function defaultExportFilename(projectName: string, date = new Date()): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'conversation';
  return `${slug}-${date.toISOString().slice(0, 10)}.md`;
}

/** Sanitize a user-supplied export filename and ensure a .md extension. */
export function normalizeExportFilename(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '');
  if (!cleaned) return fallback;
  return /\.(md|markdown)$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
}

export function buildIssueUrl(title: string): string {
  const url = new URL('https://github.com/VC-OF/Ai-Code-Platform-/issues/new');
  if (title.trim()) url.searchParams.set('title', title.trim());
  return url.toString();
}
