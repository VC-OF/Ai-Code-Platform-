import { describe, it, expect, vi } from 'vitest';
import { closeDanglingToolCalls } from '@/lib/agentLoop';
import { withIdleTimeout, LLMStallError, getFallbackModels } from '@/lib/llmClient';
import { maxLockMs, workspaceLocks } from '@/lib/workspaceLock';
import { agentManager } from '@/lib/agentManager';
import { streamRegistry } from '@/lib/cancellation';
import type { ContextMessage } from '@/lib/contextManager';

describe('turn resilience', () => {
  it('answers tool calls left dangling when a turn ends mid-batch', () => {
    const msgs = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          { id: 'b', type: 'function', function: { name: 'run_tests', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'a', tool_name: 'read_file', content: 'ok' },
    ] as ContextMessage[];

    const out = closeDanglingToolCalls(msgs);
    expect(out).toHaveLength(4);
    expect(out[3]).toMatchObject({ role: 'tool', tool_call_id: 'b', tool_name: 'run_tests' });
    // Complete histories are untouched
    expect(closeDanglingToolCalls(out)).toHaveLength(4);
  });

  it('aborts a model stream that stops producing chunks', async () => {
    let stalled = false;
    async function* slow() {
      yield 1;
      await new Promise((r) => setTimeout(r, 1_000));
      yield 2;
    }
    const seen: number[] = [];
    await expect(async () => {
      for await (const n of withIdleTimeout(slow(), 50, () => { stalled = true; })) seen.push(n);
    }).rejects.toBeInstanceOf(LLMStallError);
    expect(seen).toEqual([1]);
    expect(stalled).toBe(true);
  });

  it('waits longer for the first chunk (prefill) than between chunks', async () => {
    async function* slowStart() {
      await new Promise((r) => setTimeout(r, 120));
      yield 1;
      await new Promise((r) => setTimeout(r, 120));
      yield 2;
    }
    const seen: number[] = [];
    await expect(async () => {
      for await (const n of withIdleTimeout(slowStart(), 50, () => {}, 300)) seen.push(n);
    }).rejects.toBeInstanceOf(LLMStallError);
    expect(seen).toEqual([1]); // first chunk allowed at 120ms < 300ms; second stalled at 50ms

    const { firstTokenTimeoutMs } = await import('@/lib/llmClient');
    expect(firstTokenTimeoutMs(1_000, 180_000, {})).toBe(180_000);           // tiny prompt → idle timeout
    expect(firstTokenTimeoutMs(150_000 * 3.5, 180_000, {})).toBe(375_000);   // 150k tokens → 6.25 min
    expect(firstTokenTimeoutMs(1_000_000 * 3.5, 180_000, {})).toBe(900_000); // capped at 15 min
    expect(firstTokenTimeoutMs(150_000 * 3.5, 180_000, { LLM_PREFILL_MS_PER_KTOKEN: '0' })).toBe(180_000);
  });

  it('passes through a healthy stream', async () => {
    async function* fast() { yield 1; yield 2; }
    const seen: number[] = [];
    for await (const n of withIdleTimeout(fast(), 1_000, () => {})) seen.push(n);
    expect(seen).toEqual([1, 2]);
  });

  it('honours FALLBACK_MODEL as well as LLM_FALLBACKS', () => {
    expect(getFallbackModels({ FALLBACK_MODEL: 'm2' })).toEqual(['m2']);
    expect(
      getFallbackModels({ LLM_FALLBACKS: 'a, b', FALLBACK_MODEL: 'b' })
    ).toEqual(['a', 'b']);
  });

  it('keeps the workspace lock for longer than the longest agent turn', () => {
    expect(maxLockMs({})).toBeGreaterThan(60 * 60_000);
    expect(maxLockMs({ AGENT_MAX_DURATION_MIN: '90' })).toBeGreaterThan(90 * 60_000);
  });

  it('keeps run state on globalThis so a re-evaluated module sees running agents', async () => {
    const release = await workspaceLocks.get('p-shared').acquire('test');
    streamRegistry.register('p-shared');
    const g = globalThis as Record<string, unknown>;
    expect((g.__ocWorkspaceMutexes as Map<string, unknown>).has('p-shared')).toBe(true);
    expect((g.__ocStreamSources as Map<string, unknown>).has('p-shared')).toBe(true);
    expect(g.__ocActiveAgents).toBeInstanceOf(Map);

    // Simulate HMR: a fresh copy of the modules must share that state
    vi.resetModules();
    const fresh = await import('@/lib/workspaceLock');
    const freshCancel = await import('@/lib/cancellation');
    const freshMgr = await import('@/lib/agentManager');
    expect(fresh.workspaceLocks).not.toBe(workspaceLocks);
    expect(fresh.workspaceLocks.get('p-shared').isLocked()).toBe(true);
    expect(freshCancel.streamRegistry.isActive('p-shared')).toBe(true);
    (g.__ocActiveAgents as Map<string, unknown>).set('p-shared', {});
    expect(freshMgr.agentManager.isRunning('p-shared')).toBe(true);
    expect(agentManager.isRunning('p-shared')).toBe(true);

    (g.__ocActiveAgents as Map<string, unknown>).delete('p-shared');
    streamRegistry.cleanup('p-shared');
    release();
  });
});

