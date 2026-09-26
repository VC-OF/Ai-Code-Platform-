import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import type { ChatCompletionMessageParam } from 'openai/resources';

// ─── Scripted LLM: replies depend on who is asking and what came last ───────
type Msg = ChatCompletionMessageParam & { content?: unknown };
type Reply = { text: string } | { calls: { id: string; name: string; args: Record<string, unknown> }[] };
type Responder = (ctx: { isChild: boolean; label: string; last: Msg; messages: Msg[]; tools: string[] }) => Reply | Promise<Reply>;

const state = vi.hoisted(() => ({
  responder: null as null | ((ctx: { isChild: boolean; label: string; last: { role: string; content?: unknown }; messages: unknown[]; tools: string[] }) => unknown),
  calls: [] as { isChild: boolean; label: string; tools: string[]; lastRole: string; t: number }[],
}));

vi.mock('@/lib/llmClient', () => ({
  getContextWindow: () => 128_000,
  callLLM: vi.fn(async () => ({
    content: 'plan', tool_calls: null, finish_reason: 'stop',
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })),
  callLLMStream: async function* (_cfg: unknown, messages: Msg[], tools?: { function: { name: string } }[]) {
    const system = String(messages[0]?.content ?? '');
    const isChild = system.includes('Sub-agent mode');
    const label = system.match(/Sub-agent mode: \w+ \("([^"]+)"\)/)?.[1] ?? 'main';
    const last = messages[messages.length - 1];
    const names = (tools ?? []).map((t) => t.function.name);
    state.calls.push({ isChild, label, tools: names, lastRole: last.role, t: Date.now() });
    const reply = (await (state.responder as Responder)({ isChild, label, last, messages, tools: names })) as Reply;
    if ('calls' in reply) {
      for (const [i, c] of reply.calls.entries()) {
        yield { type: 'tool_call_delta', tool_call: { index: i, id: c.id, name: c.name, args: JSON.stringify(c.args) } };
      }
      yield { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5 }, finishReason: 'tool_calls' };
    } else {
      yield { type: 'delta', delta: reply.text };
      yield { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5 }, finishReason: 'stop' };
    }
  },
}));

import { runAgentLoop } from '@/lib/agentLoop';
import { TOOL_SCHEMAS } from '@/lib/tools';
import { EventEmitter } from '@/lib/events';
import { CancellationSource } from '@/lib/cancellation';
import { projectDb, messageDb } from '@/lib/db';
import { subagentToolSet, subagentSystemPrompt, SUBAGENT_EXCLUDED_TOOLS } from '@/lib/subagents';
import type { LLMTool } from '@/lib/llmClient';

class Collector extends EventEmitter {
  events: Record<string, unknown>[] = [];
  constructor() { super(null as unknown as ReadableStreamDefaultController); }
  override emit(event: Record<string, unknown>) { this.events.push({ ...event }); }
}

const TOOLS = TOOL_SCHEMAS as unknown as LLMTool[];
const toolNames = (tools: LLMTool[]) => tools.map((t) => (t as { function: { name: string } }).function.name);

describe('sub-agent tool sets and prompts', () => {
  it('restricts tools per kind and never exposes excluded ones', () => {
    const explore = toolNames(subagentToolSet('explore', TOOLS));
    expect(explore).toContain('read_file');
    expect(explore).toContain('grep_files');
    expect(explore).not.toContain('create_file');
    expect(explore).not.toContain('run_command');
    expect(explore).not.toContain('execute_code');

    const research = toolNames(subagentToolSet('research', TOOLS));
    expect(research).toContain('web_search');
    expect(research).toContain('execute_code');
    expect(research).not.toContain('edit_file');

    const verify = toolNames(subagentToolSet('verify', TOOLS));
    expect(verify).toContain('run_tests');
    expect(verify).toContain('run_command');
    expect(verify).toContain('browser_click');
    expect(verify).not.toContain('create_file');

    const general = toolNames(subagentToolSet('general', TOOLS));
    expect(general).toContain('create_file');
    expect(general).toContain('run_tests');
    for (const name of SUBAGENT_EXCLUDED_TOOLS) expect(general).not.toContain(name);

    const mcp = { type: 'function', function: { name: 'mcp_srv_tool', parameters: {} } } as unknown as LLMTool;
    expect(toolNames(subagentToolSet('explore', [...TOOLS, mcp]))).not.toContain('mcp_srv_tool');
    expect(toolNames(subagentToolSet('general', [...TOOLS, mcp]))).toContain('mcp_srv_tool');
  });

  it('builds the child prompt on top of the parent prompt', () => {
    const p = subagentSystemPrompt('verify', 'PARENT POLICY', 'checker');
    expect(p.startsWith('PARENT POLICY')).toBe(true);
    expect(p).toContain('Sub-agent mode: verify ("checker")');
    expect(p).toContain('Do NOT fix anything');
    expect(p).toContain('plain-text report');
  });
});

