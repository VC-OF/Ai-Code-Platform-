import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  installPlugin,
  listPlugins,
  removePlugin,
  isHttpsGitUrl,
  isValidPluginName,
  pluginNameFromSource,
} from '@/lib/plugins';
import { loadSkills } from '@/lib/skills';
import { loadCustomCommands } from '@/lib/customCommands';
import { loadMcpConfig } from '@/lib/mcpClient';
import { parsePluginArgs, parseScheduleArgs, findSlashCommand } from '@/lib/slashCommands';

let tmp: string;
let pluginsDir: string;
let src: string;
const prevEnv = { plugins: process.env.OPEN_CODE_PLUGINS_DIR, mcp: process.env.MCP_CONFIG_PATH };

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-plugins-'));
  pluginsDir = path.join(tmp, 'installed');
  process.env.OPEN_CODE_PLUGINS_DIR = pluginsDir;
  process.env.MCP_CONFIG_PATH = path.join(tmp, 'no-mcp.json');
  src = path.join(tmp, 'My-Plugin');
  await write(path.join(src, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'my-plugin', description: 'Demo', version: '1.2.0' }));
  await write(path.join(src, 'skills', 'lint', 'SKILL.md'), '---\nname: lint\ndescription: Lint things\n---\nRun the linter.');
  await write(path.join(src, 'commands', 'deploy.md'), '---\ndescription: Deploy it\n---\nDeploy $ARGUMENTS');
  await write(path.join(src, 'agents', 'reviewer.md'), 'You review.');
  await write(path.join(src, '.mcp.json'), JSON.stringify({ mcpServers: { files: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'] }, remote: { url: 'https://x' } } }));
  await write(path.join(src, 'hooks', 'hooks.json'), '{}');
  await write(path.join(src, '.git', 'HEAD'), 'ref');
});

afterEach(async () => {
  if (prevEnv.plugins === undefined) delete process.env.OPEN_CODE_PLUGINS_DIR;
  else process.env.OPEN_CODE_PLUGINS_DIR = prevEnv.plugins;
  if (prevEnv.mcp === undefined) delete process.env.MCP_CONFIG_PATH;
  else process.env.MCP_CONFIG_PATH = prevEnv.mcp;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('plugin validation helpers', () => {
  it('validates names and sources', () => {
    expect(isValidPluginName('my-plugin_2')).toBe(true);
    for (const bad of ['', '..', '-x', 'a/b', 'a b', 'x'.repeat(65)]) expect(isValidPluginName(bad), bad).toBe(false);
    expect(isHttpsGitUrl('https://github.com/acme/plugin.git')).toBe(true);
    for (const bad of ['http://github.com/a/b', 'git@github.com:a/b.git', 'file:///etc', 'https://h/a/../b', 'https://h/a b']) {
      expect(isHttpsGitUrl(bad), bad).toBe(false);
    }
    expect(pluginNameFromSource('https://github.com/acme/Cool.Plugin.git')).toBe('cool-plugin');
    expect(pluginNameFromSource('C:\\x\\My-Plugin\\')).toBe('my-plugin');
  });
});

describe('install / list / remove', () => {
  it('copies a local plugin (without .git) and describes it', async () => {
    const info = await installPlugin(src);
    expect(info).toMatchObject({
      name: 'my-plugin', description: 'Demo', version: '1.2.0',
      skills: ['lint'], commands: ['deploy'], agents: ['reviewer'], mcpServers: ['files', 'remote'], hasHooks: true,
    });
    await expect(fs.access(path.join(pluginsDir, 'my-plugin', '.git'))).rejects.toThrow();
    expect((await listPlugins()).map((p) => p.name)).toEqual(['my-plugin']);
    await expect(installPlugin(src)).rejects.toThrow(/already installed/);
    expect(await removePlugin('my-plugin')).toBe(true);
    expect(await removePlugin('my-plugin')).toBe(false);
    expect(await listPlugins()).toEqual([]);
  });

  it('rejects bad sources and names, and folders that are not plugins', async () => {
    await expect(installPlugin('http://github.com/a/b.git')).rejects.toThrow(/Only https/);
    await expect(installPlugin('git@github.com:a/b.git')).rejects.toThrow(/Only https/);
    await expect(installPlugin(path.join(tmp, 'nope'))).rejects.toThrow(/not found/);
    await expect(installPlugin(src, '../evil')).rejects.toThrow(/Invalid plugin name/);
    await expect(removePlugin('../x')).rejects.toThrow(/Invalid/);
    const empty = path.join(tmp, 'empty');
    await write(path.join(empty, 'README.md'), 'hi');
    await expect(installPlugin(empty)).rejects.toThrow(/Not a plugin/);
    await expect(fs.access(path.join(pluginsDir, 'empty'))).rejects.toThrow();
  });

  it('cleans up after a failed clone', async () => {
    await expect(installPlugin('https://127.0.0.1:1/acme/p.git')).rejects.toThrow(/git clone failed/);
    await expect(fs.access(path.join(pluginsDir, 'p'))).rejects.toThrow();
  }, 30_000);
});

describe('loaders read installed plugins', () => {
  it('exposes prefixed skills, commands and MCP servers', async () => {
    await installPlugin(src);
    const workspace = path.join(tmp, 'ws');
    await fs.mkdir(workspace);

    const skills = await loadSkills(workspace, { includeGlobal: false });
    expect(skills.map((s) => s.name)).toContain('my-plugin:lint');
    expect(skills.find((s) => s.name === 'my-plugin:lint')?.source).toBe('plugin:my-plugin/skills/lint/SKILL.md');

    const commands = await loadCustomCommands(workspace);
    expect(commands.find((c) => c.name === 'my-plugin:deploy')).toMatchObject({ description: 'Deploy it', body: 'Deploy $ARGUMENTS' });

    const mcp = await loadMcpConfig();
    expect(Object.keys(mcp)).toEqual(['my-plugin-files']); // url-only server skipped (stdio only)
    expect((mcp['my-plugin-files'] as { args?: string[] }).args?.[0]).toBe(`${path.join(pluginsDir, 'my-plugin')}/server.js`);
  });

  it('explicit MCP config wins over a plugin server of the same name', async () => {
    await installPlugin(src);
    await write(process.env.MCP_CONFIG_PATH!, JSON.stringify({ servers: { 'my-plugin-files': { command: 'mine' } } }));
    expect(((await loadMcpConfig())['my-plugin-files'] as { command?: string }).command).toBe('mine');
  });
});

describe('/plugin and /schedule argument parsing', () => {
  it('parses /plugin', () => {
    expect(parsePluginArgs('')).toEqual({ action: 'list' });
    expect(parsePluginArgs('install https://github.com/a/b.git')).toEqual({ action: 'install', source: 'https://github.com/a/b.git' });
    expect(parsePluginArgs('install "C:\\my plugins\\x" --name foo')).toEqual({ action: 'install', source: 'C:\\my plugins\\x', name: 'foo' });
    expect(parsePluginArgs('remove foo')).toEqual({ action: 'remove', name: 'foo' });
    expect(parsePluginArgs('install').action).toBe('error');
    expect(parsePluginArgs('frobnicate').action).toBe('error');
    expect(findSlashCommand('plugins')?.name).toBe('plugin');
  });

  it('parses /schedule', () => {
    expect(parseScheduleArgs('')).toEqual({ action: 'list' });
    expect(parseScheduleArgs('add "0 9 * * 1-5" run the tests')).toEqual({ action: 'add', cron: '0 9 * * 1-5', prompt: 'run the tests' });
    expect(parseScheduleArgs('add */5 * * * * check deps')).toEqual({ action: 'add', cron: '*/5 * * * *', prompt: 'check deps' });
    expect(parseScheduleArgs('pause ab12')).toEqual({ action: 'pause', id: 'ab12' });
    expect(parseScheduleArgs('resume ab12')).toEqual({ action: 'resume', id: 'ab12' });
    expect(parseScheduleArgs('rm ab12')).toEqual({ action: 'remove', id: 'ab12' });
    expect(parseScheduleArgs('add "0 9 * * *"').action).toBe('error');
    expect(parseScheduleArgs('pause').action).toBe('error');
    expect(findSlashCommand('cron')?.name).toBe('schedule');
  });
});