describe('text-written tool calls', () => {
  const names = ['create_file', 'update_plan', 'run_tests'];
  it('detects the common plain-text tool-call formats', async () => {
    const { looksLikeTextToolCall } = await import('@/lib/agentLoop');
    expect(looksLikeTextToolCall('ok <tool_call>\n{"name":"x"}', names)).toBe(true);
    expect(looksLikeTextToolCall('Setting up.\n## update_plan ##\n{"tasks": []}', names)).toBe(true);
    expect(looksLikeTextToolCall('{"tool": "update_plan", "tasks": []}', names)).toBe(true);
    expect(looksLikeTextToolCall('<function=create_file>{"path":"a"}</function>', names)).toBe(true);
  });
  it('does not flag ordinary answers', async () => {
    const { looksLikeTextToolCall } = await import('@/lib/agentLoop');
    expect(looksLikeTextToolCall('Done. I created src/lib.rs and ran the tests.', names)).toBe(false);
    expect(looksLikeTextToolCall('## Summary\nAll tests pass.', names)).toBe(false);
    expect(looksLikeTextToolCall('', names)).toBe(false);
  });
});

describe('hallucinated completion guard', () => {
  it('recognises replies that claim work was done', async () => {
    const { claimsCompletedWork } = await import('@/lib/agentLoop');
    expect(claimsCompletedWork('We have created the files cli.py and test_cli.py. Tests passed.')).toBe(true);
    expect(claimsCompletedWork('All tests pass.')).toBe(true);
    expect(claimsCompletedWork('A closure captures variables from its enclosing scope.')).toBe(false);
  });
});

describe('checkpoint excludes', () => {
  it('keeps build/dependency dirs out of checkpoints without touching .gitignore', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { execSync } = await import('child_process');
    const { ensureCheckpointExcludes } = await import('@/lib/agentLoop');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-ckpt-'));
    execSync('git init -q', { cwd: dir });
    fs.mkdirSync(path.join(dir, 'target', 'debug'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'target', 'debug', 'bin'), 'x');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'lib.rs'), 'fn a() {}');

    ensureCheckpointExcludes(dir);
    ensureCheckpointExcludes(dir); // idempotent
    execSync('git add -A', { cwd: dir });
    const staged = execSync('git diff --cached --name-only', { cwd: dir }).toString().trim().split('\n');
    expect(staged).toEqual(['src/lib.rs']);
    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);
    const exclude = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.match(/open-code checkpoint excludes/g)).toHaveLength(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
