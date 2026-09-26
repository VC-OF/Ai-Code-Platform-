import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

const state = vi.hoisted(() => ({
  calls: [] as { system: string; model: string; tools: string[]; isChild: boolean }[],
}));

vi.mock('@/lib/llmClient', () => ({
  getContextWindow: () => 128_000,
  callLLM: vi.fn(async () => ({
    content: 'plan', tool_calls: null, finish_reason: 'stop',
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })),
  callLLMStream: async function* (
    cfg: { model: string },
    messages: { role: string; content?: unknown }[],
    tools?: { function: { name: string } }[]
  ) {
    const system = String(messages[0]?.content ?? '');
    const isChild = system.includes('Sub-agent mode');
    const last = messages[messages.length - 1];
    state.calls.push({ system, model: cfg.model, tools: (tools ?? []).map((t) => t.function.name), isChild });
    if (!isChild && last.role === 'user') {
      const args = { agent: 'reviewer', task: 'Review src/math.ts and report issues.' };
      yield { type: 'tool_call_delta', tool_call: { index: 0, id: 'c1', name: 'spawn_agent', args: JSON.stringify(args) } };
      yield { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5 }, finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'delta', delta: isChild ? 'REVIEW: looks fine.' : 'Parent done.' };
    yield { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5 }, finishReason: 'stop' };
  },
}));

import { runAgentLoop } from '@/lib/agentLoop';
import { TOOL_SCHEMAS } from '@/lib/tools';
import { EventEmitter } from '@/lib/events';
import { CancellationSource } from '@/lib/cancellation';
import { projectDb } from '@/lib/db';
import { loadCustomAgents, parseCustomAgent, parseToolsField, formatCustomAgentsForPrompt } from '@/lib/customAgents';
import { customAgentToolSet, SPAWN_AGENT_ZOD } from '@/lib/subagents';
import { normalizeToolArgs } from '@/lib/toolArgNormalize';
import type { LLMTool } from '@/lib/llmClient';

class Collector extends EventEmitter {
  events: Record<string, unknown>[] = [];
  constructor() { super(null as unknown as ReadableStreamDefaultController); }
  override emit(event: Record<string, unknown>) { this.events.push({ ...event }); }
}

const TOOLS = TOOL_SCHEMAS as unknown as LLMTool[];
const REVIEWER = `---
name: reviewer
description: Reviews code for bugs
tools: Read, Grep, Glob, spawn_agent
model: review-model
---
You are a meticulous CODE REVIEWER. Never edit files.
`;

