import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

const state = vi.hoisted(() => ({
  seen: [] as string[][],
  askFirst: false,
}));

vi.mock('@/lib/llmClient', () => ({
  getContextWindow: () => 128_000,
  callLLM: vi.fn(async () => ({
    content: 'plan', tool_calls: null, finish_reason: 'stop',
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })),
  callLLMStream: async function* (_cfg: unknown, messages: { role: string; content?: unknown }[]) {
    state.seen.push(messages.map((m) => String(m.content ?? '')));
    const last = messages[messages.length - 1];
    if (state.askFirst && last.role === 'user') {
      const args = { question: 'Which color?' };
      yield { type: 'tool_call_delta', tool_call: { index: 0, id: 'q1', name: 'ask_user', args: JSON.stringify(args) } };
      yield { type: 'done', usage: { prompt_tokens: 1, completion_tokens: 1 }, finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'delta', delta: 'Done.' };
    yield { type: 'done', usage: { prompt_tokens: 1, completion_tokens: 1 }, finishReason: 'stop' };
  },
}));

import { runAgentLoop } from '@/lib/agentLoop';
import { TOOL_SCHEMAS } from '@/lib/tools';
import { EventEmitter } from '@/lib/events';
import { CancellationSource } from '@/lib/cancellation';
import { projectDb } from '@/lib/db';
import { loadHooks, runHooks, HOOK_EVENTS } from '@/lib/hooks';
import type { LLMTool } from '@/lib/llmClient';

// Logs each payload to hooks.log; SessionStart prints context (exit 0); the rest exit 2
const HOOK_JS = `let d = '';
process.stdin.on('data', (c) => { d += c; });
process.stdin.on('end', () => {
  require('fs').appendFileSync('hooks.log', d + '\\n');
  const p = JSON.parse(d);
  if (p.hook_event_name === 'SessionStart') { console.log('SESSION CONTEXT: use tabs'); return; }
  process.exit(2);
});
`;

const SETTINGS = JSON.stringify({
  hooks: Object.fromEntries(
    ['SessionStart', 'PreCompact', 'Notification'].map((e) => [e, [{ hooks: [{ type: 'command', command: 'node hook.js' }] }]])
  ),
});

class Collector extends EventEmitter {
  events: Record<string, unknown>[] = [];
  constructor() { super(null as unknown as ReadableStreamDefaultController); }
  override emit(event: Record<string, unknown>) { this.events.push({ ...event }); }
}

describe('SessionStart / PreCompact / Notification hooks', () => {
  let ws: TestWorkspace;
  beforeEach(async () => {
    ws = await createWorkspace({ 'hook.js': HOOK_JS, '.claude/settings.json': SETTINGS });
    projectDb.create({ id: ws.projectId, name: 'hooks test', workspace: ws.root, description: null });
    state.seen = [];
    state.askFirst = false;
  });
  afterEach(async () => {
    try { projectDb.delete(ws.projectId); } catch {}
    await ws.cleanup();
  });

  const payloads = async () =>
    (await ws.read('hooks.log').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

  it('registers the new events', () => {
    expect(HOOK_EVENTS).toEqual(expect.arrayContaining(['SessionStart', 'PreCompact', 'Notification']));
  });

  it('PreCompact gets the trigger and exit 2 does not block', async () => {
    const config = await loadHooks(ws.root);
    const res = await runHooks(config, { event: 'PreCompact', projectId: 'p', workspace: ws.root, trigger: 'overflow' });
    expect(res[0].exitCode).toBe(2);
    expect(res[0].blocked).toBe(false);
    expect((await payloads())[0]).toMatchObject({ hook_event_name: 'PreCompact', trigger: 'overflow' });
  }, 30_000);

  const run = (opts: Partial<Parameters<typeof runAgentLoop>[0]> = {}) =>
    runAgentLoop({
      projectId: ws.projectId,
      workspaceRoot: ws.root,
      messages: [{ role: 'user', content: 'Hello there.' }],
      persistedCount: 1,
      llmConfig: { model: 'mock' },
      tools: TOOL_SCHEMAS as unknown as LLMTool[],
      systemPrompt: 'SYS',
      turnIndex: 1,
      emitter: new Collector(),
      cancellation: new CancellationSource(),
      ...opts,
    });

  it('SessionStart stdout reaches the model as context on a session start', async () => {
    const result = await run();
    expect(result.reason).toBe('completed');
    expect(state.seen[0].some((c) => c.includes('SESSION CONTEXT: use tabs'))).toBe(true);
    expect((await payloads()).map((p) => p.hook_event_name)).toContain('SessionStart');
  }, 30_000);

  it('SessionStart does not run on a continuing session', async () => {
    await run({ turnIndex: 5, sessionStart: false });
    expect(state.seen[0].some((c) => c.includes('SESSION CONTEXT'))).toBe(false);
    expect(await payloads()).toEqual([]);
  }, 30_000);

  it('Notification fires when the agent waits for the user', async () => {
    state.askFirst = true;
    const result = await run({ turnIndex: 3, sessionStart: false, waitForUserInput: async () => 'blue' });
    expect(result.reason).toBe('completed');
    const note = (await payloads()).find((p) => p.hook_event_name === 'Notification');
    expect(note.message).toContain('Which color?');
  }, 30_000);
});
