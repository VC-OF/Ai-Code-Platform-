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
});
