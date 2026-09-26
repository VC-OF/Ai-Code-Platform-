import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  parseRule, parsePermissions, decide, commandMatches, pathGlob, loadPermissionRules, managedSettingsPath,
  type PermissionRule,
} from '@/lib/permissionRules';

const rules = (spec: { allow?: string[]; deny?: string[]; ask?: string[] }, source = '.claude/settings.json', managed = false) =>
  parsePermissions(spec, source, managed);

describe('parseRule', () => {
  it('splits tool and specifier', () => {
    expect(parseRule('Bash')).toEqual({ tool: 'Bash', specifier: undefined });
    expect(parseRule('Bash(npm test:*)')).toEqual({ tool: 'Bash', specifier: 'npm test:*' });
    expect(parseRule('mcp_github_*')).toEqual({ tool: 'mcp_github_*', specifier: undefined });
    expect(parseRule('Bash()')).toEqual({ tool: 'Bash', specifier: undefined });
    expect(parseRule('not a rule')).toBeNull();
  });

  it('reports invalid entries', () => {
    const errors: string[] = [];
    const out = parsePermissions({ allow: ['Read', 42, '(bad'], deny: 'Bash' }, 's.json', false, errors);
    expect(out.map((r) => r.rule)).toEqual(['Read']);
    expect(errors).toHaveLength(3);
  });
});

describe('commandMatches', () => {
  it('handles :* prefixes at a word boundary', () => {
    expect(commandMatches('npm test:*', 'npm test')).toBe(true);
    expect(commandMatches('npm test:*', 'npm test -- --watch')).toBe(true);
    expect(commandMatches('npm test:*', 'npm testing')).toBe(false);
    expect(commandMatches('rm:*', 'rm -rf dist')).toBe(true);
    expect(commandMatches('rm:*', 'rmdir x')).toBe(false);
  });

  it('handles * globs and exact matches', () => {
    expect(commandMatches('cargo *', 'cargo build --release')).toBe(true);
    expect(commandMatches('cargo *', 'cargox build')).toBe(false);
    expect(commandMatches('git * main', 'git push origin main')).toBe(true);
    expect(commandMatches('npm run build', 'npm  run   build')).toBe(true);
    expect(commandMatches('npm run build', 'npm run build:prod')).toBe(false);
  });
});

describe('pathGlob', () => {
  it('matches ** across directories and * within one', () => {
    expect(pathGlob('src/**', 'src/a/b.ts')).toBe(true);
    expect(pathGlob('src/*.ts', 'src/a.ts')).toBe(true);
    expect(pathGlob('src/*.ts', 'src/a/b.ts')).toBe(false);
    expect(pathGlob('src/**/*.ts', 'src/a.ts')).toBe(true);
    expect(pathGlob('src/**/*.ts', 'src/x/y/a.ts')).toBe(true);
  });

  it('normalizes backslashes, ./ and workspace-absolute paths', () => {
    expect(pathGlob('src/**', 'src\\lib\\a.ts')).toBe(true);
    expect(pathGlob('./.env', '.env')).toBe(true);
    expect(pathGlob('/secrets/**', 'secrets/k.pem')).toBe(true);
    expect(pathGlob('secrets/**', 'C:\\ws\\proj\\secrets\\k.pem', 'C:\\ws\\proj')).toBe(true);
    expect(pathGlob('secrets/**', '/home/u/ws/secrets/k.pem', '/home/u/ws/')).toBe(true);
  });

  it('lets slash-less patterns match a basename and directories cover their contents', () => {
    expect(pathGlob('.env', 'config/.env')).toBe(true);
    expect(pathGlob('*.pem', 'a/b/key.pem')).toBe(true);
    expect(pathGlob('dist', 'dist/bundle.js')).toBe(true);
    expect(pathGlob('.env', '.env.example')).toBe(false);
  });
});

