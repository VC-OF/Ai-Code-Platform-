import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Fresh module per test: the rate-limit buckets are module state
async function loadProxy() {
  vi.resetModules();
  return (await import('@/proxy')).proxy;
}

function req(method: string, path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { host: 'localhost:3000', ...headers },
  });
}

/** Status codes of `n` identical requests (200 = passed through to the route). */
function statuses(proxy: (r: NextRequest) => Response, method: string, path: string, n: number): number[] {
  return Array.from({ length: n }, () => proxy(req(method, path)).status);
}

describe('proxy rate limits', () => {
  const savedToken = process.env.AUTH_TOKEN;
  beforeEach(() => { delete process.env.AUTH_TOKEN; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => {
    if (savedToken === undefined) delete process.env.AUTH_TOKEN; else process.env.AUTH_TOKEN = savedToken;
    vi.restoreAllMocks();
  });

  it('project reads get their own bucket: many page loads do not lock the project list', async () => {
    const proxy = await loadProxy();
    // ~6 reads per page load × 30 loads in a minute
    expect(statuses(proxy, 'GET', '/api/projects', 180).every((s) => s === 200)).toBe(true);
    // Writes are still available after all those reads
    expect(proxy(req('POST', '/api/projects')).status).toBe(200);
  });

  it('project writes keep the strict limit (60/min) and reads do not consume it', async () => {
    const proxy = await loadProxy();
    const writes = statuses(proxy, 'POST', '/api/projects', 61);
    expect(writes.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(writes[60]).toBe(429);
    // DELETE shares the write bucket
    expect(proxy(req('DELETE', '/api/projects?id=x')).status).toBe(429);
    // Reads are unaffected by exhausted writes
    expect(proxy(req('GET', '/api/projects')).status).toBe(200);
  });

  it('reads have a ceiling too', async () => {
    const proxy = await loadProxy();
    const reads = statuses(proxy, 'GET', '/api/projects', 301);
    expect(reads.filter((s) => s === 200)).toHaveLength(300);
    const last = proxy(req('GET', '/api/projects'));
    expect(last.status).toBe(429);
    expect(last.headers.get('Retry-After')).toMatch(/^\d+$/);
  });

  it('starting LLM turns stays at 20/min while chat status reads are separate', async () => {
    const proxy = await loadProxy();
    expect(statuses(proxy, 'GET', '/api/chat/status?projectId=p', 100).every((s) => s === 200)).toBe(true);
    const turns = statuses(proxy, 'POST', '/api/chat', 21);
    expect(turns.filter((s) => s === 200)).toHaveLength(20);
    expect(turns[20]).toBe(429);
  });

  it('downloads count GETs against the strict limit (a GET builds a zip)', async () => {
    const proxy = await loadProxy();
    const d = statuses(proxy, 'GET', '/api/download?projectId=p', 6);
    expect(d.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(d[5]).toBe(429);
  });

  it('git GETs stay on the strict shared limit (they spawn git and create dirs)', async () => {
    const proxy = await loadProxy();
    const reads = statuses(proxy, 'GET', '/api/git/status?projectId=p', 30);
    expect(reads.every((s) => s === 200)).toBe(true);
    expect(proxy(req('GET', '/api/git/log?projectId=p')).status).toBe(429);
    expect(proxy(req('POST', '/api/git/revert')).status).toBe(429);
  });

  it('cross-origin writes are still rejected before rate limiting', async () => {
    const proxy = await loadProxy();
    const res = proxy(req('POST', '/api/projects', { origin: 'http://evil.example' }));
    expect(res.status).toBe(403);
  });
});
