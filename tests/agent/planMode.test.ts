import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import type { ChatCompletionMessageParam } from 'openai/resources';

type Msg = ChatCompletionMessageParam & { content?: unknown };
type Reply = { text: string } | { calls: { id: string; name: string; args: Record<string, unknown> }[] };

const state = vi.hoisted(() => ({
  responder: null as null | ((step: number) => unknown),
  step: 0,
  seen: [] as { role: string; content?: unknown }[],
}));

vi.mock('@/lib/llmClient', () => ({
  getContextWindow: () => 128_000,
  callLLM: vi.fn(),
  callLLMStream: async function* (_cfg: unknown, messages: Msg[]) {
    state.step++;
    state.seen = messages as typeof state.seen;
    const reply = (state.responder as unknown as (s: number) => Reply)(state.step);
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

import { runAgentLoop, type AgentLoopOptions } from '@/lib/agentLoop';
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

const toolResult = (id: string) =>
  String(state.seen.find((m) => m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === id)?.content ?? '');

let ws: TestWorkspace;
const run = (emitter: Collector, extra: Partial<AgentLoopOptions> = {}) => runAgentLoop({
  projectId: ws.projectId, workspaceRoot: ws.root,
  messages: [{ role: 'user', content: 'Add b.txt.' }], persistedCount: 1,
  llmConfig: { model: 'mock' }, tools: TOOL_SCHEMAS as unknown as LLMTool[], systemPrompt: 'policy',
  turnIndex: 1, emitter, cancellation: new CancellationSource(),
  ...extra,
});

const prevManaged = process.env.OPEN_CODE_MANAGED_SETTINGS;

beforeEach(async () => {
  ws = await createWorkspace({ 'a.txt': 'x\n' });
  projectDb.create({ id: ws.projectId, name: 'plan mode', workspace: ws.root, description: null });
  process.env.OPEN_CODE_MANAGED_SETTINGS = path.join(ws.root, 'no-managed-settings.json');
  state.step = 0;
  state.seen = [];
});

afterEach(async () => {
  if (prevManaged === undefined) delete process.env.OPEN_CODE_MANAGED_SETTINGS;
  else process.env.OPEN_CODE_MANAGED_SETTINGS = prevManaged;
  try { projectDb.delete(ws.projectId); } catch {}
  await ws.cleanup();
});

describe('plan mode', () => {
  it('refuses edits until the plan is approved, then runs in auto mode', async () => {
    const results: Record<number, string> = {};
    state.responder = ((step: number) => {
      if (step === 2) results[2] = toolResult('c1');
      if (step === 3) results[3] = toolResult('p1');
      if (step === 1) return { calls: [{ id: 'r1', name: 'read_file', args: { path: 'a.txt' } }, { id: 'c1', name: 'create_file', args: { path: 'b.txt', content: 'b' } }] };
      if (step === 2) return { calls: [{ id: 'p1', name: 'exit_plan_mode', args: { plan: '1. Create b.txt' } }] };
      if (step === 3) return { calls: [{ id: 'c2', name: 'create_file', args: { path: 'b.txt', content: 'b' } }] };
      return { text: 'Created b.txt.' };
    }) as unknown as typeof state.responder;

    const questions: { q: string; o?: string[] }[] = [];
    const emitter = new Collector();
    const result = await run(emitter, {
      executionMode: 'plan',
      waitForUserInput: async (q, o) => { questions.push({ q, o }); return 'Approve plan'; },
    });

    expect(result.reason).toBe('completed');
    expect(results[2]).toContain('Plan mode is read-only');
    expect(results[3]).toContain('approved');
    expect(questions).toHaveLength(1);
    expect(questions[0].q).toContain('1. Create b.txt');
    expect(questions[0].o).toEqual(['Approve plan', 'Keep planning']);
    expect(emitter.events.some((e) => e.type === 'mode_change' && e.mode === 'auto')).toBe(true);
    expect(await fs.readFile(path.join(ws.root, 'b.txt'), 'utf8')).toBe('b');
  }, 60_000);

  it('stays read-only when the user keeps planning, and only allows explore/research sub-agents', async () => {
    const results: Record<string, string> = {};
    state.responder = ((step: number) => {
      if (step === 1) return { calls: [{ id: 'p1', name: 'exit_plan_mode', args: { plan: 'v1' } }] };
      if (step === 2) {
        results.p1 = toolResult('p1');
        return { calls: [
          { id: 's1', name: 'spawn_agent', args: { kind: 'general', task: 'edit things' } },
          { id: 'x1', name: 'run_command', args: { command: 'npm test' } },
        ] };
      }
      results.s1 = toolResult('s1');
      results.x1 = toolResult('x1');
      return { text: 'Here is the revised plan.' };
    }) as unknown as typeof state.responder;

    const emitter = new Collector();
    await run(emitter, { executionMode: 'plan', waitForUserInput: async () => 'Keep planning' });
    expect(results.p1).toContain('did not approve');
    expect(results.s1).toContain('Plan mode is read-only');
    expect(results.x1).toContain('Plan mode is read-only');
    expect(emitter.events.some((e) => e.type === 'mode_change')).toBe(false);
  }, 60_000);

  it('explains that approval needs an interactive session', async () => {
    let res = '';
    state.responder = ((step: number) => {
      if (step === 1) return { calls: [{ id: 'p1', name: 'exit_plan_mode', args: { plan: 'v1' } }] };
      res = toolResult('p1');
      return { text: 'Plan: v1' };
    }) as unknown as typeof state.responder;
    await run(new Collector(), { executionMode: 'plan' });
    expect(res).toContain('interactive session');
  }, 60_000);
});

describe('permission rules in the loop', () => {
  const writeSettings = async (permissions: Record<string, string[]>) => {
    await fs.mkdir(path.join(ws.root, '.claude'), { recursive: true });
    await fs.writeFile(path.join(ws.root, '.claude', 'settings.json'), JSON.stringify({ permissions }));
  };

  it('denies a matching tool call and explains the rule', async () => {
    await writeSettings({ deny: ['Write(secret*.txt)'] });
    let res = '';
    state.responder = ((step: number) => {
      if (step === 1) return { calls: [{ id: 'c1', name: 'create_file', args: { path: 'secret1.txt', content: 's' } }] };
      res = toolResult('c1');
      return { text: 'Could not write it.' };
    }) as unknown as typeof state.responder;
    const emitter = new Collector();
    await run(emitter);
    expect(res).toContain('Write(secret*.txt)');
    await expect(fs.access(path.join(ws.root, 'secret1.txt'))).rejects.toThrow();
    expect(emitter.events.some((e) => e.type === 'tool_error' && /Denied by permission rule/.test(String(e.error)))).toBe(true);
  }, 60_000);

  it('asks even in auto mode, and allow skips the manual-mode prompt', async () => {
    await writeSettings({ ask: ['Write(ask.txt)'], allow: ['Write(ok.txt)'] });
    state.responder = ((step: number) => {
      if (step === 1) return { calls: [
        { id: 'c1', name: 'create_file', args: { path: 'ask.txt', content: 'a' } },
        { id: 'c2', name: 'create_file', args: { path: 'ok.txt', content: 'o' } },
      ] };
      return { text: 'Done.' };
    }) as unknown as typeof state.responder;
    const questions: string[] = [];
    await run(new Collector(), {
      executionMode: 'manual',
      waitForUserInput: async (q) => { questions.push(q); return 'Deny'; },
    });
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('Write(ask.txt)');
    await expect(fs.access(path.join(ws.root, 'ask.txt'))).rejects.toThrow();
    expect(await fs.readFile(path.join(ws.root, 'ok.txt'), 'utf8')).toBe('o');

    // auto mode still pauses on an ask rule
    state.step = 0;
    const autoQuestions: string[] = [];
    await run(new Collector(), { waitForUserInput: async (q) => { autoQuestions.push(q); return 'Approve'; } });
    expect(autoQuestions).toHaveLength(1);
    expect(await fs.readFile(path.join(ws.root, 'ask.txt'), 'utf8')).toBe('a');
  }, 60_000);
});
