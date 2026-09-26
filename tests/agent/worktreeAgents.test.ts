import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

const state = vi.hoisted(() => ({ childEdits: true }));

vi.mock('@/lib/llmClient', () => ({
  getContextWindow: () => 128_000,
  callLLM: vi.fn(async () => ({
    content: 'plan', tool_calls: null, finish_reason: 'stop',
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })),
  callLLMStream: async function* (_cfg: unknown, messages: { role: string; content?: unknown }[]) {
    const isChild = String(messages[0]?.content ?? '').includes('Sub-agent mode');
    const last = messages[messages.length - 1];
    const call = (id: string, name: string, args: Record<string, unknown>) => ({
      type: 'tool_call_delta', tool_call: { index: 0, id, name, args: JSON.stringify(args) },
    });
    if (last.role === 'user' && !isChild) {
      yield call('s1', 'spawn_agent', { kind: 'general', isolation: 'worktree', task: 'Add a feature file to the project.' });
    } else if (last.role === 'user' && isChild && state.childEdits) {
      yield call('w1', 'create_file', { path: 'feature.txt', content: 'new feature\n' });
    } else {
      yield { type: 'delta', delta: isChild ? 'REPORT: done.' : 'Parent done.' };
      yield { type: 'done', usage: { prompt_tokens: 1, completion_tokens: 1 }, finishReason: 'stop' };
      return;
    }
    yield { type: 'done', usage: { prompt_tokens: 1, completion_tokens: 1 }, finishReason: 'tool_calls' };
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

const git = (cwd: string, cmd: string) => execSync(`git ${cmd}`, { cwd, stdio: 'pipe' }).toString().trim();

describe('spawn_agent isolation: worktree', () => {
  let ws: TestWorkspace;
  beforeEach(async () => {
    ws = await createWorkspace({ 'README.md': '# demo\n' });
    projectDb.create({ id: ws.projectId, name: 'worktree test', workspace: ws.root, description: null });
    state.childEdits = true;
  });
  afterEach(async () => {
    try { projectDb.delete(ws.projectId); } catch {}
    await ws.cleanup();
  });

  const run = async () => {
    const emitter = new Collector();
    const result = await runAgentLoop({
      projectId: ws.projectId,
      workspaceRoot: ws.root,
      messages: [{ role: 'user', content: 'Delegate it.' }],
      persistedCount: 1,
      llmConfig: { model: 'mock' },
      tools: TOOL_SCHEMAS as unknown as LLMTool[],
      systemPrompt: 'SYS',
      turnIndex: 2,
      emitter,
      cancellation: new CancellationSource(),
    });
    const end = emitter.events.find((e) => e.type === 'tool_end' && e.toolName === 'spawn_agent')!;
    return { result, meta: (end.result as { subagent: { report: string; branch?: string } }).subagent };
  };

  it('commits the child\'s edits on its own branch, not in the workspace', async () => {
    const { result, meta } = await run();
    expect(result.reason).toBe('completed');
    expect(meta.branch).toMatch(/^oc-agent-[0-9a-f]+$/);
    expect(meta.report).toContain(`git merge ${meta.branch}`);
    expect(meta.report).toContain('feature.txt');
    expect(fs.existsSync(path.join(ws.root, 'feature.txt'))).toBe(false);
    expect(git(ws.root, `show ${meta.branch}:feature.txt`)).toBe('new feature');
    expect(git(ws.root, 'worktree list')).not.toContain('.open-code');

    git(ws.root, `merge ${meta.branch}`);
    expect((await ws.read('feature.txt')).trim()).toBe('new feature');
  }, 60_000);

  it('removes the worktree and branch when nothing changed', async () => {
    state.childEdits = false;
    const { meta } = await run();
    expect(meta.branch).toBeUndefined();
    expect(meta.report).toContain('made no changes');
    expect(git(ws.root, 'branch --list oc-agent-*')).toBe('');
    expect(git(ws.root, 'worktree list').split('\n')).toHaveLength(1);
  }, 60_000);
});
