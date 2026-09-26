import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  parseArgs,
  formatEvent,
  exitCodeFor,
  createResultCollector,
  resolveProject,
  main,
} from '../../bin/open-code.mjs';

describe('parseArgs', () => {
  it('parses a run with every option', () => {
    const o = parseArgs(['-p', 'fix it', '--project', 'demo', '--model', 'm1', '--mode', 'plan', '--output-format', 'json']);
    expect(o).toMatchObject({ command: 'run', prompt: 'fix it', project: 'demo', model: 'm1', mode: 'plan', outputFormat: 'json' });
  });

  it('supports --flag=value, --new, --continue and the server env default', () => {
    expect(parseArgs(['--prompt=hi', '--new', 'App'], { OPEN_CODE_URL: 'http://x:9' })).toMatchObject({
      prompt: 'hi', newProject: 'App', server: 'http://x:9',
    });
    expect(parseArgs(['-p', 'x', '--continue']).continue).toBe(true);
    expect(parseArgs(['-p', 'x', '--server', 'https://h']).server).toBe('https://h');
  });

  it('parses the projects and status subcommands', () => {
    expect(parseArgs(['projects']).command).toBe('projects');
    expect(parseArgs(['status', 'abc'])).toMatchObject({ command: 'status', project: 'abc' });
    expect(() => parseArgs(['status'])).toThrow(/needs a project/);
  });

  it('treats a bare positional as the prompt', () => {
    expect(parseArgs(['add', 'tests']).prompt).toBe('add tests');
  });

  it('rejects bad values', () => {
    expect(() => parseArgs(['-p', 'x', '--mode', 'yolo'])).toThrow(/--mode/);
    expect(() => parseArgs(['-p', 'x', '--output-format', 'xml'])).toThrow(/--output-format/);
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--model'])).toThrow(/requires a value/);
    expect(() => parseArgs(['-p', 'x', '--project', 'a', '--new', 'b'])).toThrow(/only one/);
    expect(() => parseArgs(['-p', 'x', '--server', 'ftp://h'])).toThrow(/Invalid --server/);
  });
});

describe('formatEvent / exit codes / collector', () => {
  it('prints text deltas to stdout and tool lines to stderr', () => {
    expect(formatEvent({ type: 'text_delta', delta: 'Hello' })).toEqual({ stdout: 'Hello' });
    expect(formatEvent({ type: 'tool_start', toolName: 'read_file', args: { path: 'src/a.ts' } }).stderr).toBe('> read_file src/a.ts\n');
    expect(formatEvent({ type: 'tool_end', result: { success: false, summary: 'boom' } }).stderr).toContain('failed: boom');
    expect(formatEvent({ type: 'done', reason: 'completed', filesChanged: ['a'], totalTokens: 5, durationMs: 2000 }).stderr)
      .toContain('done: completed, 1 files changed, 5 tokens, 2s');
    expect(formatEvent({ type: 'status', status: 'reading' })).toEqual({});
  });

  it('maps done reasons to exit codes', () => {
    expect(exitCodeFor('completed')).toBe(0);
    expect(exitCodeFor('error')).toBe(1);
    expect(exitCodeFor('user_cancelled')).toBe(1);
    expect(exitCodeFor(undefined)).toBe(1);
    expect(exitCodeFor('max_steps')).toBe(2);
    expect(exitCodeFor('timeout')).toBe(2);
  });

  it('collects the final json result', () => {
    const c = createResultCollector();
    c.push({ type: 'text_delta', delta: 'Hi ' });
    c.push({ type: 'text_delta', delta: 'there' });
    c.push({ type: 'done', reason: 'completed', filesChanged: ['x.ts'], totalTokens: 42, durationMs: 10 });
    expect(c.result(99)).toEqual({ result: 'Hi there', reason: 'completed', filesChanged: ['x.ts'], tokens: 42, durationMs: 10 });
  });

  it('resolves projects by id, title or unique substring', () => {
    const ps = [{ id: 'p1', title: 'Todo App' }, { id: 'p2', title: 'Todo API' }, { id: 'p3', title: 'Blog' }];
    expect(resolveProject('p3', ps).id).toBe('p3');
    expect(resolveProject('todo app', ps).id).toBe('p1');
    expect(resolveProject('blo', ps).id).toBe('p3');
    expect(() => resolveProject('todo', ps)).toThrow(/several/);
    expect(() => resolveProject('zzz', ps)).toThrow(/No project/);
  });
});

// ─── Integration: mock platform server emitting canned NDJSON ────────────────

interface Captured { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }

function sink() {
  let data = '';
  return { write: (s: string) => { data += s; return true; }, get text() { return data; } };
}

