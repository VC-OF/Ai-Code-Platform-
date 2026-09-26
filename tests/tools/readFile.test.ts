import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeTool, createTurnContext } from '@/lib/tools';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

describe('read_file tool', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({
      'src/test.txt': 'hello read tool',
    });
  });

  afterEach(() => ws.cleanup());

  it('reads file successfully and marks as read', async () => {
    const ctx = createTurnContext();
    const result = await executeTool(
      'read_file',
      { path: 'src/test.txt' },
      ws.root,
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('hello read tool');
    expect(ctx.filesRead.has('src/test.txt')).toBe(true);
  });

  it('fails cleanly on a missing file', async () => {
    const ctx = createTurnContext();
    const result = await executeTool(
      'read_file',
      { path: 'src/nope.txt' },
      ws.root,
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns a numbered line range on request', async () => {
    await ws.write('src/big.txt', Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'));
    const ctx = createTurnContext();
    const r = await executeTool('read_file', { path: 'src/big.txt', start_line: 10, end_line: 12 }, ws.root, ctx);
    expect(r.success).toBe(true);
    expect(r.output).toBe('Lines 10-12 of 50 in src/big.txt:\n   10| line 10\n   11| line 11\n   12| line 12');
    expect(r.summary).toBe('Read src/big.txt lines 10-12 of 50');
    expect(ctx.filesRead.has('src/big.txt')).toBe(true); // a range read still satisfies the edit guard

    const tail = await executeTool('read_file', { path: 'src/big.txt', start_line: 49 }, ws.root, ctx);
    expect(tail.output).toContain('Lines 49-50 of 50');
    const beyond = await executeTool('read_file', { path: 'src/big.txt', start_line: 99 }, ws.root, ctx);
    expect(beyond.success).toBe(false);
  });
});
