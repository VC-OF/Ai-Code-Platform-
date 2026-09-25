import { readFileSync } from 'fs';
import path from 'path';
import { SYSTEM_PROMPT } from './systemPrompt';
import { createHarness, formatHarnessForPrompt } from './harness';
import {
  formatModeForPrompt,
  formatOutputStyleForPrompt,
  type PromptParts,
  type OutputStyle,
} from './promptComposer';
import { loadSkills, formatSkillsForPrompt, formatSkillListing, type SkillDefinition } from './skills';
import { listKnowledgeItems, formatKnowledgeForPrompt, type KnowledgeItem } from './knowledge';
import { TOOL_SCHEMAS } from './tools';
import { isDockerMode } from './safeExec';
import { getMcpToolSchemas } from './mcpClient';
import { projectDb, messageDb } from './db';
import { getContextWindow } from './models';
import { estimateTokens, estimateMessageTokens, type ContextMessage } from './contextManager';

export interface PromptProject {
  workspace: string;
  kind?: string | null;
}

export interface BuiltPromptParts {
  parts: PromptParts;
  mcpTools: Record<string, unknown>[];
  skills: SkillDefinition[];
  knowledgeItems: KnowledgeItem[];
  agentsMemory?: string;
}

/** Build every part of the system prompt exactly as the agent run uses it.
 * Shared by agentManager and /context so the two cannot drift. */
export async function buildPromptParts(
  project: PromptProject,
  opts: { mode?: 'auto' | 'manual' | 'plan'; outputStyle?: OutputStyle } = {}
): Promise<BuiltPromptParts> {
  let agentsMemory: string | undefined;
  try {
    agentsMemory = readFileSync(path.join(project.workspace, 'AGENTS.md'), 'utf-8');
  } catch {}

  // MCP servers contribute extra tools (mcp_<server>_<tool>)
  const mcpTools = await getMcpToolSchemas().catch(() => [] as Record<string, unknown>[]);
  const skills = await loadSkills(project.workspace, { includeGlobal: true });
  const knowledgeItems = await listKnowledgeItems(project.workspace).catch(() => [] as KnowledgeItem[]);

  const basePrompt = SYSTEM_PROMPT +
    (isDockerMode()
      ? '\n\nNote: run_command executes in an isolated container — full shell syntax (pipes, &&, redirection) is available. Network access only works for package-manager installs.'
      : '') +
    (mcpTools.length > 0
      ? `\n\nExternal tools: ${mcpTools.length} additional tool(s) are available from connected MCP servers (names starting with mcp_). Use them like any other tool.`
      : '') +
    (project.kind === 'build'
      ? '\n\nNote: this project is Build Mode — an existing, real codebase opened directly from disk, not a fresh scaffold. It may not follow any particular template or framework. Explore the file structure and read key files (README, package.json, lint/format configs) before making assumptions, and follow the project\'s existing conventions rather than introducing new ones.'
      : '');

  return {
    parts: {
      basePrompt,
      agentsMemory,
      harness: createHarness(project.kind as Parameters<typeof createHarness>[0]),
      skills,
      knowledgeItems,
      mode: opts.mode ?? 'auto',
      outputStyle: opts.outputStyle,
    },
    mcpTools,
    skills,
    knowledgeItems,
    agentsMemory,
  };
}

export type ContextCategoryKey = 'system' | 'tools' | 'mcp' | 'memory' | 'skills' | 'messages';

export interface ContextBreakdown {
  model: string;
  windowSize: number;
  used: number;
  categories: { key: ContextCategoryKey; label: string; tokens: number }[];
  buffer: number;
  free: number;
  compactThreshold: number;
  messageCount: number;
  messageTokens: number;
  mcpTools: { name: string; tokens: number }[];
  memoryFiles: { name: string; tokens: number }[];
  skills: { name: string; source: string; tokens: number }[];
}

export interface BreakdownInput {
  model: string;
  windowSize: number;
  parts: PromptParts;
  mcpTools: Record<string, unknown>[];
  messages: ContextMessage[];
  toolSchemas?: readonly unknown[];
}

function mcpToolName(schema: Record<string, unknown>): string {
  const fn = schema.function as { name?: string } | undefined;
  return fn?.name ?? String(schema.name ?? 'unknown');
}

