import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import type { ChatCompletionMessageParam } from 'openai/resources';

type Msg = ChatCompletionMessageParam & { content?: unknown };

const state = vi.hoisted(() => ({
  calls: [] as { messages: number; chars: number }[],
  failFirst: true,
}));

vi.mock('@/lib/llmClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llmClient')>();
  return {
    ...actual,
    getContextWindow: (m: string) => actual.getContextWindow(m),
    callLLM: vi.fn(async () => ({
      content: 'SUMMARY: earlier work — files a..t were read; nothing changed.',
      tool_calls: null, finish_reason: 'stop',
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    })),
    callLLMStream: async function* (_cfg: unknown, messages: Msg[]) {
      const chars = messages.reduce((s, m) => s + String(m.content ?? '').length, 0);
      state.calls.push({ messages: messages.length, chars });
      if (state.failFirst && state.calls.length === 1) {
        throw new Error('400 The prompt is too long: 262278, model maximum context length: 262144 (ref: abc)');
      }
      yield { type: 'delta', delta: 'done after compaction' };
      yield { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5 }, finishReason: 'stop' };
    },
  };
});

import { runAgentLoop } from '@/lib/agentLoop';
import { parseContextLengthError } from '@/lib/llmClient';
import { getContextWindow, recordContextWindow, learnedContextWindow } from '@/lib/models';
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

describe('context-length errors', () => {
  it('parses the limit from provider messages', () => {
    expect(parseContextLengthError(new Error('400 The prompt is too long: 262278, model maximum context length: 262144 (ref: x)'))).toBe(262144);
    expect(parseContextLengthError(new Error("This model's maximum context length is 128000 tokens. However, you requested 130000 tokens"))).toBe(128000);
    expect(parseContextLengthError(new Error('context_length_exceeded: reduce the prompt'))).toBe(0);
    expect(parseContextLengthError(new Error('429 rate limit'))).toBeNull();
    expect(parseContextLengthError(new Error('ECONNRESET'))).toBeNull();
  });

  it('learned limits beat the CONTEXT_WINDOW override and the registry', () => {
    const prev = process.env.CONTEXT_WINDOW;
    process.env.CONTEXT_WINDOW = '2000000';
    try {
      expect(getContextWindow('some-model')).toBe(2_000_000);
      recordContextWindow('some-model', 262_144);
      expect(learnedContextWindow('some-model')).toBe(262_144);
      expect(getContextWindow('some-model')).toBe(262_144);
      recordContextWindow('some-model', 12); // nonsense values are ignored
      expect(getContextWindow('some-model')).toBe(262_144);
    } finally {
      if (prev === undefined) delete process.env.CONTEXT_WINDOW; else process.env.CONTEXT_WINDOW = prev;
    }
  });

  it('unknown models default to a conservative window and nemotron cloud is 262k', () => {
    expect(getContextWindow('totally-unknown-model')).toBe(128_000);
    expect(getContextWindow('nemotron-3-ultra:cloud')).toBe(262_144);
  });
});

describe('loop recovery from "prompt too long"', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({ 'a.txt': 'x\n' });
    projectDb.create({ id: ws.projectId, name: 'ctx test', workspace: ws.root, description: null });
    state.calls = [];
    state.failFirst = true;
  });

  afterEach(async () => {
    try { projectDb.delete(ws.projectId); } catch {}
    await ws.cleanup();
  });

  it('learns the limit, compacts once and finishes instead of retrying blindly', async () => {
    // A long history: 30 fat tool-result exchanges
    const history: Msg[] = [];
    for (let i = 0; i < 30; i++) {
      history.push({ role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] } as Msg);
      history.push({ role: 'tool', tool_call_id: `c${i}`, content: `file ${i}\n` + 'lorem ipsum '.repeat(400) } as Msg);
    }
    const emitter = new Collector();
    const result = await runAgentLoop({
      projectId: ws.projectId,
      workspaceRoot: ws.root,
      messages: [{ role: 'user', content: 'Go on.' }, ...history, { role: 'user', content: 'Continue.' }],
      persistedCount: history.length + 2,
      llmConfig: { model: 'ctx-test-model' },
      tools: TOOL_SCHEMAS as unknown as LLMTool[],
      systemPrompt: 'policy',
      turnIndex: 1,
      emitter,
      cancellation: new CancellationSource(),
    });

    expect(result.reason).toBe('completed');
    expect(result.finalMessage).toBe('done after compaction');
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1].chars).toBeLessThan(state.calls[0].chars / 2);
    expect(learnedContextWindow('ctx-test-model')).toBe(262_144);

    const notice = emitter.events.find((e) => e.type === 'error' && String(e.message).includes('too long'));
    expect(notice).toBeTruthy();
    expect(String(notice!.message)).toContain('262,144');
    expect(emitter.events.some((e) => e.type === 'compaction')).toBe(true);
    // No blind "retrying (n/5)" attempts for a non-transient error
    expect(emitter.events.filter((e) => e.type === 'error' && /retrying \(\d\/5\)/.test(String(e.message)))).toHaveLength(0);
  }, 60_000);
});
