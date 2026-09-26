import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { pathToFileURL } from 'url';
import os from 'os';
import {
  LspFrameParser, encodeLspMessage, resolvePosition, formatLocation, LineCache, toLocations, hoverText,
  formatSymbols, formatDiagnostics, languageForPath, resolveLspCommand, setLspCommandOverride,
  executeLspTool, shutdownAllLspServers,
} from '@/lib/lspTools';
import { executeTool, createTurnContext, TOOL_SCHEMAS } from '@/lib/tools';
import { validateToolArgs } from '@/lib/toolValidator';
import { normalizeToolArgs } from '@/lib/toolArgNormalize';
import { subagentToolSet } from '@/lib/subagents';
import { toolLabel } from '@/components/toolLabels';
import type { LLMTool } from '@/lib/llmClient';

// Plain temp dir (no git init) — keeps these tests fast under parallel load
interface TmpWorkspace { root: string; resolve: (p: string) => string; cleanup: () => Promise<void> }
async function tmpWorkspace(files: Record<string, string>): Promise<TmpWorkspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lsp-tools-'));
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  }
  return { root, resolve: (p) => path.join(root, p), cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

describe('lsp framing', () => {
  it('parses messages split across chunks', () => {
    const p = new LspFrameParser();
    const raw = encodeLspMessage({ id: 1, result: { text: 'héllo' } });
    const out: unknown[] = [];
    for (let i = 0; i < raw.length; i += 7) out.push(...p.push(raw.subarray(i, i + 7)));
    expect(out).toEqual([{ id: 1, result: { text: 'héllo' } }]);
  });

  it('parses several messages merged into one chunk, with extra headers', () => {
    const p = new LspFrameParser();
    const a = encodeLspMessage({ id: 1 });
    const b = Buffer.from('Content-Type: application/vscode-jsonrpc\r\ncontent-length: 8\r\n\r\n{"id":2}');
    const c = encodeLspMessage({ id: 3 });
    const merged = Buffer.concat([a, b, c.subarray(0, 5)]);
    expect(p.push(merged)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(p.push(c.subarray(5))).toEqual([{ id: 3 }]);
  });
});

describe('lsp positions and formatting', () => {
  const text = 'const alpha = 1;\n  function beta(alpha) {\n    return alphabet + alpha;\n  }\n';

  it('converts 1-based line/column and finds symbols by whole identifier', () => {
    expect(resolvePosition(text, { line: 2, column: 12 })).toEqual({ line: 1, character: 11 });
    expect(resolvePosition(text, { line: 2 })).toEqual({ line: 1, character: 2 });
    expect(resolvePosition(text, { symbol: 'beta' })).toEqual({ line: 1, character: 11 });
    expect(resolvePosition(text, { symbol: 'alpha', line: 3 })).toEqual({ line: 2, character: 22 });
    expect(() => resolvePosition(text, { symbol: 'gamma' })).toThrow(/not found/);
    expect(() => resolvePosition(text, { line: 99 })).toThrow(/past the end/);
  });

  it('formats locations, hovers, symbols and diagnostics', async () => {
    const ws = await tmpWorkspace({ 'src/a.ts': text });
    try {
      const uri = pathToFileURL(ws.resolve('src/a.ts')).href;
      const range = { start: { line: 1, character: 11 }, end: { line: 1, character: 15 } };
      expect(formatLocation(ws.root, { uri, range }, new LineCache())).toBe('src/a.ts:2:12  function beta(alpha) {');
      expect(toLocations([{ targetUri: uri, targetRange: range, targetSelectionRange: range }])).toEqual([{ uri, range }]);
      expect(toLocations(null)).toEqual([]);
      expect(hoverText({ contents: [{ language: 'ts', value: 'x: number' }, 'doc'] })).toBe('```ts\nx: number\n```\n\ndoc');
      expect(formatSymbols(ws.root, [{ name: 'C', kind: 5, selectionRange: range, children: [{ name: 'm', kind: 6, selectionRange: range }] }], uri))
        .toEqual(['class C  2:12', '  method m  2:12']);
      expect(formatDiagnostics('src/a.ts', [
        { range, severity: 2, message: 'warn' },
        { range: { start: { line: 0, character: 0 }, end: range.end }, severity: 1, message: 'bad\nmore', source: 'ts', code: 2304 },
      ])).toEqual(['src/a.ts:1:1 error: bad [ts 2304]', 'src/a.ts:2:12 warning: warn']);
    } finally {
      await ws.cleanup();
    }
  });

  it('maps extensions and reports missing servers clearly', async () => {
    expect(languageForPath('x.tsx')?.languageId).toBe('typescriptreact');
    expect(languageForPath('x.py')?.spec.id).toBe('python');
    expect(languageForPath('x.txt')).toBeNull();
    expect(resolveLspCommand('nope', process.cwd())).toBeNull();
    const ws = await tmpWorkspace({ 'main.zig': 'x', 'a.rs': 'fn main() {}' });
    const savedPath = process.env.PATH;
    try {
      const r = await executeLspTool('lsp_diagnostics', { path: 'main.zig' }, ws.root);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/no language server/);
      process.env.PATH = '';
      const r2 = await executeLspTool('lsp_hover', { path: 'a.rs', line: 1, column: 4 }, ws.root);
      expect(r2.success).toBe(false);
      expect(r2.error).toMatch(/rust-analyzer/);
      expect(r2.error).toMatch(/rustup component add/);
    } finally {
      process.env.PATH = savedPath;
      await ws.cleanup();
    }
  });
});

describe('lsp tools: registration and arguments', () => {
  const names = ['lsp_definition', 'lsp_references', 'lsp_hover', 'lsp_symbols', 'lsp_diagnostics'];

  it('registers read-only tools', () => {
    const all = TOOL_SCHEMAS.map((t) => t.function.name);
    for (const n of names) expect(all).toContain(n);
    const explore = subagentToolSet('explore', TOOL_SCHEMAS as unknown as LLMTool[]).map((t) => (t as { function: { name: string } }).function.name);
    for (const n of names) expect(explore).toContain(n);
    expect(toolLabel('lsp_definition', { path: 'a.ts', symbol: 'foo' })).toBe('Finding definition of foo in a.ts');
  });

  it('normalises and validates', () => {
    const args = normalizeToolArgs('lsp_references', { file_path: 'a.ts', line: '3', col: '5', include_declaration: 'false' });
    expect(args).toEqual({ path: 'a.ts', line: 3, column: 5, include_declaration: false });
    expect(validateToolArgs('lsp_references', args).success).toBe(true);
    expect(validateToolArgs('lsp_hover', { path: 'a.ts' }).success).toBe(false);
    expect(validateToolArgs('lsp_hover', { path: 'a.ts', symbol: 'x' }).success).toBe(true);
    expect(validateToolArgs('lsp_symbols', {}).success).toBe(false);
    expect(validateToolArgs('lsp_symbols', { query: 'x' }).success).toBe(true);
  });
});

describe('lsp tools against a fake language server', () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
  let ws: TmpWorkspace;
  const src = 'export function greet(name: string) {\n  return name;\n}\nconst a = greet("x");\nconst b = greet("y");\n';

  beforeAll(async () => {
    setLspCommandOverride('typescript', { command: path.resolve(__dirname, '../helpers/fakeLspServer.cjs'), args: [] });
    ws = await tmpWorkspace({ 'src/app.ts': src });
  });
  afterAll(async () => {
    await shutdownAllLspServers();
    setLspCommandOverride('typescript', null);
    await ws.cleanup();
  });

  it('finds the definition by symbol', async () => {
    const r = await executeTool('lsp_definition', { path: 'src/app.ts', line: 4, column: 11 }, ws.root, createTurnContext());
    expect(r.success).toBe(true);
    expect(r.output).toBe('src/app.ts:1:17  export function greet(name: string) {');
  });

  it('lists references with and without the declaration', async () => {
    const r = await executeLspTool('lsp_references', { path: 'src/app.ts', symbol: 'greet' }, ws.root);
    expect(r.output.split('\n')).toEqual([
      'src/app.ts:1:17  export function greet(name: string) {',
      'src/app.ts:4:11  const a = greet("x");',
      'src/app.ts:5:11  const b = greet("y");',
    ]);
    const r2 = await executeLspTool('lsp_references', { path: 'src/app.ts', symbol: 'greet', include_declaration: false }, ws.root);
    expect(r2.output.split('\n')).toHaveLength(2);
    expect(r2.summary).toBe('2 references for src/app.ts:1:17');
  });

  it('hovers and outlines', async () => {
    const h = await executeLspTool('lsp_hover', { path: 'src/app.ts', symbol: 'name' }, ws.root);
    expect(h.output).toBe('src/app.ts:1:23\nhover: name');
    const s = await executeLspTool('lsp_symbols', { path: 'src/app.ts' }, ws.root);
    expect(s.output).toBe('src/app.ts\nfunction greet  1:17');
    const q = await executeLspTool('lsp_symbols', { query: 'greet' }, ws.root);
    expect(q.output).toBe('variable greet  src/app.ts:1:17');
  });

  it('reports diagnostics and re-syncs after the file changes', async () => {
    const clean = await executeLspTool('lsp_diagnostics', { path: 'src/app.ts' }, ws.root);
    expect(clean.output).toBe('src/app.ts: no problems.');
    await new Promise((r) => setTimeout(r, 20));
    await fs.writeFile(ws.resolve('src/app.ts'), src + 'const c = BAD;\n');
    const bad = await executeLspTool('lsp_diagnostics', { path: 'src/app.ts' }, ws.root);
    expect(bad.output).toBe('src/app.ts:6:11 error: BAD is not allowed [fake 42]');
    expect(bad.summary).toMatch(/^1 error/);
  });

  it('rejects paths outside the workspace', async () => {
    const r = await executeLspTool('lsp_hover', { path: '../outside.ts', line: 1 }, ws.root);
    expect(r.success).toBe(false);
  });
});
