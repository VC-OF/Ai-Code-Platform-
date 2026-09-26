import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeTool, createTurnContext } from '@/lib/tools';
import { validateTool } from '@/lib/toolValidator';
import { normalizeToolArgs } from '@/lib/toolArgNormalize';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

const SRC = 'const a = 1;\nconst b = 2;\nlog(a);\nlog(b);\n';

describe('multi_edit and edit_file replace_all', () => {
  let ws: TestWorkspace;
  beforeEach(async () => { ws = await createWorkspace({ 'src/x.ts': SRC }); });
  afterEach(() => ws.cleanup());

  const readCtx = async () => {
    const ctx = createTurnContext();
    await executeTool('read_file', { path: 'src/x.ts' }, ws.root, ctx);
    return ctx;
  };

  it('requires a fresh read', async () => {
    const r = await executeTool('multi_edit', { path: 'src/x.ts', edits: [{ oldText: 'a', newText: 'b' }] }, ws.root, createTurnContext());
    expect(r.success).toBe(false);
    expect(r.error).toContain('must be read first');
  });

  it('applies edits sequentially', async () => {
    const r = await executeTool('multi_edit', {
      path: 'src/x.ts',
      edits: [
        { oldText: 'const a = 1;', newText: 'const alpha = 1;' },
        { oldText: 'log(a);', newText: 'log(alpha);' },
        { oldText: 'log(', newText: 'console.log(', replace_all: true },
        { oldText: 'console.log(alpha)', newText: 'console.info(alpha)' }, // sees earlier edits
      ],
    }, ws.root, await readCtx());
    expect(r.success, r.output).toBe(true);
    expect(r.changedFile).toBe('src/x.ts');
    expect(await ws.read('src/x.ts')).toBe('const alpha = 1;\nconst b = 2;\nconsole.info(alpha);\nconsole.log(b);\n');
  });

  it('is atomic: a failing edit writes nothing', async () => {
    const r = await executeTool('multi_edit', {
      path: 'src/x.ts',
      edits: [
        { oldText: 'const a = 1;', newText: 'const z = 1;' },
        { oldText: 'log(', newText: 'x(' }, // ambiguous
      ],
    }, ws.root, await readCtx());
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/edit 2 of 2.*matched 2 times/);
    expect(await ws.read('src/x.ts')).toBe(SRC);

    const missing = await executeTool('multi_edit', { path: 'src/x.ts', edits: [{ oldText: 'nope', newText: '' }] }, ws.root, await readCtx());
    expect(missing.success).toBe(false);
    expect(missing.output).toContain('was not found');
    expect(await ws.read('src/x.ts')).toBe(SRC);
  });

  it('edit_file replace_all replaces every occurrence', async () => {
    const ctx = await readCtx();
    const plain = await executeTool('edit_file', { path: 'src/x.ts', oldText: 'log(', newText: 'out(' }, ws.root, ctx);
    expect(plain.success).toBe(false);
    const all = await executeTool('edit_file', { path: 'src/x.ts', oldText: 'log(', newText: 'out(', replace_all: true }, ws.root, ctx);
    expect(all.success).toBe(true);
    expect(await ws.read('src/x.ts')).toBe('const a = 1;\nconst b = 2;\nout(a);\nout(b);\n');
  });

  it('normalizes aliases and validates', () => {
    const args = normalizeToolArgs('multi_edit', {
      file_path: 'src/x.ts',
      edits: [{ old_string: 'a', new_string: 'b', replaceAll: true }],
    });
    expect(args).toEqual({ path: 'src/x.ts', edits: [{ oldText: 'a', newText: 'b', replace_all: true }] });
    expect(validateTool('multi_edit', args).ok).toBe(true);
    expect(validateTool('multi_edit', { path: 'x', edits: [] }).ok).toBe(false);
  });
});
