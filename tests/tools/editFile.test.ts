import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeTool, createTurnContext } from '@/lib/tools';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

describe('edit_file tool', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({
      'src/test.txt': 'original content',
      'src/dup.txt': 'alpha\nrepeat me\nbeta\nrepeat me\ngamma',
    });
  });

  afterEach(() => ws.cleanup());

  it('rejects edit without a turn-scoped read first', async () => {
    const ctx = createTurnContext();
    const result = await executeTool(
      'edit_file',
      { path: 'src/test.txt', oldText: 'original', newText: 'updated' },
      ws.root,
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('must be read first');
  });

  it('allows edit after read in the same turn', async () => {
    const ctx = createTurnContext();

    await executeTool('read_file', { path: 'src/test.txt' }, ws.root, ctx);

    const result = await executeTool(
      'edit_file',
      { path: 'src/test.txt', oldText: 'original content', newText: 'updated content' },
      ws.root,
      ctx
    );

    expect(result.success).toBe(true);
    expect(await ws.read('src/test.txt')).toBe('updated content');
  });

  it('rejects an ambiguous oldText that matches more than once', async () => {
    const ctx = createTurnContext();

    await executeTool('read_file', { path: 'src/dup.txt' }, ws.root, ctx);

    const result = await executeTool(
      'edit_file',
      { path: 'src/dup.txt', oldText: 'repeat me', newText: 'changed' },
      ws.root,
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('unique');
    // File must be untouched
    expect(await ws.read('src/dup.txt')).toContain('repeat me\nbeta\nrepeat me');
  });

  it('applies a whitespace-normalised fuzzy match when unique', async () => {
    const ctx = createTurnContext();
    await ws.write('src/fuzzy.txt', 'function  add(a,   b) {\n  return a + b;\n}');

    await executeTool('read_file', { path: 'src/fuzzy.txt' }, ws.root, ctx);

    const result = await executeTool(
      'edit_file',
      {
        path: 'src/fuzzy.txt',
        oldText: 'function add(a, b) {',
        newText: 'function add(a: number, b: number) {',
      },
      ws.root,
      ctx
    );

    expect(result.success).toBe(true);
    expect(await ws.read('src/fuzzy.txt')).toContain('a: number');
  });
});