describe('custom agents: parsing', () => {
  it('maps Claude Code tool names', () => {
    expect(parseToolsField('Read, Grep, Glob, Bash, Edit, Write, WebFetch, WebSearch')).toEqual([
      'read_file', 'grep_files', 'glob_files', 'run_command', 'edit_file', 'create_file', 'fetch_url', 'web_search',
    ]);
    expect(parseToolsField(undefined)).toBeUndefined();
    expect(parseToolsField('[read_file, "Read"]')).toEqual(['read_file']);
  });

  it('parses frontmatter and body', () => {
    const a = parseCustomAgent(REVIEWER, 'x.md', '.claude/agents/x.md')!;
    expect(a).toMatchObject({ name: 'reviewer', description: 'Reviews code for bugs', model: 'review-model' });
    expect(a.tools).toEqual(['read_file', 'grep_files', 'glob_files', 'spawn_agent']);
    expect(a.prompt).toContain('CODE REVIEWER');
    const b = parseCustomAgent('Just a prompt', 'helper.md', 'h')!;
    expect(b.name).toBe('helper');
    expect(b.tools).toBeUndefined();
    expect(parseCustomAgent('---\nname: x\n---\n', 'x.md', 'x')).toBeNull();
  });

  it('loads from .claude/agents and .opencode/agents, first name wins', async () => {
    const ws = await createWorkspace({
      '.claude/agents/reviewer.md': REVIEWER,
      '.opencode/agents/reviewer.md': '---\nname: reviewer\n---\nduplicate',
      '.opencode/agents/docs.md': '---\ndescription: Writes docs\n---\nWrite docs.',
    });
    try {
      const agents = await loadCustomAgents(ws.root);
      expect(agents.map((a) => a.name)).toEqual(['reviewer', 'docs']);
      expect(agents[0].source).toBe('.claude/agents/reviewer.md');
      expect(formatCustomAgentsForPrompt(agents)).toContain('- docs: Writes docs');
    } finally {
      await ws.cleanup();
    }
  }, 30_000);

  it('restricts tools to the declared set minus exclusions', () => {
    const a = parseCustomAgent(REVIEWER, 'r.md', 'r')!;
    const names = customAgentToolSet(a, TOOLS).map((t) => (t as { function: { name: string } }).function.name);
    expect(names.sort()).toEqual(['glob_files', 'grep_files', 'read_file']);
  });

  it('validates and normalizes spawn_agent args', () => {
    expect(SPAWN_AGENT_ZOD.safeParse({ agent: 'reviewer', task: 'Review everything please.' }).success).toBe(true);
    expect(SPAWN_AGENT_ZOD.safeParse({ task: 'Review everything please.' }).success).toBe(false);
    expect(SPAWN_AGENT_ZOD.safeParse({ kind: 'explore', agent: 'x', task: 'Review everything please.' }).success).toBe(false);
    expect(normalizeToolArgs('spawn_agent', { subagent_type: 'docs-writer', prompt: 't' })).toMatchObject({ agent: 'docs-writer' });
    expect(normalizeToolArgs('spawn_agent', { agent: 'reviewer', prompt: 't' })).toMatchObject({ agent: 'reviewer' });
    const builtin = normalizeToolArgs('spawn_agent', { subagent_type: 'Explore', prompt: 't' }) as Record<string, unknown>;
    expect(builtin).toMatchObject({ kind: 'explore' });
    expect(builtin.agent).toBeUndefined();
    expect(normalizeToolArgs('spawn_agent', { agent: 'general-purpose', prompt: 't' })).toMatchObject({ kind: 'general' });
  });
});

describe('custom agents: spawn_agent in the loop', () => {
  let ws: TestWorkspace;
  beforeEach(async () => {
    ws = await createWorkspace({ 'src/math.ts': 'export const x = 1;\n', '.claude/agents/reviewer.md': REVIEWER });
    projectDb.create({ id: ws.projectId, name: 'custom agent test', workspace: ws.root, description: null });
    state.calls = [];
  });
  afterEach(async () => {
    try { projectDb.delete(ws.projectId); } catch {}
    await ws.cleanup();
  });

  it('passes the custom prompt, tools and model to the child', async () => {
    const emitter = new Collector();
    const result = await runAgentLoop({
      projectId: ws.projectId,
      workspaceRoot: ws.root,
      messages: [{ role: 'user', content: 'Review please.' }],
      persistedCount: 1,
      llmConfig: { model: 'parent-model' },
      tools: TOOLS,
      systemPrompt: 'PARENT PROMPT',
      turnIndex: 2,
      emitter,
      cancellation: new CancellationSource(),
    });
    expect(result.reason).toBe('completed');
    const child = state.calls.find((c) => c.isChild)!;
    expect(child.system.startsWith('PARENT PROMPT')).toBe(true);
    expect(child.system).toContain('CODE REVIEWER');
    expect(child.model).toBe('review-model');
    expect(child.tools.sort()).toEqual(['glob_files', 'grep_files', 'read_file']);
    const end = emitter.events.find((e) => e.type === 'tool_end' && e.toolName === 'spawn_agent')!;
    expect((end.result as { subagent: { report: string } }).subagent.report).toContain('(reviewer) finished');
  }, 30_000);
});
