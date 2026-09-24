export type SlashCommandKind = 'local' | 'prompt';

export interface SlashCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  kind: SlashCommandKind;
  prompt?: (args: string) => string;
}

export interface ParsedSlashCommand {
  name: string;
  args: string;
  raw: string;
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: 'help', aliases: ['?'], description: 'Show available slash commands', kind: 'local' },
  { name: 'clear', aliases: ['reset'], description: 'Clear the current chat timeline', kind: 'local' },
  { name: 'status', description: 'Show the current agent status', kind: 'local' },
  { name: 'model', description: 'Show the selected model', kind: 'local' },
  { name: 'context', aliases: ['tokens', 'ctx'], description: 'Show context token usage and 2M token limit', kind: 'local' },
  { name: 'compact', aliases: ['compress'], description: 'Compact working context to free up tokens', kind: 'local' },
  { name: 'skills', aliases: ['skill'], description: 'Show active Antigravity and project skills', kind: 'local' },
  { name: 'docker', aliases: ['container', 'containers'], description: 'Inspect Docker engine status, containers, and sandbox', kind: 'local' },
  { name: 'mode', aliases: ['exec-mode'], description: 'Switch execution mode: /mode auto, /mode manual, or /mode plan', kind: 'local' },
  { name: 'cost', description: 'Inspect token and usage information', kind: 'prompt', prompt: (args) => `Inspect the recorded model usage and explain the token/cost information for this project. ${args}`.trim() },
  { name: 'review', aliases: ['pr-review'], description: 'Review the current changes for bugs and missing tests', kind: 'prompt', prompt: (args) => `Review the current changes like a code reviewer. Prioritize bugs, regressions, security risks, and missing tests. ${args}`.trim() },
  { name: 'build', description: 'Build a feature and verify it', kind: 'prompt', prompt: (args) => `Build this feature, then run the narrowest useful verification: ${args}` },
  { name: 'fix', description: 'Find and fix a bug', kind: 'prompt', prompt: (args) => `Find and fix this bug, then verify the fix: ${args}` },
  { name: 'test', aliases: ['tests'], description: 'Add or run focused tests', kind: 'prompt', prompt: (args) => `Add or run focused tests for this request, then report the results: ${args}` },
  { name: 'refactor', description: 'Refactor without changing behavior', kind: 'prompt', prompt: (args) => `Refactor this without changing behavior, then verify it: ${args}` },
  { name: 'explain', description: 'Explain the relevant code', kind: 'prompt', prompt: (args) => `Read the relevant files and explain how this works: ${args}` },
  { name: 'init', description: 'Inspect the project and establish project guidance', kind: 'prompt', prompt: (args) => `Inspect this project and update AGENTS.md with accurate conventions and verification commands. ${args}`.trim() },
  { name: 'memory', aliases: ['agents'], description: 'Update project memory guidance', kind: 'prompt', prompt: (args) => `Update the project memory in AGENTS.md with this guidance: ${args}` },
  { name: 'permissions', aliases: ['permission'], description: 'Explain the current tool safety boundaries', kind: 'prompt', prompt: () => 'Explain the current tool permissions, sandbox boundaries, and safety restrictions.' },
  { name: 'doctor', description: 'Diagnose project health and configuration', kind: 'prompt', prompt: (args) => `Diagnose the project health, configuration, and verification setup. ${args}`.trim() },
  { name: 'security-review', aliases: ['security'], description: 'Review the current changes for security risks', kind: 'prompt', prompt: (args) => `Perform a focused security review of the current project and changes. Report concrete risks and fixes. ${args}`.trim() },
  { name: 'pr-comments', aliases: ['pr-comments-review'], description: 'Review changes as pull-request feedback', kind: 'prompt', prompt: (args) => `Review the current changes as pull-request feedback. Group findings by severity and include file paths. ${args}`.trim() },
  { name: 'vim', description: 'Explain editor and keyboard configuration', kind: 'prompt', prompt: (args) => `Explain the available editor and keyboard configuration for this workspace. ${args}`.trim() },
  { name: 'terminal-setup', description: 'Explain terminal and command setup', kind: 'prompt', prompt: (args) => `Inspect and explain the terminal command setup and safe execution boundaries. ${args}`.trim() },
  { name: 'hooks', description: 'Inspect project hooks and automation', kind: 'prompt', prompt: (args) => `Inspect project hooks and automation configuration, then explain or update it as requested: ${args}` },
  { name: 'mcp', description: 'Inspect connected MCP tools', kind: 'prompt', prompt: (args) => `Inspect the connected MCP tool configuration and explain available capabilities or issues. ${args}`.trim() },
  { name: 'config', description: 'Inspect relevant project configuration', kind: 'prompt', prompt: (args) => `Inspect the relevant project configuration and explain or update it as requested: ${args}` },
  { name: 'plan', description: 'Create or continue an implementation plan', kind: 'prompt', prompt: (args) => `Create or continue a concrete implementation plan for: ${args}` },
  { name: 'resume', aliases: ['continue'], description: 'Continue unfinished planned work', kind: 'prompt', prompt: () => 'Continue working through the unfinished plan from the current project state.' },
  { name: 'add-dir', aliases: ['add_directory'], description: 'Explain how to work with another directory', kind: 'prompt', prompt: (args) => `Explain whether this project can safely work with the directory ${args}, and what configuration is required.` },
];

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const match = input.trim().match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: match[2]?.trim() ?? '', raw: input.trim() };
}

export function findSlashCommand(name: string): SlashCommandDefinition | undefined {
  const normalized = name.toLowerCase();
  return SLASH_COMMANDS.find((command) =>
    command.name === normalized || command.aliases?.includes(normalized)
  );
}

export function formatSlashHelp(): string {
  return [
    'Available slash commands:',
    ...SLASH_COMMANDS.map((command) => {
      const aliases = command.aliases?.length ? ` (${command.aliases.map((a) => `/${a}`).join(', ')})` : '';
      return `/${command.name}${aliases} - ${command.description}`;
    }),
  ].join('\n');
}
