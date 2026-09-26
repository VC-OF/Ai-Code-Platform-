import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Fake OpenAI client (same shape as truncation.test.ts) ──────────────────
const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));
vi.mock('@/lib/settingsStore', () => ({ getDecryptedEnv: async () => ({}) }));
vi.mock('@/lib/models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/models')>();
  return {
    ...actual,
    resolveProvider: () => ({ name: 'mock', apiKey: 'k', baseURL: 'http://x', model: 'm' }),
    getContextWindow: () => 128_000,
  };
});

async function* chunks(list: unknown[]) {
  for (const c of list) yield c;
}

async function collect(gen: AsyncGenerator<unknown>) {
  const out: unknown[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe('reasoning models', () => {
  beforeEach(() => {
    createMock.mockReset();
    delete process.env.LLM_REASONING_EFFORT;
  });

  it('extracts thinking deltas from either vendor field', async () => {
    const { extractReasoningDelta } = await import('@/lib/llmClient');
    expect(extractReasoningDelta({ reasoning_content: 'hmm' })).toBe('hmm');
    expect(extractReasoningDelta({ reasoning: 'let me see' })).toBe('let me see');
    expect(extractReasoningDelta({ content: 'answer' })).toBe('');
    expect(extractReasoningDelta(undefined)).toBe('');
    expect(extractReasoningDelta({ reasoning: 42 })).toBe('');
  });

  it('streams reasoning_delta chunks separately from content', async () => {
    const { callLLMStream } = await import('@/lib/llmClient');
    createMock.mockResolvedValue(chunks([
      { choices: [{ delta: { reasoning_content: 'First, ' } }] },
      { choices: [{ delta: { reasoning: 'check units.' } }] },
      { choices: [{ delta: { content: '42' }, finish_reason: 'stop' }] },
    ]));
    const out = await collect(callLLMStream({ model: 'm' }, []));
    expect(out).toEqual([
      { type: 'reasoning_delta', delta: 'First, ' },
      { type: 'reasoning_delta', delta: 'check units.' },
      { type: 'delta', delta: '42' },
      { type: 'done', usage: { prompt_tokens: 0, completion_tokens: 0 }, finishReason: 'stop' },
    ]);
  });

  it('sends reasoning_effort only when configured', async () => {
    const { reasoningParams, callLLMStream } = await import('@/lib/llmClient');
    expect(reasoningParams({})).toEqual({});
    expect(reasoningParams({ LLM_REASONING_EFFORT: 'bogus' })).toEqual({});
    expect(reasoningParams({ LLM_REASONING_EFFORT: 'High' })).toEqual({ reasoning_effort: 'high' });

    createMock.mockResolvedValue(chunks([{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }]));
    await collect(callLLMStream({ model: 'm' }, []));
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('reasoning_effort');

    process.env.LLM_REASONING_EFFORT = 'medium';
    createMock.mockResolvedValue(chunks([{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }]));
    await collect(callLLMStream({ model: 'm' }, []));
    expect(createMock.mock.calls[1][0].reasoning_effort).toBe('medium');
  });

  it('retries without reasoning_effort when the provider rejects it, and remembers', async () => {
    const { callLLMStream } = await import('@/lib/llmClient');
    process.env.LLM_REASONING_EFFORT = 'high';
    createMock
      .mockRejectedValueOnce(new Error("400 Unrecognized request argument supplied: reasoning_effort"))
      .mockResolvedValue(chunks([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]));

    const out = await collect(callLLMStream({ model: 'm' }, []));
    expect(out[0]).toEqual({ type: 'delta', delta: 'ok' });
    expect(createMock.mock.calls[0][0].reasoning_effort).toBe('high');
    expect(createMock.mock.calls[1][0]).not.toHaveProperty('reasoning_effort');
    // max_tokens survived the retry
    expect(createMock.mock.calls[1][0].max_tokens).toBeGreaterThan(0);

    createMock.mockClear();
    createMock.mockResolvedValue(chunks([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]));
    await collect(callLLMStream({ model: 'm' }, []));
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('reasoning_effort');
  });
});

describe('request sanitising', () => {
  it('strips loop-only fields from tool messages (Groq rejects them)', async () => {
    const { toApiMessages, callLLMStream } = await import('@/lib/llmClient');
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', tool_name: 'read_file', name: 'read_file', content: 'ok' },
    ] as unknown as Parameters<typeof toApiMessages>[0];
    expect(toApiMessages(msgs)[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'ok' });
    expect(toApiMessages(msgs)[1]).toBe(msgs[1]);

    createMock.mockResolvedValue(chunks([{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }]));
    await collect(callLLMStream({ model: 'm' }, msgs));
    expect(createMock.mock.calls.at(-1)![0].messages[2]).not.toHaveProperty('tool_name');
  });
});

describe('vision support', () => {
  it('uses the registry, name heuristics and the LLM_VISION override', async () => {
    const { supportsVision } = await import('@/lib/models');
    expect(supportsVision('gpt-4o', {})).toBe(true);
    expect(supportsVision('openrouter:anthropic/claude-3-5-sonnet', {})).toBe(true);
    expect(supportsVision('llama-3.1-8b-instant', {})).toBe(false);
    expect(supportsVision('qwen2.5-vl:7b', {})).toBe(true);
    expect(supportsVision('llava:13b', {})).toBe(true);
    expect(supportsVision('deepseek-chat', {})).toBe(false);
    expect(supportsVision('deepseek-chat', { LLM_VISION: '1' })).toBe(true);
    expect(supportsVision('gpt-4o', { LLM_VISION: 'false' })).toBe(false);
  });
});
