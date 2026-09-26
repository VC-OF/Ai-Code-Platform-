import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  demangleName,
  mangleName,
  getMcpToolSchemas,
  callMcpTool,
  executeMcpResourceTool,
  getMcpPrompt,
  getMcpStatus,
  listMcpPrompts,
} from '@/lib/mcpClient';

describe('mcpClient', () => {
  describe('name mangling', () => {
    it('round-trips server and tool names', () => {
      const mangled = mangleName('mock', 'read_thing');
      expect(mangled).toBe('mcp_mock_read_thing');
      expect(demangleName(mangled)).toEqual({ server: 'mock', tool: 'read_thing' });
    });

    it('rejects non-MCP names', () => {
      expect(demangleName('read_file')).toBeNull();
      expect(demangleName('mcp_')).toBeNull();
    });
  });

  describe('stdio integration (mock server)', () => {
    let configFile: string;

    beforeAll(async () => {
      const serverScript = path.resolve(process.cwd(), 'tests/helpers/mockMcpServer.cjs');
      configFile = path.join(os.tmpdir(), `mcp-test-${Date.now()}.json`);
      await fs.writeFile(
        configFile,
        JSON.stringify({
          servers: {
            mock: { command: 'node', args: [serverScript] },
          },
        })
      );
      process.env.MCP_CONFIG_PATH = configFile;
    });

    afterAll(async () => {
      delete process.env.MCP_CONFIG_PATH;
      await fs.rm(configFile, { force: true });
    });

    it('discovers tools from a configured server', async () => {
      const schemas = await getMcpToolSchemas();
      const names = schemas.map(
        (s) => (s as { function: { name: string } }).function.name
      );
      expect(names).toContain('mcp_mock_echo');
    }, 15_000);

    it('calls a tool and returns its text content', async () => {
      const result = await callMcpTool('mcp_mock_echo', { text: 'hello mcp' });
      expect(result).toBe('echo: hello mcp');
    }, 15_000);

    it('adds the resource tools when a server advertises resources', async () => {
      const schemas = await getMcpToolSchemas();
      const names = schemas.map((s) => (s as { function: { name: string } }).function.name);
      expect(names).toContain('mcp_list_resources');
      expect(names).toContain('mcp_read_resource');
      expect(demangleName('mcp_list_resources')).toBeNull();
    }, 15_000);

    it('lists and reads resources', async () => {
      const listing = await executeMcpResourceTool('mcp_list_resources', {});
      expect(listing).toContain('[mock] mock://readme — Readme (text/plain)');
      const body = await executeMcpResourceTool('mcp_read_resource', { server: 'mock', uri: 'mock://readme' });
      expect(body).toBe('mock readme body');
    }, 15_000);

    it('lists prompts and flattens prompts/get to text', async () => {
      const prompts = await listMcpPrompts();
      expect(prompts.map((p) => p.name)).toEqual(['greet']);
      expect(prompts[0].arguments.map((a) => a.name)).toEqual(['name', 'style']);
      expect(await getMcpPrompt('mock', 'greet', { name: 'Ada' })).toBe('Say hello to Ada');
    }, 15_000);

    it('reports transport, target and counts in status', async () => {
      const [status] = await getMcpStatus();
      expect(status).toMatchObject({
        server: 'mock', type: 'stdio', target: 'node', source: 'platform',
        connected: true, resources: 1,
      });
      expect(status.prompts).toHaveLength(1);
    }, 15_000);
  });
});
