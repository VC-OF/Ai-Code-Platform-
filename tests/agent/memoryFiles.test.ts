import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadMemoryFiles, expandImports, directoryMemoryFor, formatDirectoryMemory } from '@/lib/memoryFiles';
import { composeSystemPrompt } from '@/lib/promptComposer';
import { computeBreakdownFromParts } from '@/lib/contextBreakdown';
import { createHarness } from '@/lib/harness';

let root: string;
let ws: string;
let home: string;

function write(p: string, text: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-mem-'));
  ws = path.join(root, 'ws');
  home = path.join(root, 'home');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('loadMemoryFiles', () => {
  it('loads project and user memory files in order, labelled by file', () => {
    write(path.join(ws, 'AGENTS.md'), 'agents');
    write(path.join(ws, 'CLAUDE.md'), 'claude');
    write(path.join(ws, 'CLAUDE.local.md'), 'local');
    write(path.join(ws, '.claude', 'CLAUDE.md'), 'dotclaude');
    write(path.join(home, '.claude', 'CLAUDE.md'), 'user claude');
    write(path.join(home, '.open-code', 'AGENTS.md'), 'user agents');
    const files = loadMemoryFiles(ws, { home });
    expect(files.map((f) => f.name)).toEqual([
      'AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md',
      '~/.claude/CLAUDE.md', '~/.open-code/AGENTS.md',
    ]);
    expect(files.find((f) => f.name === '~/.claude/CLAUDE.md')?.scope).toBe('user');

    const prompt = composeSystemPrompt({ basePrompt: 'BASE', harness: createHarness('build'), memoryFiles: files });
    expect(prompt).toContain('## Project Memory (CLAUDE.md)\nclaude');
    expect(prompt).toContain('## User Memory (~/.claude/CLAUDE.md)\nuser claude');

    const b = computeBreakdownFromParts({
      model: 'm', windowSize: 100_000, messages: [], mcpTools: [], toolSchemas: [],
      parts: { basePrompt: '', harness: createHarness('build'), memoryFiles: files },
    });
    expect(b.memoryFiles.map((f) => f.name).sort()).toContain('CLAUDE.local.md');
    expect(b.memoryFiles).toHaveLength(6);
  });

  it('returns nothing for an empty workspace', () => {
    expect(loadMemoryFiles(ws, { home })).toEqual([]);
  });
});

describe('@path imports', () => {
  it('expands imports relative to the importing file, recursively', () => {
    write(path.join(ws, 'CLAUDE.md'), 'top\n@docs/style.md\nend');
    write(path.join(ws, 'docs', 'style.md'), 'style\n@more.md');
    write(path.join(ws, 'docs', 'more.md'), 'more');
    const [f] = loadMemoryFiles(ws, { home });
    expect(f.content).toBe('top\nstyle\nmore\nend');
  });

  it('skips cycles, escapes and missing files', () => {
    write(path.join(ws, 'a.md'), 'A\n@b.md');
    write(path.join(ws, 'b.md'), 'B\n@a.md');
    write(path.join(root, 'secret.md'), 'SECRET');
    const out = expandImports('@a.md\n@../secret.md\n@missing.md', path.join(ws, 'CLAUDE.md'), [ws], { home });
    expect(out).toBe('A\nB\n@a.md\n@../secret.md\n@missing.md');
    expect(out).not.toContain('SECRET');
  });

  it('allows ~/.claude imports and stops at depth 5', () => {
    write(path.join(home, '.claude', 'shared.md'), 'shared');
    expect(expandImports('@~/.claude/shared.md', path.join(ws, 'CLAUDE.md'), [ws, path.join(home, '.claude')], { home })).toBe('shared');
    for (let i = 0; i < 7; i++) write(path.join(ws, `d${i}.md`), `L${i}\n@d${i + 1}.md`);
    const out = expandImports('@d0.md', path.join(ws, 'CLAUDE.md'), [ws], { home });
    expect(out).toContain('L4');
    expect(out).not.toContain('L5');
    expect(out).toContain('@d5.md');
  });
});

describe('directoryMemoryFor', () => {
  it('surfaces subdirectory memory once per turn', () => {
    write(path.join(ws, 'CLAUDE.md'), 'root');
    write(path.join(ws, 'sub', 'CLAUDE.md'), 'sub rules');
    write(path.join(ws, 'sub', 'deep', 'AGENTS.md'), 'deep rules');
    const loaded = new Set<string>();
    const first = directoryMemoryFor(ws, 'sub/deep/file.ts', loaded);
    expect(first.map((e) => e.name)).toEqual(['sub/CLAUDE.md', 'sub/deep/AGENTS.md']);
    expect(formatDirectoryMemory(first)).toContain('[Directory memory from sub/CLAUDE.md]\nsub rules');
    expect(directoryMemoryFor(ws, 'sub/other.ts', loaded)).toEqual([]);
    expect(directoryMemoryFor(ws, 'top.ts', new Set())).toEqual([]);
    expect(directoryMemoryFor(ws, '../x/y.ts', new Set())).toEqual([]);
  });
});
