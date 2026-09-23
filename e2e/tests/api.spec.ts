import { test, expect } from '@playwright/test';
import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Request-level e2e against the real API: project lifecycle, settings
 * scoping, provider/MCP status, and the security middleware.
 */

test.describe('API', () => {
  let projectId: string;

  test('health reports healthy', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('healthy');
  });

  test('project lifecycle: create (template) → scaffolded files → delete', async ({ request }) => {
    const created = await request.post('/api/projects', {
      data: { title: 'e2e-suite-project', template: 'static-site' },
    });
    expect(created.ok()).toBeTruthy();
    const { project } = await created.json();
    expect(project.id).toMatch(/^proj_/);
    expect(project.title).toBe('e2e-suite-project');
    projectId = project.id;

    // Template files landed in the workspace
    const tree = await request
      .get(`/api/files?projectId=${projectId}`)
      .then((r) => r.json());
    const paths = (tree.tree as { path: string }[]).map((n) =>
      n.path.replace(/\\/g, '/')
    );
    expect(paths).toContain('index.html');
    expect(paths).toContain('package.json');
    expect(paths).toContain('AGENTS.md');

    // Listed in the project index
    const list = await request.get('/api/projects').then((r) => r.json());
    expect(list.projects.some((p: { id: string }) => p.id === projectId)).toBe(true);

    // Delete removes it from the index
    const del = await request.delete(`/api/projects?id=${projectId}`);
    expect(del.ok()).toBeTruthy();
    const after = await request.get('/api/projects').then((r) => r.json());
    expect(after.projects.some((p: { id: string }) => p.id === projectId)).toBe(false);
  });

  test('Build Mode: opens a real folder without scaffolding a template', async ({ request }) => {
    const dir = path.join(os.tmpdir(), 'oc-e2e-buildmode-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'real pre-existing file');

    try {
      const created = await request.post('/api/projects', {
        data: { mode: 'build', path: dir, title: 'E2E Build Mode' },
      });
      expect(created.ok()).toBeTruthy();
      const { project } = await created.json();
      expect(project.kind).toBe('build');

      const tree = await request.get(`/api/files?projectId=${project.id}`).then((r) => r.json());
      const paths = (tree.tree as { path: string }[]).map((n) => n.path.replace(/\\/g, '/'));
      expect(paths).toContain('notes.txt');
      expect(paths).not.toContain('package.json'); // no template scaffolding

      await request.delete(`/api/projects?id=${project.id}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Build Mode: rejects a forbidden path', async ({ request }) => {
    const res = await request.post('/api/projects', {
      data: { mode: 'build', path: process.platform === 'win32' ? 'C:\\Windows' : '/etc' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/system directory/);
  });

  test('settings are project-scoped with masked values', async ({ request }) => {
    const { project } = await request
      .post('/api/projects', { data: { title: 'e2e-settings', template: 'blank' } })
      .then((r) => r.json());

    await request.post('/api/settings', {
      data: { key: 'E2E_SECRET', value: 'super-secret', projectId: project.id },
    });

    const scoped = await request
      .get(`/api/settings?projectId=${project.id}`)
      .then((r) => r.json());
    const entry = scoped.vars.find((v: { key: string }) => v.key === 'E2E_SECRET');
    expect(entry).toBeTruthy();
    expect(entry.scope).toBe('project');
    expect(entry.value).not.toContain('super-secret'); // masked

    // Not visible globally
    const globalVars = await request.get('/api/settings').then((r) => r.json());
    expect(
      globalVars.vars.some((v: { key: string }) => v.key === 'E2E_SECRET')
    ).toBe(false);

    await request.delete('/api/settings', {
      data: { key: 'E2E_SECRET', projectId: project.id },
    });
    await request.delete(`/api/projects?id=${project.id}`);
  });

  test('providers endpoint reports the registry', async ({ request }) => {
    const body = await request.get('/api/providers').then((r) => r.json());
    const ids = body.providers.map((p: { id: string }) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['groq', 'openrouter', 'together', 'ollama', 'lmstudio', 'localai'])
    );
    expect(body).toHaveProperty('usageByModel');
  });

  test('plan endpoint: empty by default, clearable', async ({ request }) => {
    const { project } = await request
      .post('/api/projects', { data: { title: 'e2e-plan', template: 'blank' } })
      .then((r) => r.json());

    const plan = await request
      .get(`/api/plan?projectId=${project.id}`)
      .then((r) => r.json());
    expect(plan.tasks).toEqual([]);

    const cleared = await request.delete('/api/plan', {
      data: { projectId: project.id },
    });
    expect(cleared.ok()).toBeTruthy();

    await request.delete(`/api/projects?id=${project.id}`);
  });

  test('mcp endpoint responds', async ({ request }) => {
    const body = await request.get('/api/mcp').then((r) => r.json());
    expect(body).toHaveProperty('servers');
    expect(body).toHaveProperty('configPath');
  });

  test('CSRF: cross-origin writes are rejected', async ({ request }) => {
    const res = await request.post('/api/command', {
      headers: { Origin: 'http://evil.example' },
      data: { command: 'echo pwned', projectId: 'default' },
    });
    expect(res.status()).toBe(403);
  });

  test('command endpoint enforces the allowlist', async ({ request }) => {
    const res = await request.post('/api/command', {
      data: { command: 'curl http://evil.example', projectId: 'default' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('not in the allowed list');
  });

  test('database endpoint blocks DDL', async ({ request }) => {
    const res = await request.post('/api/database', {
      data: { sql: 'DROP TABLE messages' },
    });
    expect(res.status()).toBe(403);
  });
});
