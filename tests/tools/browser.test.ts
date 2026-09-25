import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import path from 'path';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

let previewUrl: string | null = null;
vi.mock('@/lib/previewManager', () => ({
  getPreviewStatus: () =>
    previewUrl ? { status: 'running', url: previewUrl, port: 0, logs: [] } : { status: 'stopped', url: null, port: 4001, logs: [] },
}));

import { checkUrlAllowed } from '@/lib/browserSession';
import { executeBrowserTool } from '@/lib/browserTools';
import { validateToolArgs } from '@/lib/toolValidator';

describe('browser URL policy', () => {
  const ctx = { previewUrl: 'http://localhost:4007', platformPort: 3000 };
  it.each([
    'http://localhost:4007/',
    'http://127.0.0.1:4007/about',
    'http://localhost:4007/x?y=1',
    'http://93.184.215.14/', // public literal IP
  ])('allows %s', async (u) => {
    await expect(checkUrlAllowed(u, ctx)).resolves.toBeInstanceOf(URL);
  });
  it.each([
    'file:///etc/passwd',
    'chrome://settings',
    'data:text/html,<h1>x</h1>',
    'javascript:alert(1)',
    'http://localhost:3000/',
    'http://127.0.0.1:3000/api/projects',
    'http://localhost:5555/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]:4008/',
    'not a url',
  ])('blocks %s', async (u) => {
    await expect(checkUrlAllowed(u, ctx)).rejects.toThrow();
  });
  it('blocks localhost when no preview is running', async () => {
    await expect(checkUrlAllowed('http://localhost:4007/', { previewUrl: null })).rejects.toThrow(/not running/);
  });
});

describe('browser tool validation', () => {
  it('validates args', () => {
    expect(validateToolArgs('browser_click', { ref: 'e1' }).success).toBe(true);
    expect(validateToolArgs('browser_click', {}).success).toBe(false);
    expect(validateToolArgs('browser_wait', { ms: 60_000 }).success).toBe(false);
    expect(validateToolArgs('browser_snapshot', {}).success).toBe(true);
  });
});

const PAGE = `<!doctype html><html><head><title>Test Page</title></head><body>
<h1>Hello browser</h1>
<input id="name" aria-label="Your name" />
<button id="go" onclick="document.getElementById('out').textContent='Hi '+document.getElementById('name').value">Greet</button>
<select aria-label="Color"><option value="r">Red</option><option value="g">Green</option></select>
<p id="out"></p>
<button onclick="console.error('boom from click'); throw new Error('kaboom')">Break</button>
<script>console.warn('loaded warning'); fetch('/missing.json');</script>
</body></html>`;

describe('built-in browser (real Chromium)', () => {
  let server: http.Server;
  let ws: TestWorkspace;
  let available = true;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/' || req.url?.startsWith('/?')) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PAGE);
      } else {
        res.writeHead(404);
        res.end('nope');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    previewUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ws = await createWorkspace({ '.gitignore': 'node_modules\n' });
    const r = await executeBrowserTool('browser_open', {}, ws.root, ws.projectId);
    if (!r.success && /No browser available/.test(r.error ?? '')) {
      available = false;
      console.warn('[browser.test] skipping: no Chrome/Edge available');
    } else {
      expect(r.success, r.output).toBe(true);
    }
  }, 60_000);

  afterAll(async () => {
    if (ws) {
      await executeBrowserTool('browser_close', {}, ws.root, ws.projectId);
      await ws.cleanup();
    }
    await new Promise((r) => server.close(r));
  });

  it('snapshots with refs, types and clicks', async (t) => {
    if (!available) return t.skip();
    const snap = await executeBrowserTool('browser_snapshot', {}, ws.root, ws.projectId);
    expect(snap.output).toContain('Title: Test Page');
    expect(snap.output).toContain('Hello browser');
    const input = snap.output.match(/\[(e\d+)\] textbox\[text\] "Your name"/)?.[1];
    const button = snap.output.match(/\[(e\d+)\] button "Greet"/)?.[1];
    const select = snap.output.match(/\[(e\d+)\] combobox "Color"/)?.[1];
    expect(input && button && select).toBeTruthy();

    expect((await executeBrowserTool('browser_type', { ref: input, text: 'Ada' }, ws.root, ws.projectId)).success).toBe(true);
    const click = await executeBrowserTool('browser_click', { ref: button }, ws.root, ws.projectId);
    expect(click.success).toBe(true);
    expect(click.output).toContain('Hi Ada');
    const sel = await executeBrowserTool('browser_select', { ref: select, values: ['Green'] }, ws.root, ws.projectId);
    expect(sel.output).toContain('Selected: g');

    const stale = await executeBrowserTool('browser_click', { ref: 'e9999' }, ws.root, ws.projectId);
    expect(stale.success).toBe(false);
    expect(stale.output).toMatch(/browser_snapshot/);
  }, 60_000);

  it('captures console messages, page errors and failed requests', async (t) => {
    if (!available) return t.skip();
    const snap = await executeBrowserTool('browser_snapshot', {}, ws.root, ws.projectId);
    const brk = snap.output.match(/\[(e\d+)\] button "Break"/)?.[1];
    await executeBrowserTool('browser_click', { ref: brk }, ws.root, ws.projectId);
    const c = await executeBrowserTool('browser_console', {}, ws.root, ws.projectId);
    expect(c.output).toContain('loaded warning');
    expect(c.output).toContain('boom from click');
    expect(c.output).toMatch(/PAGE ERROR.*kaboom/);
    expect(c.output).toMatch(/missing\.json.*404/);
    const again = await executeBrowserTool('browser_console', {}, ws.root, ws.projectId);
    expect(again.summary).toBe('Console clean');
  }, 60_000);

  it('writes screenshots inside the workspace', async (t) => {
    if (!available) return t.skip();
    const r = await executeBrowserTool('browser_screenshot', {}, ws.root, ws.projectId);
    expect(r.success).toBe(true);
    const rel = r.extra?.screenshot as string;
    expect(rel).toMatch(/^\.open-code\/screenshots\/.+\.png$/);
    const stat = await fs.stat(path.join(ws.root, rel));
    expect(stat.size).toBeGreaterThan(1000);
    expect(r.extra?.width).toBe(1280);
    expect(await ws.read('.gitignore')).toContain('.open-code/');
  }, 60_000);

  it('refuses navigation off-policy', async (t) => {
    if (!available) return t.skip();
    const r = await executeBrowserTool('browser_open', { url: 'http://localhost:3000/' }, ws.root, ws.projectId);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/platform/);
  });
});