describe('CLI against a mock server', () => {
  let server: http.Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function start(events: object[]): Promise<{ url: string; requests: Captured[] }> {
    const requests: Captured[] = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        requests.push({ method: req.method!, url: req.url!, headers: req.headers, body });
        if (req.url === '/api/projects' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ projects: [{ id: 'proj1', title: 'Demo', updatedAt: 1 }] }));
        } else if (req.url === '/api/chat' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/x-ndjson');
          for (const e of events) res.write(JSON.stringify(e) + '\n');
          res.end();
        } else if (req.url === '/api/chat/input') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ delivered: true }));
        } else {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}`, requests };
  }

  const canned = [
    { type: 'message', role: 'user', content: 'do it' },
    { type: 'status', status: 'reading' },
    { type: 'tool_start', toolName: 'read_file', toolCallId: 't1', args: { path: 'README.md' } },
    { type: 'tool_end', toolName: 'read_file', toolCallId: 't1', result: { success: true, summary: 'Read README.md (3 lines)' } },
    { type: 'text_delta', delta: 'All ' },
    { type: 'text_delta', delta: 'done.' },
    { type: 'done', reason: 'completed', filesChanged: ['README.md'], totalTokens: 1234, durationMs: 50 },
  ];

  it('streams a run in text mode, sends auth + origin, exits 0', async () => {
    const { url, requests } = await start(canned);
    const stdout = sink();
    const stderr = sink();
    const code = await main(['-p', 'do it', '--project', 'demo', '--server', url], {
      env: { AUTH_TOKEN: 'secret' }, stdout, stderr, interactive: false,
    });
    expect(code).toBe(0);
    expect(stdout.text).toBe('All done.');
    expect(stderr.text).toContain('> read_file README.md');
    const chat = requests.find((r) => r.url === '/api/chat')!;
    expect(chat.headers['x-api-key']).toBe('secret');
    expect(chat.headers.origin).toBe(url);
    expect(JSON.parse(chat.body)).toMatchObject({ projectId: 'proj1', mode: 'auto', messages: [{ role: 'user', content: 'do it' }] });
  });

  it('prints one JSON result and exits 2 on max_steps', async () => {
    const events = [...canned.slice(0, -1), { type: 'done', reason: 'max_steps', filesChanged: [], totalTokens: 7, durationMs: 9 }];
    const { url } = await start(events);
    const stdout = sink();
    const code = await main(['-p', 'x', '--continue', '--output-format', 'json', '--server', url], {
      env: {}, stdout, stderr: sink(), interactive: false,
    });
    expect(code).toBe(2);
    expect(JSON.parse(stdout.text)).toEqual({ result: 'All done.', reason: 'max_steps', filesChanged: [], tokens: 7, durationMs: 9 });
  });

  it('passes events through in stream-json mode', async () => {
    const { url } = await start(canned);
    const stdout = sink();
    await main(['-p', 'x', '--project', 'proj1', '--output-format', 'stream-json', '--server', url], {
      env: {}, stdout, stderr: sink(), interactive: false,
    });
    const lines = stdout.text.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(canned.map((e) => e.type));
  });

  it('fails clearly on ask_user when not interactive, answers it when interactive', async () => {
    const events = [
      { type: 'user_input_request', question: 'Which DB?', options: ['sqlite', 'pg'] },
      { type: 'text_delta', delta: 'ok' },
      { type: 'done', reason: 'completed', filesChanged: [], totalTokens: 1, durationMs: 1 },
    ];
    let { url, requests } = await start(events);
    const stderr = sink();
    expect(await main(['-p', 'x', '--project', 'demo', '--server', url], { env: {}, stdout: sink(), stderr, interactive: false })).toBe(1);
    expect(stderr.text).toMatch(/not interactive: Which DB\?/);
    await new Promise<void>((r) => server!.close(() => r()));

    ({ url, requests } = await start(events));
    const code = await main(['-p', 'x', '--project', 'demo', '--server', url], {
      env: {}, stdout: sink(), stderr: sink(), interactive: true, ask: async () => 'sqlite',
    });
    expect(code).toBe(0);
    expect(JSON.parse(requests.find((r) => r.url === '/api/chat/input')!.body)).toEqual({ projectId: 'proj1', answer: 'sqlite' });
  });

  it('lists projects', async () => {
    const { url } = await start([]);
    const stdout = sink();
    expect(await main(['projects', '--server', url], { env: {}, stdout, stderr: sink() })).toBe(0);
    expect(stdout.text).toBe('proj1\tDemo\n');
  });

  it('reports an unreachable server', async () => {
    const stderr = sink();
    expect(await main(['projects', '--server', 'http://127.0.0.1:1'], { env: {}, stdout: sink(), stderr })).toBe(1);
    expect(stderr.text).toMatch(/Cannot reach Open Code/);
  });
});
