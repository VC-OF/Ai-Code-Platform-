import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import Database from 'better-sqlite3';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

let previewUrl: string | null = null;
vi.mock('@/lib/previewManager', () => ({
  getPreviewStatus: () =>
    previewUrl ? { status: 'running', url: previewUrl, port: 0, logs: [] } : { status: 'stopped', url: null, port: 4001, logs: [] },
  getPreviewLogs: () => ({ status: 'stopped', url: null, logs: [] }),
}));

import { executeTool, createTurnContext, TOOL_SCHEMAS } from '@/lib/tools';
import { validateToolArgs } from '@/lib/toolValidator';
import { normalizeToolArgs } from '@/lib/toolArgNormalize';
import { parseDelimited, buildPlotScript, executeAppTool } from '@/lib/appTools';
import { executeScienceTool } from '@/lib/scienceTools';
import { subagentToolSet } from '@/lib/subagents';
import type { LLMTool } from '@/lib/llmClient';

describe('app tools: registration and argument shapes', () => {
  it('registers the tools', () => {
    const names = TOOL_SCHEMAS.map((t) => t.function.name);
    for (const n of ['http_request', 'query_data', 'plot_data', 'review_changes']) expect(names).toContain(n);
    const explore = subagentToolSet('explore', TOOL_SCHEMAS as unknown as LLMTool[]).map((t) => (t as { function: { name: string } }).function.name);
    expect(explore).toContain('query_data');
    expect(explore).toContain('review_changes');
    expect(explore).not.toContain('http_request');
  });

  it('validates and normalises', () => {
    expect(validateToolArgs('http_request', { url: '/api/x', method: 'POST', body: { a: 1 } }).success).toBe(true);
    expect(validateToolArgs('http_request', { url: '/api/x', method: 'FETCH' }).success).toBe(false);
    expect(validateToolArgs('query_data', { source: 'data.csv' }).success).toBe(true);
    expect(validateToolArgs('query_data', { source: 'data.txt' }).success).toBe(false);
    expect(validateToolArgs('plot_data', { title: 'x' }).success).toBe(false); // neither series nor source
    expect(validateToolArgs('plot_data', { x: [1, 2], series: [{ y: [1, 2] }] }).success).toBe(true);
    expect(validateToolArgs('plot_data', { source: 'd.csv', x_column: 't', y_columns: ['v'] }).success).toBe(true);
    expect(validateToolArgs('review_changes', { base: 'HEAD~2' }).success).toBe(true);
    expect(validateToolArgs('review_changes', { base: 'main; rm -rf' }).success).toBe(false);

    expect(normalizeToolArgs('http_request', { endpoint: '/a', method: 'post', json: { k: 1 }, timeout: '500' })).toEqual({
      url: '/a', method: 'POST', body: { k: 1 }, timeout_seconds: 120,
    });
    expect(normalizeToolArgs('query_data', { file: 'd.csv', query: 'select 1', limit: '5' })).toEqual({ source: 'd.csv', sql: 'select 1', limit: 5 });
    expect(normalizeToolArgs('plot_data', { x: [1, 2], y: [3, 4], type: 'scatterplot' })).toEqual({ x: [1, 2], series: [{ y: [3, 4] }], kind: 'scatter' });
    expect(normalizeToolArgs('plot_data', { csv: 'd.csv', x_col: 't', y_column: 'v' })).toEqual({ source: 'd.csv', x_column: 't', y_columns: ['v'] });
  });

  it('parses delimited text with quotes and embedded newlines', () => {
    expect(parseDelimited('a,b\n1,"x, y"\n2,"line1\nline2"\n3,"say ""hi"""\n')).toEqual([
      ['a', 'b'], ['1', 'x, y'], ['2', 'line1\nline2'], ['3', 'say "hi"'],
    ]);
    expect(parseDelimited('a\tb\r\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('builds a self-contained matplotlib script', () => {
    const script = buildPlotScript({ kind: 'line', x: [1, 2, 3], series: [{ name: 's', y: [1, 4, 9] }], path: 'results/p.png', title: 'T' });
    expect(script).toContain('base64.b64decode');
    expect(script).toContain('matplotlib.use("Agg")');
    expect(script).not.toContain('results/p.png'); // data travels encoded, not interpolated
  });
});

describe('app tools: execution', () => {
  let ws: TestWorkspace;
  let server: http.Server;
  let matplotlib = false;
  const received: { method: string; url: string; body: string; type?: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push({ method: req.method!, url: req.url!, body, type: req.headers['content-type'] });
        if (req.url === '/api/items') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ items: [{ id: 1, name: 'alpha' }], total: 1 }));
        } else if (req.url === '/api/echo') {
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ got: JSON.parse(body || 'null') }));
        } else if (req.url === '/go') {
          res.writeHead(302, { location: '/api/items' });
          res.end();
        } else {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('nope');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    previewUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    ws = await createWorkspace({
      '.gitignore': 'node_modules\n',
      'data/sales.csv': 'region,month,revenue\nnorth,2024-01,120.5\nnorth,2024-02,80\nsouth,2024-01,"1,000"\nsouth,2024-02,99.25\n',
      'data/events.jsonl': '{"id":1,"kind":"click","ms":12}\n{"id":2,"kind":"view","ms":40}\n{"id":3,"kind":"click","ms":7}\n',
      'src/app.js': 'module.exports = () => 1;\n',
    });
    const db = new Database(ws.resolve('data/app.sqlite'));
    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1,'ada'),(2,'grace')");
    db.close();
    const probe = await executeScienceTool('execute_code', { language: 'python', code: 'import matplotlib; print("ok")' }, ws.root, createTurnContext(), ws.projectId);
    matplotlib = probe.success && probe.output.includes('ok');
    if (!matplotlib) console.warn('[appTools.test] matplotlib not available — plot rendering cases skipped');
  }, 60_000);

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await ws.cleanup();
  });

  it('http_request hits the preview by path, pretty-prints JSON and posts bodies', async () => {
    const get = await executeTool('http_request', { url: '/api/items' }, ws.root, createTurnContext());
    expect(get.success, get.output).toBe(true);
    expect(get.output).toContain('HTTP 200 OK');
    expect(get.output).toContain('"name": "alpha"');
    expect(get.summary).toMatch(/GET \/api\/items → 200/);

    const post = await executeTool('http_request', { url: '/api/echo', method: 'POST', body: { x: [1, 2] }, headers: { 'X-Test': '1' } }, ws.root, createTurnContext());
    expect(post.success).toBe(true);
    expect(post.output).toContain('HTTP 201');
    expect(post.output).toContain('"x": [');
    const echo = received.find((r) => r.url === '/api/echo')!;
    expect(echo.type).toBe('application/json');
    expect(JSON.parse(echo.body)).toEqual({ x: [1, 2] });

    const missing = await executeTool('http_request', { url: '/nope' }, ws.root, createTurnContext());
    expect(missing.success).toBe(false);
    expect(missing.error).toBe('HTTP 404');

    const redirect = await executeTool('http_request', { url: '/go' }, ws.root, createTurnContext());
    expect(redirect.output).toContain('HTTP 302');
    expect(redirect.output).toContain('location: /api/items');
  }, 30_000);

  it('http_request enforces the URL policy', async () => {
    const platform = await executeTool('http_request', { url: 'http://localhost:3000/api/projects' }, ws.root, createTurnContext());
    expect(platform.success).toBe(false);
    expect(platform.output).toMatch(/platform itself/);
    const privateIp = await executeTool('http_request', { url: 'http://10.0.0.5/admin' }, ws.root, createTurnContext());
    expect(privateIp.success).toBe(false);

    const saved = previewUrl;
    previewUrl = null;
    try {
      const noPreview = await executeTool('http_request', { url: '/api/items' }, ws.root, createTurnContext());
      expect(noPreview.success).toBe(false);
      expect(noPreview.output).toMatch(/preview is not running/);
    } finally {
      previewUrl = saved;
    }
  });

  it('query_data describes and queries CSV, JSONL and SQLite read-only', async () => {
    const ctx = createTurnContext();
    const schema = await executeTool('query_data', { source: 'data/sales.csv' }, ws.root, ctx);
    expect(schema.success, schema.output).toBe(true);
    expect(schema.output).toContain('Loaded 4 rows');
    expect(schema.output).toContain('revenue (TEXT)'); // "1,000" keeps the column textual
    expect(schema.output).toContain('month (TEXT)');
    expect(ctx.filesRead.has('data/sales.csv')).toBe(true);

    const agg = await executeTool('query_data', { source: 'data/sales.csv', sql: "SELECT region, COUNT(*) AS n FROM data GROUP BY region ORDER BY region" }, ws.root, ctx);
    expect(agg.success).toBe(true);
    expect(agg.output).toContain('| north | 2 |');
    expect(agg.output).toContain('| south | 2 |');

    const limited = await executeTool('query_data', { source: 'data/events.jsonl', sql: 'SELECT id, ms FROM data ORDER BY ms DESC', limit: 2 }, ws.root, ctx);
    expect(limited.output).toContain('2 row(s) shown (limit 2; more available)');
    expect(limited.output).toContain('| 2 | 40 |');
    expect(limited.extra).toMatchObject({ rows: 2, more: true });

    const sqlite = await executeTool('query_data', { source: 'data/app.sqlite', sql: 'SELECT name FROM users ORDER BY id' }, ws.root, ctx);
    expect(sqlite.success, sqlite.output).toBe(true);
    expect(sqlite.output).toContain('| ada |');
    const write = await executeTool('query_data', { source: 'data/app.sqlite', sql: "DELETE FROM users" }, ws.root, ctx);
    expect(write.success).toBe(false);
    expect(write.output).toMatch(/read-only/);
    const bad = await executeTool('query_data', { source: 'data/app.sqlite', sql: 'SELECT * FROM nothing' }, ws.root, ctx);
    expect(bad.success).toBe(false);
    expect(bad.output).toMatch(/SQL error/);
  });

  it('plot_data renders inline series and file-backed series', async (t) => {
    if (!matplotlib) return t.skip();
    const ctx = createTurnContext();
    const inline = await executeTool('plot_data', {
      title: 'Square', xlabel: 'x (m)', ylabel: 'y (m²)', kind: 'scatter',
      x: [1, 2, 3, 4], series: [{ name: 'x²', y: [1, 4, 9, 16] }, { name: 'x', y: [1, 2, 3, 4] }],
      path: 'results/square.png',
    }, ws.root, ctx);
    expect(inline.success, inline.output).toBe(true);
    expect(inline.changedFile).toBe('results/square.png');
    expect((inline.extra?.images as { url: string }[])[0].url).toContain('results%2Fsquare.png');
    expect((await fs.stat(ws.resolve('results/square.png'))).size).toBeGreaterThan(1000);

    const fromFile = await executeTool('plot_data', {
      source: 'data/sales.csv', sql: "SELECT month, SUM(CASE WHEN revenue GLOB '*,*' THEN 0 ELSE revenue END) AS total FROM data GROUP BY month",
      x_column: 'month', y_columns: ['total'], kind: 'bar', title: 'Revenue by month',
    }, ws.root, ctx);
    expect(fromFile.success, fromFile.output).toBe(true);
    expect(fromFile.output).toMatch(/2 points/);

    const badCol = await executeTool('plot_data', { source: 'data/sales.csv', x_column: 'month', y_columns: ['nope'] }, ws.root, ctx);
    expect(badCol.success).toBe(false);
    expect(badCol.output).toMatch(/Unknown column/);
  }, 120_000);

  it('review_changes reports the diff, stat and untracked files', async () => {
    await ws.write('src/app.js', 'module.exports = () => 2;\n');
    await ws.write('src/new.js', 'export const x = 1;\n');
    const r = await executeAppTool('review_changes', {}, ws.root, createTurnContext(), ws.projectId);
    expect(r.success, r.output).toBe(true);
    expect(r.output).toMatch(/\d+ tracked file\(s\) modified, 1 untracked/);
    expect(r.output).toContain('Untracked');
    expect(r.output).toContain('src/new.js');
    expect(r.output).toContain('-module.exports = () => 1;');
    expect(r.output).toContain('+module.exports = () => 2;');
    expect(r.extra).toMatchObject({ untracked: 1, base: 'HEAD' });
    expect(r.extra?.modified as number).toBeGreaterThanOrEqual(1);

    const scoped = await executeAppTool('review_changes', { path: 'data' }, ws.root, createTurnContext(), ws.projectId);
    expect(scoped.output).toContain('(no differences)');
    const badRef = await executeAppTool('review_changes', { base: 'deadbeef' }, ws.root, createTurnContext(), ws.projectId);
    expect(badRef.success).toBe(false);
  });
});
