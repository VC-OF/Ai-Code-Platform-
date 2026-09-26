import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import { executeTool, createTurnContext, TOOL_SCHEMAS } from '@/lib/tools';
import { validateToolArgs } from '@/lib/toolValidator';
import { normalizeToolArgs } from '@/lib/toolArgNormalize';
import { imageDimensions, appendMemoryLine, executeScienceTool } from '@/lib/scienceTools';
import { parseNotebook, cellSource } from '@/lib/notebooks';

// Minimal valid image headers — enough for dimension parsing
const PNG_1x2 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
  Buffer.from([0, 0, 0, 1, 0, 0, 0, 2, 8, 6, 0, 0, 0]),
]);
const GIF_3x4 = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([3, 0, 4, 0, 0, 0, 0])]);
const JPEG_5x6 = Buffer.from([
  0xff, 0xd8,             // SOI
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 (len 4)
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x06, 0x00, 0x05, 0x01, 0x01, 0x11, 0x00, // SOF0: h=6 w=5
]);

describe('science tools: schemas and normalisation', () => {
  it('registers the new tools', () => {
    const names = TOOL_SCHEMAS.map((t) => t.function.name);
    for (const n of ['execute_code', 'view_image', 'notebook_edit', 'run_notebook', 'save_memory', 'spawn_agent']) {
      expect(names).toContain(n);
    }
  });

  it('validates arguments', () => {
    expect(validateToolArgs('execute_code', { language: 'python', code: 'print(1)' }).success).toBe(true);
    expect(validateToolArgs('execute_code', { language: 'cobol', code: 'x' }).success).toBe(false);
    expect(validateToolArgs('execute_code', { language: 'python', code: 'x', timeout_seconds: 5000 }).success).toBe(false);
    expect(validateToolArgs('view_image', { path: 'a.png' }).success).toBe(true);
    expect(validateToolArgs('view_image', { path: 'a.svg' }).success).toBe(false);
    expect(validateToolArgs('notebook_edit', { path: 'n.ipynb', action: 'insert', cell_index: 0, source: 'x' }).success).toBe(true);
    expect(validateToolArgs('notebook_edit', { path: 'n.txt', action: 'insert', cell_index: 0 }).success).toBe(false);
    expect(validateToolArgs('save_memory', { text: 'tiny' }).success).toBe(false);
    expect(validateToolArgs('spawn_agent', { kind: 'explore', task: 'Find the entry point of the app' }).success).toBe(true);
    expect(validateToolArgs('spawn_agent', { kind: 'boss', task: 'Find the entry point of the app' }).success).toBe(false);
  });

  it('repairs common alias slips', () => {
    expect(normalizeToolArgs('execute_code', { lang: 'PY', source: 'print(1)', timeout: '2000' })).toEqual({
      language: 'python', code: 'print(1)', timeout_seconds: 900,
    });
    expect(normalizeToolArgs('execute_code', { language: 'c++', code: 'x' })).toMatchObject({ language: 'cpp' });
    expect(normalizeToolArgs('notebook_edit', { file_path: 'n.ipynb', edit_mode: 'update', index: '2', new_source: 'y' })).toEqual({
      path: 'n.ipynb', action: 'replace', cell_index: 2, source: 'y',
    });
    expect(normalizeToolArgs('spawn_agent', { subagent_type: 'Explorer', prompt: 'look around', name: 'scout' })).toEqual({
      kind: 'explore', task: 'look around', label: 'scout',
    });
    expect(normalizeToolArgs('save_memory', { note: 'remember me' })).toEqual({ text: 'remember me' });
  });

  it('reads image dimensions from headers', () => {
    expect(imageDimensions(PNG_1x2)).toEqual({ width: 1, height: 2 });
    expect(imageDimensions(GIF_3x4)).toEqual({ width: 3, height: 4 });
    expect(imageDimensions(JPEG_5x6)).toEqual({ width: 5, height: 6 });
    expect(imageDimensions(Buffer.from('nope'))).toBeNull();
  });

  it('appends memory lines under ## Memory', () => {
    const fresh = appendMemoryLine('', 'use pnpm');
    expect(fresh).toEqual({ next: '## Memory\n- use pnpm\n', added: true });

    const existing = '# Project\n\n## Conventions\n- tabs\n\n## Memory\n- a\n\n## Later\n- z\n';
    const r = appendMemoryLine(existing, 'b');
    expect(r.added).toBe(true);
    expect(r.next).toBe('# Project\n\n## Conventions\n- tabs\n\n## Memory\n- a\n- b\n\n## Later\n- z\n');
    expect(appendMemoryLine(r.next, 'b')).toEqual({ next: r.next, added: false });

    const noSection = appendMemoryLine('# Notes\n- x\n', 'multi\nline');
    expect(noSection.next).toBe('# Notes\n- x\n\n## Memory\n- multi line\n');
  });
});

