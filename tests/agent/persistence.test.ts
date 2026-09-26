import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import type { ChatCompletionMessageParam } from 'openai/resources';

type Msg = ChatCompletionMessageParam & { content?: unknown };
type Reply = { text: string } | { calls: { id: string; name: string; args: Record<string, unknown> }[] };

const state = vi.hoisted(() => ({
  responder: null as null | ((last: { role: string; content?: unknown }, step: number) => unknown),
  step: 0,
}));

vi.mock('@/lib/llmClient', () => ({
  getContextWindow: () => 128_000,
  callLLM: vi.fn(),
  callLLMStream: async function* (_cfg: unknown, messages: Msg[]) {
    state.step++;
    const last = messages[messages.length - 1];
    const reply = (state.responder as unknown as (l: Msg, s: number) => Reply)(last, state.step);
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
import type { LLMTool } from '@/lib/llmClient';

class Collector extends EventEmitter {
  events: Record<string, unknown>[] = [];
  constructor() { super(null as unknown as ReadableStreamDefaultController); }
  override emit(event: Record<string, unknown>) { this.events.push({ ...event }); }
}

describe('incremental transcript persistence', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({ 'a.txt': 'alpha\n', 'b.txt': 'beta\n' });
    projectDb.create({ id: ws.projectId, name: 'persist test', workspace: ws.root, description: null });
    state.step = 0;
  });

  afterEach(async () => {
    try { projectDb.delete(ws.projectId); } catch {}
    await ws.cleanup();
  });

  it('saves each completed step so a crash mid-turn keeps the work so far', async () => {
    const rowsSeenAtStep: Record<number, string[]> = {};
    state.responder = ((last: Msg, step: number) => {
      // What is already in the DB when the model is asked for step N
      rowsSeenAtStep[step] = messageDb.getRecent(ws.projectId).map((r) => r.role);
      if (step === 1) return { calls: [{ id: 'r1', name: 'read_file', args: { path: 'a.txt' } }] };
      if (step === 2) return { calls: [{ id: 'r2', name: 'read_file', args: { path: 'b.txt' } }] };
      if (step === 3) return { calls: [{ id: 'bad', name: 'execute_code', args: { language: 'python', command: 'print(1)', script: undefined, foo: 1 } }] };
      return { text: 'done' };
    }) as unknown as typeof state.responder;

    const emitter = new Collector();
    const result = await runAgentLoop({
      projectId: ws.projectId,
      workspaceRoot: ws.root,
      messages: [{ role: 'user', content: 'Read both files.' }],
      persistedCount: 1,
      llmConfig: { model: 'mock-model' },
      tools: TOOL_SCHEMAS as unknown as LLMTool[],
      systemPrompt: 'policy',
      turnIndex: 1,
      emitter,
      cancellation: new CancellationSource(),
    });
    expect(result.reason).toBe('completed');

    // Nothing before the first step; step 1's tool-call reply + result were
    // on disk before step 2 was requested, and so on
    expect(rowsSeenAtStep[1]).toEqual([]);
    expect(rowsSeenAtStep[2]).toEqual(['assistant', 'tool']);
    expect(rowsSeenAtStep[3]).toEqual(['assistant', 'tool', 'assistant', 'tool']);

    const final = messageDb.getRecent(ws.projectId);
    expect(final.map((r) => r.role)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
    expect(final.at(-1)?.content).toBe('done');
    // No duplicates: each step is written exactly once
    expect(final.filter((r) => r.tool_call_id === 'r1')).toHaveLength(1);
  }, 60_000);

  it('tells the model which argument keys it actually sent on validation errors', async () => {
    state.responder = ((last: Msg, step: number) => {
      if (step === 1) return { calls: [{ id: 'v1', name: 'view_image', args: { image: 'x.png', foo: 1 } }] };
      return { text: 'ok' };
    }) as unknown as typeof state.responder;

    const emitter = new Collector();
    await runAgentLoop({
      projectId: ws.projectId,
      workspaceRoot: ws.root,
      messages: [{ role: 'user', content: 'look' }],
      persistedCount: 1,
      llmConfig: { model: 'mock-model' },
      tools: TOOL_SCHEMAS as unknown as LLMTool[],
      systemPrompt: 'policy',
      turnIndex: 1,
      emitter,
      cancellation: new CancellationSource(),
    });
    const err = emitter.events.find((e) => e.type === 'tool_error' && e.toolName === 'view_image');
    const tool = messageDb.getRecent(ws.projectId).find((r) => r.role === 'tool');
    expect(err).toBeTruthy();
    expect(String(err?.error)).toContain('Sent keys: image, foo');
    expect(tool?.content).toContain('Sent keys: image, foo');
    expect(tool?.content).toContain('Re-issue the call');
  }, 60_000);
});
