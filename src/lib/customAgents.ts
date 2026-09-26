import fs from 'fs/promises';
import path from 'path';

/**
 * Project-defined sub-agents, Claude Code style: every
 * `.claude/agents/<name>.md` (or `.opencode/agents/<name>.md`) declares an
 * agent the main agent can delegate to with `spawn_agent({ agent: '<name>' })`.
 *
 *   ---
 *   name: test-runner
 *   description: Runs the test suite and reports failures
 *   tools: Read, Grep, Bash
 *   model: gpt-4o-mini
 *   ---
 *   You are a test runner. …   ← the agent's system prompt
 *
 * `tools` lists tool names (Claude Code names are mapped to ours); omitted
 * means every tool a sub-agent may use. `model` is optional.
 */

export interface CustomAgent {
  name: string;
  description: string;
  /** Mapped tool names; undefined = inherit all non-excluded tools */
  tools?: string[];
  model?: string;
  /** The agent's system prompt (the file body) */
  prompt: string;
  /** Workspace-relative file */
  source: string;
}

export const AGENT_ROOTS = ['.claude/agents', '.opencode/agents'] as const;

const MAX_AGENTS = 50;
const MAX_PROMPT_CHARS = 20_000;
const NAME_RE = /^[\w-]+$/;

/** Claude Code tool names → Open Code tool names. */
export const CLAUDE_TOOL_MAP: Record<string, string> = {
  Read: 'read_file',
  Grep: 'grep_files',
  Glob: 'glob_files',
  Bash: 'run_command',
  Edit: 'edit_file',
  MultiEdit: 'edit_file',
  Write: 'create_file',
  WebFetch: 'fetch_url',
  WebSearch: 'web_search',
  LS: 'list_files',
  NotebookEdit: 'notebook_edit',
};

export function mapToolName(name: string): string {
  const n = name.trim();
  return CLAUDE_TOOL_MAP[n] ?? n;
}

/** Parse a comma- (or whitespace-/bracket-) separated tools field. */
export function parseToolsField(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const names = value
    .replace(/^\[|\]$/g, '')
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .map(mapToolName);
  if (names.length === 0) return undefined;
  return [...new Set(names)];
}

function parseFrontmatter(raw: string): { fields: Map<string, string>; body: string } {
  const fields = new Map<string, string>();
  const fm = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!fm) return { fields, body: raw.trim() };
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*?)\s*$/);
    if (m) fields.set(m[1].toLowerCase(), m[2].replace(/^["']|["']$/g, ''));
  }
  return { fields, body: raw.slice(fm[0].length).trim() };
}

export function parseCustomAgent(raw: string, fileName: string, source: string): CustomAgent | null {
  const { fields, body } = parseFrontmatter(raw);
  const name = (fields.get('name') || fileName.replace(/\.md$/i, '')).trim();
  if (!NAME_RE.test(name) || !body) return null;
  return {
    name,
    description: fields.get('description') || `Custom agent from ${source}`,
    tools: parseToolsField(fields.get('tools')),
    model: fields.get('model') && fields.get('model') !== 'inherit' ? fields.get('model') : undefined,
    prompt: body.slice(0, MAX_PROMPT_CHARS),
    source,
  };
}

/** Every custom agent in the workspace; the first definition of a name wins. */
export async function loadCustomAgents(workspace: string): Promise<CustomAgent[]> {
  const out: CustomAgent[] = [];
  const seen = new Set<string>();
  for (const root of AGENT_ROOTS) {
    let files: string[];
    try {
      files = (await fs.readdir(path.join(workspace, root))).filter((f) => f.toLowerCase().endsWith('.md')).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      if (out.length >= MAX_AGENTS) return out;
      let raw: string;
      try {
        raw = await fs.readFile(path.join(workspace, root, file), 'utf8');
      } catch {
        continue;
      }
      const agent = parseCustomAgent(raw, file, `${root}/${file}`);
      if (!agent || seen.has(agent.name.toLowerCase())) continue;
      seen.add(agent.name.toLowerCase());
      out.push(agent);
    }
  }
  return out;
}

export function findCustomAgent(agents: CustomAgent[], name: string): CustomAgent | undefined {
  const key = name.trim().toLowerCase();
  return agents.find((a) => a.name.toLowerCase() === key);
}

export function formatCustomAgentsForPrompt(agents: CustomAgent[]): string {
  if (agents.length === 0) return '';
  return (
    '## Custom agents\n' +
    'Project-defined sub-agents — delegate with spawn_agent({ agent: "<name>", task }) instead of `kind`:\n' +
    agents.map((a) => `- ${a.name}: ${a.description}`).join('\n')
  );
}
