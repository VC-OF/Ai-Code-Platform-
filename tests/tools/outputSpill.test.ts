import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { executeTool, createTurnContext, spillFullOutput } from '@/lib/tools';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

const prevMode = process.env.SANDBOX_MODE;

describe('large tool output spill', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    delete process.env.SANDBOX_MODE;
    ws = await createWorkspace({
      'big.js': "for (let i = 0; i < 1400; i++) console.log('line ' + i + ' ' + 'x'.repeat(20));\n",
      'small.js': "console.log('hello');\n",
    });
  });

  afterEach(async () => {
    if (prevMode !== undefined) process.env.SANDBOX_MODE = prevMode;
    await ws.cleanup();
  });

  it('saves the full run_command output and points at it', async () => {
    const r = await executeTool('run_command', { command: 'node big.js' }, ws.root, createTurnContext());
    expect(r.success).toBe(true);
    const m = r.output.match(/\[Full output \((\d+) chars\) saved to (\.open-code\/outputs\/run_command-[^\s]+\.txt) — read it with read_file/);
    expect(m, r.output.slice(-300)).not.toBeNull();
    const saved = await ws.read(m![2]);
    expect(saved.length).toBe(Number(m![1]));
    expect(saved).toContain('line 0 ');
    expect(saved).toContain('line 700 ');
    expect(saved).toContain('line 1399 ');
    expect(r.output).not.toContain('line 700 ');
  }, 30_000);

  it('does not spill short output', async () => {
    const r = await executeTool('run_command', { command: 'node small.js' }, ws.root, createTurnContext());
    expect(r.output).not.toContain('Full output');
    expect(await ws.exists('.open-code/outputs')).toBe(false);
  }, 30_000);

  it('spills grep results beyond the shown matches', async () => {
    const lines = Array.from({ length: 150 }, (_, i) => `needle ${i}`).join('\n');
    await ws.write('hay.txt', lines);
    const r = await executeTool('grep_files', { pattern: 'needle' }, ws.root, createTurnContext());
    expect(r.output).toMatch(/Full output .* saved to \.open-code\/outputs\/grep_files-/);
  });

  it('keeps only the newest 50 files', async () => {
    for (let i = 0; i < 55; i++) await spillFullOutput(ws.root, 't', `out ${i}`);
    const files = await fs.readdir(path.join(ws.root, '.open-code', 'outputs'));
    expect(files.length).toBe(50);
  });
});