describe('spawn_agent inside the agent loop', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({ 'src/math.ts': 'export function square(n: number) { return n * n; }\n' });
    projectDb.create({ id: ws.projectId, name: 'subagent test', workspace: ws.root, description: null });
    state.calls = [];
  });

  afterEach(async () => {
    try { projectDb.delete(ws.projectId); } catch {}
    await ws.cleanup();
  });

  const run = (opts: Partial<Parameters<typeof runAgentLoop>[0]> = {}) => {
    const emitter = new Collector();
    const promise = runAgentLoop({
      projectId: ws.projectId,
      workspaceRoot: ws.root,
      messages: [{ role: 'user', content: 'Look at the square function.' }], // < 40 chars: no plan step
      persistedCount: 1,
      llmConfig: { model: 'mock-model' },
      tools: TOOLS,
      systemPrompt: 'You are the main agent.',
      turnIndex: 1,
      emitter,
      cancellation: new CancellationSource(),
      ...opts,
    });
    return { emitter, promise };
  };

  it('runs parallel sub-agents, nests their events and feeds back their reports', async () => {
    const childTiming: Record<string, { start: number; end: number }> = {};
    state.responder = async ({ isChild, label, last }) => {
      if (!isChild) {
        if (last.role === 'user') {
          return { calls: [
            { id: 'c1', name: 'spawn_agent', args: { kind: 'explore', task: 'Find where square() is defined and report the file.', label: 'scout' } },
            { id: 'c2', name: 'spawn_agent', args: { kind: 'research', task: 'Report the value of 6*7 with a one-line justification.', label: 'calc', context: 'The parent already knows the file layout.' } },
          ] };
        }
        return { text: 'Final: both agents reported.' };
      }
      if (last.role === 'user') {
        childTiming[label] = { start: Date.now(), end: 0 };
        await new Promise((r) => setTimeout(r, 150)); // let the sibling start too
        return { calls: [{ id: `${label}-read`, name: 'read_file', args: { path: 'src/math.ts' } }] };
      }
      childTiming[label].end = Date.now();
      return { text: `REPORT from ${label}: square lives in src/math.ts.` };
    };

    const { emitter, promise } = run();
    const result = await promise;

    expect(result.reason).toBe('completed');
    expect(result.finalMessage).toBe('Final: both agents reported.');

    // Both children started before either finished → they ran concurrently
    expect(Object.keys(childTiming).sort()).toEqual(['calc', 'scout']);
    const starts = Object.values(childTiming).map((t) => t.start);
    const ends = Object.values(childTiming).map((t) => t.end);
    expect(Math.max(...starts)).toBeLessThan(Math.min(...ends));

    // Children saw their restricted tool sets
    const scout = state.calls.find((c) => c.label === 'scout')!;
    expect(scout.tools).toContain('read_file');
    expect(scout.tools).not.toContain('create_file');
    expect(scout.tools).not.toContain('spawn_agent');
    const calc = state.calls.find((c) => c.label === 'calc')!;
    expect(calc.tools).toContain('execute_code');

    // The parent's second call received both reports as tool results, in call order
    const parentSecond = state.calls.filter((c) => !c.isChild)[1];
    expect(parentSecond.lastRole).toBe('tool');
    const ev = emitter.events;
    const ends2 = ev.filter((e) => e.type === 'tool_end' && e.toolName === 'spawn_agent');
    expect(ends2).toHaveLength(2);
    expect(ends2[0].toolCallId).toBe('c1');
    const meta = (ends2[0].result as { subagent: { report: string; toolCalls: number; reason: string } }).subagent;
    expect(meta.reason).toBe('completed');
    expect(meta.toolCalls).toBe(1);
    expect(meta.report).toContain('[Sub-agent "scout" (explore) finished');
    expect(meta.report).toContain('REPORT from scout');

    // Child activity is wrapped, never mixed into the parent's stream
    const wrapped = ev.filter((e) => e.type === 'subagent_event');
    expect(wrapped.length).toBeGreaterThan(0);
    expect(wrapped.every((e) => e.toolCallId === 'c1' || e.toolCallId === 'c2')).toBe(true);
    const innerTypes = wrapped.map((e) => (e.event as { type: string }).type);
    expect(innerTypes).toContain('tool_start');
    expect(innerTypes).toContain('text_done');
    expect(innerTypes).not.toContain('text_delta');
    expect(ev.filter((e) => e.type === 'text_done')).toHaveLength(1); // only the parent's final text

    // Only the parent's transcript is persisted: the tool-call reply, the two
    // sub-agent results and the final answer (the user prompt was pre-persisted)
    const rows = messageDb.getRecent(ws.projectId);
    expect(rows.map((r) => r.role)).toEqual(['assistant', 'tool', 'tool', 'assistant']);
    expect(rows[3].content).toBe('Final: both agents reported.');
    expect(rows.filter((r) => r.role === 'tool').map((r) => r.content.split('\n')[0])).toEqual([
      expect.stringContaining('[Sub-agent "scout" (explore) finished'),
      expect.stringContaining('[Sub-agent "calc" (research) finished'),
    ]);
  }, 30_000);

  it('refuses tools outside a sub-agent\'s kind and stops nested spawning', async () => {
    state.responder = ({ last }) => {
      if (last.role === 'user') {
        return { calls: [
          { id: 'x1', name: 'create_file', args: { path: 'hack.txt', content: 'no' } },
          { id: 'x2', name: 'spawn_agent', args: { kind: 'general', task: 'Spawn something deeper, please.' } },
        ] };
      }
      return { text: 'child done' };
    };

    const { emitter, promise } = run({
      tools: subagentToolSet('explore', TOOLS),
      systemPrompt: 'Sub-agent mode: explore ("nested")',
      nested: { depth: 1, label: 'nested', kind: 'explore', maxSteps: 5 },
    });
    const result = await promise;
    expect(result.reason).toBe('completed');
    expect(await ws.exists('hack.txt')).toBe(false);

    const refused = emitter.events.filter((e) => e.type === 'tool_error').map((e) => String(e.error));
    expect(refused).toHaveLength(2);
    expect(refused[0]).toContain('Not available to a explore sub-agent');

    const second = state.calls[1];
    expect(second.lastRole).toBe('tool');
    // Nested loops never persist
    expect(messageDb.getRecent(ws.projectId)).toHaveLength(0);
  }, 30_000);

  it('reports a sub-agent that hits its step limit as partial', async () => {
    state.responder = ({ isChild, last }) => {
      if (!isChild) {
        return last.role === 'user'
          ? { calls: [{ id: 'c1', name: 'spawn_agent', args: { kind: 'explore', task: 'Loop forever reading the same file.' } }] }
          : { text: 'parent done' };
      }
      return { calls: [{ id: `r-${Date.now()}-${Math.random()}`, name: 'read_file', args: { path: 'src/math.ts' } }] };
    };

    const { emitter, promise } = run();
    const result = await promise;
    expect(result.reason).toBe('completed');
    const end = emitter.events.find((e) => e.type === 'tool_end' && e.toolName === 'spawn_agent')!;
    const meta = (end.result as { success: boolean; subagent: { reason: string; report: string } });
    expect(meta.success).toBe(false);
    expect(meta.subagent.reason).toBe('max_steps');
    expect(meta.subagent.report).toContain('treat this report as partial');
    // The child was warned before the cap (explore budget is 40 steps)
    const warning = emitter.events.find((e) => e.type === 'subagent_event' && (e.event as { type: string }).type === 'budget_warning');
    expect(warning).toBeTruthy();
    expect((warning!.event as { stepIndex: number }).stepIndex).toBe(36);
  }, 120_000);

  it('a sub-agent that heeds the budget warning finishes with a report', async () => {
    let warned = false;
    state.responder = ({ isChild, last }) => {
      if (!isChild) {
        return last.role === 'user'
          ? { calls: [{ id: 'c1', name: 'spawn_agent', args: { kind: 'explore', task: 'Read the file until told to stop.' } }] }
          : { text: 'parent done' };
      }
      if (last.role === 'user' && String(last.content).includes('[Budget:')) warned = true;
      if (warned) return { text: 'REPORT: wrapped up on request.' };
      return { calls: [{ id: `r-${Date.now()}-${Math.random()}`, name: 'read_file', args: { path: 'src/math.ts' } }] };
    };

    const { emitter, promise } = run();
    await promise;
    const end = emitter.events.find((e) => e.type === 'tool_end' && e.toolName === 'spawn_agent')!;
    const meta = (end.result as { success: boolean; subagent: { reason: string; report: string; steps: number } });
    expect(meta.success).toBe(true);
    expect(meta.subagent.reason).toBe('completed');
    expect(meta.subagent.report).toContain('wrapped up on request');
    expect(meta.subagent.steps).toBe(36);
  }, 120_000);
});