/** Pure category math — separated from IO so it is unit-testable. */
export function computeBreakdownFromParts(input: BreakdownInput): ContextBreakdown {
  const { parts, windowSize } = input;
  const systemText = [
    parts.basePrompt,
    formatHarnessForPrompt(parts.harness),
    formatModeForPrompt(parts.mode),
    formatOutputStyleForPrompt(parts.outputStyle),
  ].filter(Boolean).join('\n\n');
  const memoryText = [
    parts.agentsMemory ? `## Project Memory (AGENTS.md)\n${parts.agentsMemory}` : '',
    formatKnowledgeForPrompt(parts.knowledgeItems ?? []),
  ].filter(Boolean).join('\n\n');
  const skillsText = formatSkillsForPrompt(parts.skills ?? []);
  const toolSchemas = input.toolSchemas ?? TOOL_SCHEMAS;
  const messageTokens = input.messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

  const categories: ContextBreakdown['categories'] = [
    { key: 'system', label: 'System prompt', tokens: estimateTokens(systemText) },
    { key: 'tools', label: 'System tools', tokens: estimateTokens(JSON.stringify(toolSchemas)) },
    { key: 'mcp', label: 'MCP tools', tokens: input.mcpTools.length ? estimateTokens(JSON.stringify(input.mcpTools)) : 0 },
    { key: 'memory', label: 'Memory files', tokens: memoryText ? estimateTokens(memoryText) : 0 },
    { key: 'skills', label: 'Skills', tokens: skillsText ? estimateTokens(skillsText) : 0 },
    { key: 'messages', label: 'Messages', tokens: messageTokens },
  ];
  const used = categories.reduce((s, c) => s + c.tokens, 0);
  const compactThreshold = Math.floor(windowSize * 0.6);
  const buffer = Math.max(0, Math.min(windowSize - compactThreshold, windowSize - used));
  const free = Math.max(0, windowSize - used - buffer);

  const desc = <T extends { tokens: number }>(a: T[]) => a.sort((x, y) => y.tokens - x.tokens);
  return {
    model: input.model,
    windowSize,
    used,
    categories,
    buffer,
    free,
    compactThreshold,
    messageCount: input.messages.length,
    messageTokens,
    mcpTools: desc(input.mcpTools.map((t) => ({ name: mcpToolName(t), tokens: estimateTokens(JSON.stringify(t)) }))),
    memoryFiles: desc([
      ...(parts.agentsMemory ? [{ name: 'AGENTS.md', tokens: estimateTokens(parts.agentsMemory) }] : []),
      ...(parts.knowledgeItems ?? []).map((ki) => ({
        name: ki.title,
        tokens: estimateTokens(`${ki.title}\n${ki.summary}\n${ki.content}`),
      })),
    ]),
    skills: desc((parts.skills ?? []).map((s) => ({
      name: s.name,
      source: s.source,
      tokens: estimateTokens(formatSkillListing(s)),
    }))),
  };
}

export function loadHistoryForContext(projectId: string): ContextMessage[] {
  return messageDb.getRecent(projectId, 500).map((m) => {
    let toolCalls: unknown = undefined;
    if (m.tool_calls) {
      try { toolCalls = JSON.parse(m.tool_calls); } catch {}
    }
    return {
      role: m.role as ContextMessage['role'],
      content: m.content,
      tool_calls: toolCalls,
      tool_call_id: m.tool_call_id ?? undefined,
      tool_name: m.tool_name ?? undefined,
    };
  });
}

export async function computeContextBreakdown({
  projectId,
  model,
}: { projectId: string; model: string }): Promise<ContextBreakdown> {
  const project = projectDb.getById(projectId);
  const messages = loadHistoryForContext(projectId);
  const windowSize = getContextWindow(model);
  if (!project) {
    return computeBreakdownFromParts({
      model, windowSize, messages, mcpTools: [],
      parts: { basePrompt: '', harness: createHarness('build'), skills: [] },
      toolSchemas: [],
    });
  }
  const built = await buildPromptParts(project);
  return computeBreakdownFromParts({ model, windowSize, messages, parts: built.parts, mcpTools: built.mcpTools });
}

