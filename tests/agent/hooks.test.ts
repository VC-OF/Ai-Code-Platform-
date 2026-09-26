import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import {
  parseHooks,
  loadHooks,
  matchesHook,
  hooksFor,
  runHooks,
  summarizeHookResults,
  EMPTY_HOOKS,
} from '@/lib/hooks';

// A hook that reads the Claude Code-style JSON payload from stdin and vetoes
// delete_file with exit 2 (stderr = feedback); everything else passes.
const GUARD_JS = `let d = '';
process.stdin.on('data', (c) => { d += c; });
process.stdin.on('end', () => {
  const p = JSON.parse(d);
  if (p.tool_name === 'delete_file') { console.error('deletes are not allowed: ' + JSON.stringify(p.tool_input)); process.exit(2); }
  console.log('ok ' + p.hook_event_name + ' env=' + process.env.OC_TOOL_NAME);
});
`;

const SETTINGS = {
  hooks: {
    PreToolUse: [
      { matcher: 'delete_file|edit_file', hooks: [{ type: 'command', command: 'node guard.js', timeout: 30 }] },
    ],
    PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node guard.js' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'node guard.js' }] }],
  },
};

describe('hooks: parsing and matching', () => {
  it('flattens the Claude Code settings shape', () => {
    const groups = parseHooks(SETTINGS.hooks, '.claude/settings.json');
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({
      event: 'PreToolUse',
      matcher: 'delete_file|edit_file',
      source: '.claude/settings.json',
    });
    expect(groups[0].commands).toEqual([{ command: 'node guard.js', timeoutMs: 30_000 }]);
    expect(groups[2].matcher).toBeUndefined();
  });

  it('ignores malformed entries instead of throwing', () => {
    expect(parseHooks(null)).toEqual([]);
    expect(parseHooks({ PreToolUse: 'nope' })).toEqual([]);
    const groups = parseHooks({ PreToolUse: [{ hooks: [{ type: 'prompt', command: 'x' }, { command: '' }, 42] }] });
    expect(groups[0].commands).toEqual([]);
  });

  it('matches whole tool names, "*" and empty matchers', () => {
    expect(matchesHook(undefined, 'edit_file')).toBe(true);
    expect(matchesHook('*', 'edit_file')).toBe(true);
    expect(matchesHook('edit_file|create_file', 'create_file')).toBe(true);
    expect(matchesHook('edit', 'edit_file')).toBe(false); // anchored
    expect(matchesHook('edit_.*', 'edit_file')).toBe(true);
    expect(matchesHook('(', '(')).toBe(true); // invalid regex → exact match
    expect(matchesHook('edit_file', undefined)).toBe(false);
  });

  it('selects groups per event and tool', () => {
    const config = { ...EMPTY_HOOKS, hooks: parseHooks(SETTINGS.hooks, 's') };
    expect(hooksFor(config, 'PreToolUse', 'delete_file')).toHaveLength(1);
    expect(hooksFor(config, 'PreToolUse', 'read_file')).toHaveLength(0);
    expect(hooksFor(config, 'PostToolUse', 'read_file')).toHaveLength(1);
    expect(hooksFor(config, 'Stop')).toHaveLength(1);
    expect(hooksFor(config, 'UserPromptSubmit')).toHaveLength(0);
  });
});

describe('hooks: loading and running in a workspace', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({
      '.claude/settings.json': JSON.stringify(SETTINGS),
      '.claude/settings.local.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node guard.js' }] }] } }),
      '.opencode/settings.json': '{ not json',
      'guard.js': GUARD_JS,
    });
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('loads every settings file and reports parse errors', async () => {
    const config = await loadHooks(ws.root);
    expect(config.files).toEqual(['.claude/settings.json', '.claude/settings.local.json', '.opencode/settings.json']);
    expect(config.hooks).toHaveLength(4);
    expect(config.errors).toHaveLength(1);
    expect(config.errors[0]).toMatch(/\.opencode\/settings\.json/);
  });

  it('returns an empty config for a workspace without hooks', async () => {
    const empty = await createWorkspace({ 'a.txt': 'x' });
    try {
      expect(await loadHooks(empty.root)).toEqual(EMPTY_HOOKS);
    } finally {
      await empty.cleanup();
    }
  });

  it('feeds the payload on stdin and env, and blocks on exit 2', async () => {
    const config = await loadHooks(ws.root);
    const base = { projectId: 'p1', workspace: ws.root };

    const blocked = await runHooks(config, { ...base, event: 'PreToolUse', toolName: 'delete_file', toolInput: { path: 'x.ts' } });
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ exitCode: 2, blocked: true, timedOut: false });
    expect(blocked[0].feedback).toContain('deletes are not allowed');
    expect(blocked[0].feedback).toContain('"path":"x.ts"');
    expect(summarizeHookResults(blocked)).toMatchObject({ blocked: true });
    expect(summarizeHookResults(blocked).reason).toContain('deletes are not allowed');

    const allowed = await runHooks(config, { ...base, event: 'PreToolUse', toolName: 'edit_file', toolInput: { path: 'x.ts' } });
    expect(allowed[0]).toMatchObject({ exitCode: 0, blocked: false });
    expect(allowed[0].feedback).toBe('ok PreToolUse env=edit_file');
    expect(summarizeHookResults(allowed)).toEqual({ blocked: false, reason: '', notes: [] });

    // No matching group → nothing runs
    expect(await runHooks(config, { ...base, event: 'PreToolUse', toolName: 'read_file' })).toEqual([]);
  }, 30_000);

  it('reports commands the sandbox refuses without blocking', async () => {
    const config = { ...EMPTY_HOOKS, hooks: parseHooks({ Stop: [{ hooks: [{ command: 'rm -rf /' }] }] }, 's') };
    const results = await runHooks(config, { event: 'Stop', projectId: 'p1', workspace: ws.root });
    expect(results[0].blocked).toBe(false);
    expect(results[0].error).toMatch(/not in the allowed list/);
    const summary = summarizeHookResults(results);
    expect(summary.blocked).toBe(false);
    expect(summary.notes[0]).toMatch(/could not run/);
  });
});