describe('science tools: execution', () => {
  let ws: TestWorkspace;
  let pythonAvailable = false;

  beforeAll(async () => {
    ws = await createWorkspace({ '.gitignore': 'node_modules\n', 'data.txt': 'hello from the workspace\n' });
    const probe = await executeScienceTool('execute_code', { language: 'python', code: 'print(1+1)' }, ws.root, createTurnContext(), ws.projectId);
    pythonAvailable = probe.success && probe.output.includes('2');
    if (!pythonAvailable) console.warn('[scienceTools.test] python not available on the host — python cases skipped');
  }, 60_000);

  afterAll(async () => {
    await ws.cleanup();
  });

  it('runs javascript from the workspace root and reports a scratch run dir', async () => {
    const ctx = createTurnContext();
    const r = await executeTool(
      'execute_code',
      { language: 'javascript', code: "const fs=require('fs'); console.log('DATA:' + fs.readFileSync('data.txt','utf8').trim()); console.log('RUN:' + process.env.OC_RUN_DIR)", description: 'read data' },
      ws.root, ctx
    );
    expect(r.success, r.output).toBe(true);
    expect(r.output).toContain('DATA:hello from the workspace');
    expect(r.output).toMatch(/RUN:\.open-code\/scratch\/run-/);
    expect(r.summary).toContain('JavaScript (Node) run succeeded — read data');
    expect(r.extra?.runDir).toMatch(/^\.open-code\/scratch\/run-/);
    expect(ctx.commandsRun).toContain('execute_code:javascript');
    // Scratch dir is created inside the workspace and git-ignored
    expect(await ws.exists(`${r.extra?.runDir}/main.js`)).toBe(true);
    expect(await ws.read('.gitignore')).toContain('.open-code/');
  }, 30_000);

  it('reports failures with exit code and stderr', async () => {
    const r = await executeTool('execute_code', { language: 'javascript', code: "console.error('boom'); process.exit(3)" }, ws.root, createTurnContext());
    expect(r.success).toBe(false);
    expect(r.output).toContain('exit 3');
    expect(r.output).toContain('--- stderr ---\nboom');
    expect(r.summary).toContain('failed (exit 3)');
  }, 30_000);

  it('kills runs that exceed the timeout', async () => {
    const r = await executeTool('execute_code', { language: 'javascript', code: 'setTimeout(() => {}, 60_000)', timeout_seconds: 1 }, ws.root, createTurnContext());
    expect(r.success).toBe(false);
    expect(r.output).toContain('TIMED OUT');
    expect(r.summary).toContain('timed out');
  }, 30_000);

  it('refuses docker-only languages on the host with guidance', async () => {
    const prev = process.env.SANDBOX_MODE;
    delete process.env.SANDBOX_MODE;
    try {
      const r = await executeTool('execute_code', { language: 'shell', code: 'echo hi' }, ws.root, createTurnContext());
      expect(r.success).toBe(false);
      expect(r.output).toMatch(/Docker sandbox/);
      const c = await executeTool('execute_code', { language: 'c', code: 'int main(){return 0;}' }, ws.root, createTurnContext());
      expect(c.output).toMatch(/compiled binary/);
    } finally {
      if (prev !== undefined) process.env.SANDBOX_MODE = prev;
    }
  });

  it('runs python with the runner and captures figures when matplotlib exists', async (t) => {
    if (!pythonAvailable) return t.skip();
    const r = await executeTool(
      'execute_code',
      {
        language: 'python',
        code: [
          'import sys',
          'print("argv0", sys.argv[0].replace("\\\\", "/"))',
          'try:',
          '    import matplotlib.pyplot as plt',
          '    plt.plot([0, 1], [0, 1]); plt.title("t")',
          '    plt.figure(); plt.hist([1, 2, 2, 3])',
          '    print("MPL yes")',
          'except ImportError:',
          '    print("MPL no")',
          'raise SystemExit(0)',
        ].join('\n'),
      },
      ws.root, createTurnContext()
    );
    expect(r.success, r.output).toBe(true);
    expect(r.output).toMatch(/argv0 .*main\.py/);
    if (r.output.includes('MPL yes')) {
      expect(r.output).toContain('Figures (2)');
      expect(r.output).toContain('figure-1.png');
      const images = r.extra?.images as { path: string; url: string }[];
      expect(images).toHaveLength(2);
      expect(images[0].url).toContain('/api/workspace/image?projectId=');
      expect(await ws.exists(images[1].path)).toBe(true);
    } else {
      expect(r.output).not.toContain('Figures');
    }
  }, 120_000);

  it('keeps python tracebacks pointing at main.py', async (t) => {
    if (!pythonAvailable) return t.skip();
    const r = await executeTool('execute_code', { language: 'python', code: 'x = 1\ny = 2\nraise ValueError("bad " + str(x + y))' }, ws.root, createTurnContext());
    expect(r.success).toBe(false);
    expect(r.output).toContain('ValueError: bad 3');
    expect(r.output).toMatch(/main\.py", line 3/);
  }, 60_000);

  it('views images, attaching a data URL and reporting dimensions', async () => {
    await ws.write('results/plot.png', '');
    await fs.writeFile(ws.resolve('results/plot.png'), PNG_1x2);
    const ctx = createTurnContext();
    const r = await executeTool('view_image', { path: 'results/plot.png' }, ws.root, ctx);
    expect(r.success).toBe(true);
    expect(r.output).toContain('1x2');
    expect(r.attachImage).toMatch(/^data:image\/png;base64,/);
    expect(r.extra).toMatchObject({ width: 1, height: 2, path: 'results/plot.png' });
    expect(String(r.extra?.imageUrl)).toContain('path=results%2Fplot.png');
    expect(ctx.filesRead.has('results/plot.png')).toBe(true);

    const missing = await executeTool('view_image', { path: 'results/nope.png' }, ws.root, ctx);
    expect(missing.success).toBe(false);
    const escape = await executeTool('view_image', { path: '../../etc/x.png' }, ws.root, ctx);
    expect(escape.success).toBe(false);
  });

  it('creates, reads, edits and deletes notebook cells', async () => {
    const ctx = createTurnContext();
    const created = await executeTool('notebook_edit', { path: 'analysis.ipynb', action: 'insert', cell_index: 0, cell_type: 'markdown', source: '# Analysis' }, ws.root, ctx);
    expect(created.success, created.output).toBe(true);
    expect(created.output).toContain('new notebook');
    expect(ctx.filesCreated.has('analysis.ipynb')).toBe(true);

    const appended = await executeTool('notebook_edit', { path: 'analysis.ipynb', action: 'insert', cell_index: 1, source: 'print(1)' }, ws.root, ctx);
    expect(appended.success).toBe(true);

    // read_file renders cells instead of raw JSON
    const read = await executeTool('read_file', { path: 'analysis.ipynb' }, ws.root, createTurnContext());
    expect(read.summary).toBe('Read notebook analysis.ipynb (2 cells)');
    expect(read.output).toContain('## Cell 1 [code]\nprint(1)');

    // Editing an existing notebook requires a read in this turn
    const fresh = createTurnContext();
    const rejected = await executeTool('notebook_edit', { path: 'analysis.ipynb', action: 'replace', cell_index: 1, source: 'print(2)' }, ws.root, fresh);
    expect(rejected.success).toBe(false);
    expect(rejected.output).toMatch(/read/);

    await executeTool('read_file', { path: 'analysis.ipynb' }, ws.root, fresh);
    const replaced = await executeTool('notebook_edit', { path: 'analysis.ipynb', action: 'replace', cell_index: 1, source: 'print(2)' }, ws.root, fresh);
    expect(replaced.success).toBe(true);
    const deleted = await executeTool('notebook_edit', { path: 'analysis.ipynb', action: 'delete', cell_index: 0 }, ws.root, fresh);
    expect(deleted.success).toBe(true);

    const nb = parseNotebook(await ws.read('analysis.ipynb'));
    expect(nb.cells).toHaveLength(1);
    expect(cellSource(nb.cells[0])).toBe('print(2)');
    expect(nb.nbformat).toBe(4);
  });

  it('saves memory into AGENTS.md', async () => {
    const ctx = createTurnContext();
    const r = await executeTool('save_memory', { text: 'The solver must use rtol=1e-8 for the stiff regime.' }, ws.root, ctx);
    expect(r.success).toBe(true);
    expect(r.changedFile).toBe('AGENTS.md');
    const agents = await ws.read('AGENTS.md');
    expect(agents).toContain('## Memory\n- The solver must use rtol=1e-8 for the stiff regime.');
    const dup = await executeTool('save_memory', { text: 'The solver must use rtol=1e-8 for the stiff regime.' }, ws.root, ctx);
    expect(dup.summary).toContain('duplicate');
    expect((await ws.read('AGENTS.md')).match(/rtol=1e-8/g)).toHaveLength(1);
  });

  it('prunes scratch run dirs beyond the retention limit', async () => {
    const scratch = ws.resolve('.open-code/scratch');
    for (let i = 0; i < 45; i++) {
      await fs.mkdir(path.join(scratch, `run-2000-01-01-00-00-${String(i).padStart(2, '0')}-aaaaaa`), { recursive: true });
    }
    await executeTool('execute_code', { language: 'javascript', code: 'console.log(1)' }, ws.root, createTurnContext());
    const dirs = (await fs.readdir(scratch)).filter((d) => d.startsWith('run-'));
    expect(dirs.length).toBeLessThanOrEqual(40);
    expect(dirs.some((d) => d.endsWith('-00-aaaaaa'))).toBe(false); // oldest gone
  }, 30_000);
});