describe('decide', () => {
  it('maps Claude Code tool names', () => {
    const r = rules({ deny: ['Edit(secrets/**)', 'Write', 'Read(.env)', 'WebFetch(domain:evil.com)', 'Bash(rm:*)'] });
    expect(decide(r, 'edit_file', { path: 'secrets/a' }).decision).toBe('deny');
    expect(decide(r, 'replace_lines', { path: 'secrets/a' }).decision).toBe('deny');
    expect(decide(r, 'append_file', { path: 'secrets/a' }).decision).toBe('deny');
    expect(decide(r, 'notebook_edit', { path: 'secrets/n.ipynb' }).decision).toBe('deny');
    expect(decide(r, 'edit_file', { path: 'src/a' }).decision).toBe('default');
    expect(decide(r, 'create_file', { path: 'anything' }).decision).toBe('deny');
    expect(decide(r, 'read_file', { path: '.env' }).decision).toBe('deny');
    expect(decide(r, 'read_file', { path: 'README.md' }).decision).toBe('default');
    expect(decide(r, 'fetch_url', { url: 'https://api.evil.com/x' }).decision).toBe('deny');
    expect(decide(r, 'fetch_url', { url: 'https://notevil.com/x' }).decision).toBe('default');
    expect(decide(r, 'run_command', { command: 'rm -rf /' }).decision).toBe('deny');
    expect(decide(r, 'run_command', { command: 'ls' }).decision).toBe('default');
  });

  it('matches native tool names, globs and specifiers', () => {
    const r = rules({ allow: ['execute_code', 'run_command(cargo *)', 'mcp_github_*'], ask: ['mcp_server_tool'] });
    expect(decide(r, 'execute_code', { code: 'x' }).decision).toBe('allow');
    expect(decide(r, 'run_command', { command: 'cargo test' }).decision).toBe('allow');
    expect(decide(r, 'run_command', { command: 'npm test' }).decision).toBe('default');
    expect(decide(r, 'mcp_github_create_issue', {}).decision).toBe('allow');
    expect(decide(r, 'mcp_server_tool', {}).decision).toBe('ask');
    expect(decide(r, 'mcp_server_tool2', {}).decision).toBe('default');
  });

  it('applies deny > ask > allow regardless of order', () => {
    const r = rules({ allow: ['Bash'], ask: ['Bash(git push:*)'], deny: ['Bash(git push --force:*)'] });
    expect(decide(r, 'run_command', { command: 'npm test' }).decision).toBe('allow');
    expect(decide(r, 'run_command', { command: 'git push origin' }).decision).toBe('ask');
    const d = decide(r, 'run_command', { command: 'git push --force origin' });
    expect(d.decision).toBe('deny');
    expect(d.rule?.rule).toBe('Bash(git push --force:*)');
  });

  it('never lets workspace rules relax a managed deny', () => {
    const r: PermissionRule[] = [
      ...rules({ allow: ['Bash(curl:*)'] }),
      ...rules({ deny: ['Bash(curl:*)'] }, '/etc/open-code/managed-settings.json', true),
      ...rules({ deny: ['Bash'] }, '.claude/settings.local.json'),
    ];
    const d = decide(r, 'run_command', { command: 'curl x' });
    expect(d.decision).toBe('deny');
    expect(d.rule?.managed).toBe(true);
  });
});

describe('loadPermissionRules', () => {
  let dir = '';
  afterEach(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }); });

  it('reads the workspace files and the managed file', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'perm-'));
    const ws = path.join(dir, 'ws');
    await fs.mkdir(path.join(ws, '.claude'), { recursive: true });
    await fs.mkdir(path.join(ws, '.opencode'), { recursive: true });
    await fs.writeFile(path.join(ws, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] } }));
    await fs.writeFile(path.join(ws, '.claude', 'settings.local.json'), '{ not json');
    await fs.writeFile(path.join(ws, '.opencode', 'settings.json'), JSON.stringify({ hooks: {} }));
    const managed = path.join(dir, 'managed.json');
    await fs.writeFile(managed, JSON.stringify({ permissions: { deny: ['Bash(npm test:*)'] } }));

    const loaded = await loadPermissionRules(ws, managed);
    expect(loaded.files).toEqual([managed, '.claude/settings.json', '.claude/settings.local.json', '.opencode/settings.json']);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.rules.map((r) => [r.behavior, r.managed])).toEqual([['deny', true], ['allow', false]]);
    expect(decide(loaded, 'run_command', { command: 'npm test' }).decision).toBe('deny');
  });

  it('treats missing files as no rules and honours OPEN_CODE_MANAGED_SETTINGS', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'perm-'));
    const loaded = await loadPermissionRules(dir, path.join(dir, 'nope.json'));
    expect(loaded).toEqual({ rules: [], files: [], errors: [] });
    const prev = process.env.OPEN_CODE_MANAGED_SETTINGS;
    process.env.OPEN_CODE_MANAGED_SETTINGS = '/x/managed.json';
    try { expect(managedSettingsPath()).toBe('/x/managed.json'); }
    finally { if (prev === undefined) delete process.env.OPEN_CODE_MANAGED_SETTINGS; else process.env.OPEN_CODE_MANAGED_SETTINGS = prev; }
  });
});
