import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import type { ChatCompletionMessageParam } from 'openai/resources';

type Msg = ChatCompletionMessageParam & { content?: unknown };
type Reply = { text: string } | { calls: { id: string; name: string; args: Record<string, unknown> }[] };

const state = vi.hoisted(() => ({
  responder: null as null | ((last: { role: string; content?: unknown }, step: number) => unknown),
  step: 0,
  testsPass: false,
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

// run_tests is slow and stack-dependent — stub its verdict, keep every other tool real
vi.mock('@/lib/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tools')>();
  return {
    ...actual,
    executeTool: async (name: string, args: Record<string, unknown>, ws: string, ctx: unknown, signal?: AbortSignal) => {
      if (name === 'run_tests') {
        return state.testsPass
          ? { success: true, output: '3 passed', summary: 'Tests ✓ passed (3 total)', structured: { passed: true, total: 3, failed: 0 } }
          : { success: true, output: 'FAILED test_x — assertion', summary: 'Tests ✗ failed (1/3 failing)', structured: { passed: false, total: 3, failed: 1 } };
      }
      return actual.executeTool(name, args, ws, ctx as Parameters<typeof actual.executeTool>[3], signal);
    },
  };
});

import { runAgentLoop } from '@/lib/agentLoop';
import { TOOL_SCHEMAS } from '@/lib/tools';
import { EventEmitter } from '@/lib/events';
import { CancellationSource } from '@/lib/cancellation';
import { projectDb } from '@/lib/db';
import type { LLMTool } from '@/lib/llmClient';

class Collector extends EventEmitter {
  events: Record<string, unknown>[] = [];
  constructor() { super(null as unknown as ReadableStreamDefaultController); }
  override emit(event: Record<string, unknown>) { this.events.push({ ...event }); }
}

describe('finishing after a failed verification', () => {
  let ws: TestWorkspace;
  const run = (emitter: Collector) => runAgentLoop({
    projectId: ws.projectId, workspaceRoot: ws.root,
    messages: [{ role: 'user', content: 'Fix the tests.' }], persistedCount: 1,
    llmConfig: { model: 'mock' }, tools: TOOL_SCHEMAS as unknown as LLMTool[], systemPrompt: 'policy',
    turnIndex: 1, emitter, cancellation: new CancellationSource(),
  });

  beforeEach(async () => {
    ws = await createWorkspace({ 'a.txt': 'x\n' });
    projectDb.create({ id: ws.projectId, name: 'verify gate', workspace: ws.root, description: null });
    state.step = 0;
    state.testsPass = false;
  });

  afterEach(async () => {
    try { projectDb.delete(ws.projectId); } catch {}
    await ws.cleanup();
  });

  it('challenges a "done" that follows failing tests, and accepts the fix', async () => {
    const lastUserAt: Record<number, string> = {};
    state.responder = ((last: Msg, step: number) => {
      lastUserAt[step] = last.role === 'user' ? String(last.content) : '';
      if (step === 1) return { calls: [{ id: 't1', name: 'run_tests', args: {} }] };
      if (step === 2) return { text: 'All done, everything works.' };          // false claim
      if (step === 3) { state.testsPass = true; return { calls: [{ id: 't2', name: 'run_tests', args: {} }] }; }
      return { text: 'Fixed; tests pass now.' };
    }) as unknown as typeof state.responder;

    const emitter = new Collector();
    const result = await run(emitter);
    expect(result.reason).toBe('completed');
    expect(result.finalMessage).toBe('Fixed; tests pass now.');
    expect(state.step).toBe(4);
    expect(lastUserAt[3]).toContain('Your most recent verification failed: run_tests');
    expect(lastUserAt[3]).toContain('1/3 failing');
    expect(emitter.events.some((e) => e.type === 'tool_error' && /tried to finish after a failed run_tests/.test(String(e.error)))).toBe(true);
  }, 60_000);

  it('lets an honest "unresolved" reply through without a second nudge', async () => {
    state.responder = ((_last: Msg, step: number) => {
      if (step === 1) return { calls: [{ id: 't1', name: 'run_tests', args: {} }] };
      return { text: 'One test is still failing and remains unresolved: test_x needs the fixture the user promised.' };
    }) as unknown as typeof state.responder;

    const result = await run(new Collector());
    expect(result.reason).toBe('completed');
    expect(state.step).toBe(2);
  }, 60_000);
});
