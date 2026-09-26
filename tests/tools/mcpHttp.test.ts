import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  callMcpTool,
  executeMcpResourceTool,
  getMcpPrompt,
  getMcpStatus,
  getMcpToolSchemas,
  listMcpPrompts,
  loadMcpConfig,
  redactUrl,
  substituteEnv,
} from '@/lib/mcpClient';
import { mapMcpPromptArgs, mcpPromptDefinitions } from '@/lib/slashCommands';
import { startMockHttpServer, type MockHttpServer } from '../helpers/mockMcpHttpServer';

describe('mcp config helpers', () => {
  it('substitutes ${VAR} and ${VAR:-default}', () => {
    expect(substituteEnv('Bearer ${TOK}', { TOK: 'abc' })).toBe('Bearer abc');
    expect(substituteEnv('${MISSING:-fallback}/x', {})).toBe('fallback/x');
    expect(substituteEnv('${MISSING}', {})).toBe('');
  });

  it('redacts credentials and query strings from urls', () => {
    expect(redactUrl('https://user:pw@example.com/mcp?key=secret#x')).toBe('https://example.com/mcp');
  });

  it('maps positional slash args onto declared prompt arguments', () => {
    const declared = [{ name: 'file', required: true }, { name: 'focus' }];
    expect(mapMcpPromptArgs(declared, '"src/a b.ts" security and perf')).toEqual({
      values: { file: 'src/a b.ts', focus: 'security and perf' },
      missing: [],
    });
    expect(mapMcpPromptArgs(declared, '').missing).toEqual(['file']);
  });

  it('builds /mcp__<server>__<prompt> commands', () => {
    const [cmd] = mcpPromptDefinitions([
      { server: 'gh', prompts: [{ name: 'review', arguments: [{ name: 'pr', required: true }] }, { name: 'bad name' }] },
    ]);
    expect(cmd).toMatchObject({ name: 'mcp__gh__review', args: '<pr>', argsRequired: true, kind: 'prompt' });
    expect(cmd.mcpPrompt).toEqual({ server: 'gh', name: 'review', arguments: [{ name: 'pr', required: true }] });
  });
});

describe('mcp http transports (in-process mock)', () => {
  let jsonServer: MockHttpServer;
  let sseReplyServer: MockHttpServer;
  let legacyServer: MockHttpServer;
  let configFile: string;
  let workspace: string;

  beforeAll(async () => {
    jsonServer = await startMockHttpServer('json');
    sseReplyServer = await startMockHttpServer('sse');
    legacyServer = await startMockHttpServer('json');
    process.env.MOCK_MCP_TOKEN = 'tok-123';
    configFile = path.join(os.tmpdir(), `mcp-http-test-${Date.now()}.json`);
    await fs.writeFile(configFile, JSON.stringify({
      servers: {
        httpjson: {
          type: 'http',
          url: `${jsonServer.url}/mcp?key=\${MOCK_MCP_TOKEN}`,
          headers: { Authorization: 'Bearer ${MOCK_MCP_TOKEN}' },
        },
        legacy: { type: 'sse', url: `${legacyServer.url}/sse` },
      },
    }));
    process.env.MCP_CONFIG_PATH = configFile;
    // The project's Claude Code .mcp.json adds a server on top
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-ws-'));
    await fs.writeFile(path.join(workspace, '.mcp.json'), JSON.stringify({
      mcpServers: { httpsse: { type: 'http', url: `${sseReplyServer.url}/mcp` } },
    }));
  });

  afterAll(async () => {
    delete process.env.MCP_CONFIG_PATH;
    delete process.env.MOCK_MCP_TOKEN;
    await fs.rm(configFile, { force: true });
    await fs.rm(workspace, { recursive: true, force: true });
    await Promise.all([jsonServer.close(), sseReplyServer.close(), legacyServer.close()]);
  });

  it('merges the workspace .mcp.json with the platform config', async () => {
    expect(Object.keys(await loadMcpConfig())).toEqual(['httpjson', 'legacy']);
    expect(Object.keys(await loadMcpConfig(workspace)).sort()).toEqual(['httpjson', 'httpsse', 'legacy']);
  });

  it('discovers tools on every transport', async () => {
    const names = (await getMcpToolSchemas(workspace)).map(
      (s) => (s as { function: { name: string } }).function.name
    );
    expect(names).toEqual(expect.arrayContaining([
      'mcp_httpjson_echo', 'mcp_httpsse_echo', 'mcp_legacy_echo', 'mcp_list_resources', 'mcp_read_resource',
    ]));
  }, 15_000);

  it('Streamable HTTP (JSON replies): session id, protocol header, env headers', async () => {
    expect(await callMcpTool('mcp_httpjson_echo', { text: 'hi' }, workspace)).toBe('http echo: hi');
    const posts = jsonServer.requests.filter((r) => r.method === 'POST');
    const init = posts.find((r) => r.body?.method === 'initialize')!;
    expect(init.headers.authorization).toBe('Bearer tok-123');
    expect(init.headers.accept).toContain('text/event-stream');
    expect(init.headers['mcp-session-id']).toBeUndefined();
    const call = posts.find((r) => r.body?.method === 'tools/call')!;
    expect(call.headers['mcp-session-id']).toMatch(/^sess-/);
    expect(call.headers['mcp-protocol-version']).toBe('2025-03-26');
    expect(posts.some((r) => r.body?.method === 'notifications/initialized')).toBe(true);
  }, 15_000);

  it('Streamable HTTP (SSE replies)', async () => {
    expect(await callMcpTool('mcp_httpsse_echo', { text: 'streamed' }, workspace)).toBe('http echo: streamed');
    expect(await getMcpPrompt('httpsse', 'review', { file: 'a.ts' }, workspace)).toBe('Review a.ts\n\n[assistant]\nSure.');
  }, 15_000);

  it('legacy SSE transport', async () => {
    expect(await callMcpTool('mcp_legacy_echo', { text: 'old' }, workspace)).toBe('http echo: old');
    expect(legacyServer.requests.some((r) => r.method === 'GET' && r.path === '/sse')).toBe(true);
    expect(await executeMcpResourceTool('mcp_read_resource', { server: 'legacy', uri: 'mem://doc' }, workspace))
      .toBe('# remote doc');
  }, 15_000);

  it('lists resources and prompts across servers', async () => {
    const listing = await executeMcpResourceTool('mcp_list_resources', { server: 'httpjson' }, workspace);
    expect(listing).toBe('- [httpjson] mem://doc — Doc (text/markdown)');
    const prompts = await listMcpPrompts(workspace);
    expect(prompts.map((p) => `${p.server}/${p.name}`).sort()).toEqual(['httpjson/review', 'httpsse/review', 'legacy/review']);
  }, 15_000);

  it('status shows transport, redacted url and counts', async () => {
    const status = await getMcpStatus(workspace);
    const byName = Object.fromEntries(status.map((s) => [s.server, s]));
    expect(byName.httpjson).toMatchObject({
      type: 'http', target: `${jsonServer.url}/mcp`, source: 'platform', connected: true, resources: 1,
    });
    expect(JSON.stringify(status)).not.toContain('tok-123');
    expect(byName.legacy).toMatchObject({ type: 'sse', connected: true });
    expect(byName.httpsse).toMatchObject({ source: 'project', connected: true });
    expect(byName.httpsse.prompts[0]).toMatchObject({ name: 'review' });
  }, 15_000);
});
