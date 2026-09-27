import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The proxy keeps its buckets in module state: load a fresh copy per test
async function loadProxy() {
  vi.resetModules();
  return (await import('@/proxy')).proxy;
}

const request = (path: string, method = 'GET') =>
  new NextRequest(`http://localhost:3000${path}`, { method, headers: { host: 'localhost:3000' } });

beforeEach(() => {
  vi.stubEnv('AUTH_TOKEN', '');
  vi.stubEnv('TRUST_PROXY', '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('proxy rate limits for /api/chat', () => {
  it('status polling and context refreshes do not use up the turn bucket', async () => {
    const proxy = await loadProxy();
    // A minute of 2 s status polling plus a busy timeline's context refreshes
    for (let i = 0; i < 30; i++) expect(proxy(request('/api/chat/status?projectId=p')).status).toBe(200);
    for (let i = 0; i < 60; i++) expect(proxy(request('/api/chat/context?projectId=p')).status).toBe(200);
    expect(proxy(request('/api/chat', 'POST')).status).toBe(200);
    expect(proxy(request('/api/chat/cancel', 'POST')).status).toBe(200);
    expect(proxy(request('/api/chat/queue', 'POST')).status).toBe(200);
    expect(proxy(request('/api/chat/input', 'POST')).status).toBe(200);
  });

  it('stop, steer and answer still work when new turns are rate limited', async () => {
    const proxy = await loadProxy();
    for (let i = 0; i < 20; i++) expect(proxy(request('/api/chat', 'POST')).status).toBe(200);
    expect(proxy(request('/api/chat', 'POST')).status).toBe(429);
    expect(proxy(request('/api/chat/cancel', 'POST')).status).toBe(200);
    expect(proxy(request('/api/chat/queue', 'POST')).status).toBe(200);
    expect(proxy(request('/api/chat/input', 'POST')).status).toBe(200);
  });

  it('keeps a tight limit on compaction, which calls the LLM', async () => {
    const proxy = await loadProxy();
    for (let i = 0; i < 10; i++) expect(proxy(request('/api/chat/compact', 'POST')).status).toBe(200);
    expect(proxy(request('/api/chat/compact', 'POST')).status).toBe(429);
    expect(proxy(request('/api/chat', 'POST')).status).toBe(200);
  });
});
