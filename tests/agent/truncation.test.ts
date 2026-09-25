import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import { executeTool, createTurnContext } from '@/lib/tools';

// ─── Fake OpenAI client: records requests, replays scripted streams ──────────
const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));
vi.mock('@/lib/settingsStore', () => ({ getDecryptedEnv: async () => ({}) }));
vi.mock('@/lib/models', () => ({
  resolveProvider: () => ({ name: 'mock', apiKey: 'k', baseURL: 'http://x', model: 'm' }),
  getContextWindow: () => 128_000,
}));

async function* chunks(list: unknown[]) {
  for (const c of list) yield c;
}

async function collect(gen: AsyncGenerator<unknown>) {
  const out: unknown[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe('LLM output truncation handling', () => {
  beforeEach(() => {
    createMock.mockReset();
    delete process.env.LLM_MAX_OUTPUT_TOKENS;
  });

  it('requests an explicit output-token limit (configurable)', async () => {
    const { callLLMStream } = await import('@/lib/llmClient');
    process.env.LLM_MAX_OUTPUT_TOKENS = '32000';
    createMock.mockResolvedValue(chunks([{ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }]));

    await collect(callLLMStream({ model: 'm' }, []));
    expect(createMock.mock.calls[0][0].max_tokens).toBe(32000);
  });

  it('reports finish_reason "length" when the reply is cut off', async () => {
    const { callLLMStream } = await import('@/lib/llmClient');
    createMock.mockResolvedValue(chunks([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'create_file', arguments: '{"path":"x' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
    ]));

    const out = await collect(callLLMStream({ model: 'm' }, []));
    expect(out.at(-1)).toMatchObject({ type: 'done', finishReason: 'length' });
  });

  it('keeps every tool-call delta when one chunk carries several', async () => {
    const { callLLMStream } = await import('@/lib/llmClient');
    createMock.mockResolvedValue(chunks([
      { choices: [{ delta: { tool_calls: [
        { index: 0, id: 'a', function: { name: 'read_file', arguments: '{}' } },
        { index: 1, id: 'b', function: { name: 'list_files', arguments: '{}' } },
      ] }, finish_reason: 'tool_calls' }] },
    ]));

    const out = await collect(callLLMStream({ model: 'm' }, []));
    const deltas = out.filter((c) => (c as { type: string }).type === 'tool_call_delta');
    expect(deltas).toHaveLength(2);
  });

  it('retries without max_tokens when the provider rejects it', async () => {
    const { callLLMStream } = await import('@/lib/llmClient');
    createMock
      .mockRejectedValueOnce(new Error('400 invalid max_tokens: must be less than 8192'))
      .mockResolvedValueOnce(chunks([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]));

    const out = await collect(callLLMStream({ model: 'm' }, []));
    expect(createMock.mock.calls[1][0].max_tokens).toBeUndefined();
    expect(out[0]).toMatchObject({ type: 'delta', delta: 'ok' });
  });
});

describe('append_file tool', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({});
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('writes a large file in parts', async () => {
    const ctx = createTurnContext();
    await executeTool('create_file', { path: 'big.txt', content: 'part1\n' }, ws.root, ctx);
    const res = await executeTool('append_file', { path: 'big.txt', content: 'part2\n' }, ws.root, ctx);

    expect(res.success).toBe(true);
    expect(res.changedFile).toBe('big.txt');
    expect(await ws.read('big.txt')).toBe('part1\npart2\n');
  });
});
