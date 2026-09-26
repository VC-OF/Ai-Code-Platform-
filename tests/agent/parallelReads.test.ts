import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import type { ChatCompletionMessageParam } from 'openai/resources';

type Msg = ChatCompletionMessageParam & { content?: unknown };
type Reply = { text: string } | { calls: { id: string; name: string; args: Record<string, unknown> }[] };

const state = vi.hoisted(() => ({
  responder: null as null | ((messages: Msg[], step: number) => unknown),
  step: 0,
  log: [] as string[],
  active: 0,
  maxActive: 0,
}));

vi.mock('@/lib/llmClient', () => ({
  getContextWindow: () => 128_000,
  callLLM: vi.fn(),
  callLLMStream: async function* (_cfg: unknown, messages: Msg[]) {
    state.step++;
    const reply = (state.responder as unknown as (m: Msg[], s: number) => Reply)(messages, state.step);
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

// Slow, instrumented read_file / edit_file: records start/end order and concurrency
vi.mock('@/lib/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tools')>();
  return {
    ...actual,
    executeTool: async (name: string, args: Record<string, unknown>) => {
      const p = String(args.path);
      state.log.push(`start ${name} ${p}`);
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      // Later calls finish first, so ordering bugs would show
      await new Promise((r) => setTimeout(r, p === 'a.txt' ? 300 : p === 'b.txt' ? 150 : 50));
      state.active--;
      state.log.push(`end ${name} ${p}`);
      return { success: true, output: `content of ${p}`, summary: `Read ${p}` };
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

describe('parallel read-only tool calls', () => {
  let ws: TestWorkspace;
  let toolMessages: Msg[] = [];
  const run = (emitter: Collector) => runAgentLoop({
    projectId: ws.projectId, workspaceRoot: ws.root,
    messages: [{ role: 'user', content: 'Look around.' }], persistedCount: 1,
    llmConfig: { model: 'mock' }, tools: TOOL_SCHEMAS as unknown as LLMTool[], systemPrompt: 'policy',
    turnIndex: 1, emitter, cancellation: new CancellationSource(),
  });

  beforeEach(async () => {
    ws = await createWorkspace({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' });
    projectDb.create({ id: ws.projectId, name: 'parallel', workspace: ws.root, description: null });
    Object.assign(state, { step: 0, log: [], active: 0, maxActive: 0 });
    toolMessages = [];
  });

  afterEach(async () => {
    try { projectDb.delete(ws.projectId); } catch {}
    await ws.cleanup();
  });

  const respond = (calls: { id: string; name: string; args: Record<string, unknown> }[]) => {
    state.responder = ((messages: Msg[], step: number) => {
      if (step === 1) return { calls };
      toolMessages = messages.filter((m) => m.role === 'tool');
      return { text: 'Done looking.' };
    }) as unknown as typeof state.responder;
  };

  it('runs an all-read-only batch concurrently and keeps result order', async () => {
    respond([
      { id: 'r1', name: 'read_file', args: { path: 'a.txt' } },
      { id: 'r2', name: 'read_file', args: { path: 'b.txt' } },
      { id: 'r3', name: 'grep_files', args: { pattern: 'x', path: 'c.txt' } },
    ]);
    const emitter = new Collector();
    const started = Date.now();
    const result = await run(emitter);
    const elapsed = Date.now() - started;

    expect(result.reason).toBe('completed');
    expect(state.maxActive).toBe(3);
    expect(state.log.slice(0, 3).every((l) => l.startsWith('start'))).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
    expect(toolMessages.map((m) => (m as { tool_call_id: string }).tool_call_id)).toEqual(['r1', 'r2', 'r3']);
    expect(toolMessages.map((m) => m.content)).toEqual(['content of a.txt', 'content of b.txt', 'content of c.txt']);
    const ends = emitter.events.filter((e) => e.type === 'tool_end').map((e) => e.toolCallId);
    expect(ends).toEqual(['r1', 'r2', 'r3']);
  }, 30_000);

  it('keeps a mixed batch sequential', async () => {
    respond([
      { id: 'r1', name: 'read_file', args: { path: 'a.txt' } },
      { id: 'w1', name: 'edit_file', args: { path: 'b.txt', oldText: 'b', newText: 'B' } },
    ]);
    await run(new Collector());
    expect(state.maxActive).toBe(1);
    expect(state.log).toEqual(['start read_file a.txt', 'end read_file a.txt', 'start edit_file b.txt', 'end edit_file b.txt']);
  }, 30_000);
});
