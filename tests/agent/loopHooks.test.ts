import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import type { ChatCompletionMessageParam } from 'openai/resources';

type Msg = ChatCompletionMessageParam & { content?: unknown };
type Reply = { text: string } | { calls: { id: string; name: string; args: Record<string, unknown> }[] };

const state = vi.hoisted(() => ({
  responder: null as null | ((last: never, messages: never) => unknown),
  calls: 0,
}));

vi.mock('@/lib/llmClient', () => ({
  getContextWindow: () => 128_000,
  callLLM: vi.fn(),
  callLLMStream: async function* (_cfg: unknown, messages: Msg[]) {
    state.calls++;
    const last = messages[messages.length - 1];
    const reply = (state.responder as unknown as (l: Msg, m: Msg[]) => Reply)(last, messages);
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
import { projectDb } from '@/lib/db';
import type { LLMTool } from '@/lib/llmClient';

class Collector extends EventEmitter {
  events: Record<string, unknown>[] = [];
  constructor() { super(null as unknown as ReadableStreamDefaultController); }
  override emit(event: Record<string, unknown>) { this.events.push({ ...event }); }
}

// PreToolUse: veto delete_file. Stop: block once (until a marker exists).
const GUARD_JS = `let d = '';
process.stdin.on('data', (c) => { d += c; });
process.stdin.on('end', () => {
  const fs = require('fs');
  const p = JSON.parse(d);
  if (p.hook_event_name === 'PreToolUse' && p.tool_name === 'delete_file') {
    console.error('Deleting ' + p.tool_input.path + ' is forbidden by policy; archive it instead.');
    process.exit(2);
  }
  if (p.hook_event_name === 'Stop') {
    if (!fs.existsSync('stop-marker')) { fs.writeFileSync('stop-marker', '1'); console.error('Add a summary line before finishing.'); process.exit(2); }
  }
  console.log('hook ok');
});
`;

describe('hooks inside the agent loop', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({
      'notes.txt': 'keep me\n',
      'guard.js': GUARD_JS,
      '.claude/settings.json': JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'delete_file', hooks: [{ type: 'command', command: 'node guard.js' }] }],
          PostToolUse: [{ matcher: 'read_file', hooks: [{ type: 'command', command: 'node guard.js' }] }],
          Stop: [{ hooks: [{ type: 'command', command: 'node guard.js' }] }],
        },
      }),
    });
    projectDb.create({ id: ws.projectId, name: 'hooks test', workspace: ws.root, description: null });
    state.calls = 0;
  });

  afterEach(async () => {
    try { projectDb.delete(ws.projectId); } catch {}
    await ws.cleanup();
  });

  it('blocks vetoed tools, feeds hook output back, and honours Stop hooks', async () => {
    state.responder = ((last: Msg) => {
      if (last.role === 'user' && !String(last.content).includes('Stop hook')) {
        return { calls: [
          { id: 'd1', name: 'delete_file', args: { path: 'notes.txt' } },
          { id: 'r1', name: 'read_file', args: { path: 'notes.txt' } },
        ] };
      }
      if (last.role === 'tool') return { text: 'done' };
      return { text: 'done — summary: nothing was deleted.' };
    }) as unknown as typeof state.responder;

    const emitter = new Collector();
    const result = await runAgentLoop({
      projectId: ws.projectId,
      workspaceRoot: ws.root,
      messages: [{ role: 'user', content: 'Clean up notes.txt' }],
      persistedCount: 1,
      llmConfig: { model: 'mock-model' },
      tools: TOOL_SCHEMAS as unknown as LLMTool[],
      systemPrompt: 'policy',
      turnIndex: 1,
      emitter,
      cancellation: new CancellationSource(),
    });

    expect(result.reason).toBe('completed');
    expect(result.finalMessage).toContain('summary');
    expect(await ws.exists('notes.txt')).toBe(true); // the delete never ran
    expect(state.calls).toBe(3); // tool step, first "done" (blocked by Stop), final

    const hooks = emitter.events.filter((e) => e.type === 'hook') as { event: string; blocked: boolean; output: string; exitCode: number }[];
    const pre = hooks.find((h) => h.event === 'PreToolUse')!;
    expect(pre.blocked).toBe(true);
    expect(pre.output).toContain('forbidden by policy');
    const post = hooks.find((h) => h.event === 'PostToolUse')!;
    expect(post).toMatchObject({ blocked: false, exitCode: 0, output: 'hook ok' });
    const stops = hooks.filter((h) => h.event === 'Stop');
    expect(stops.map((h) => h.blocked)).toEqual([true, false]);

    const toolErrors = emitter.events.filter((e) => e.type === 'tool_error' && e.toolName === 'delete_file');
    expect(toolErrors).toHaveLength(1);
    expect(String(toolErrors[0].error)).toContain('PreToolUse hook');

    // The read_file after the blocked call still ran normally
    const readEnd = emitter.events.find((e) => e.type === 'tool_end' && e.toolName === 'read_file');
    expect(readEnd).toBeTruthy();
  }, 60_000);
});
