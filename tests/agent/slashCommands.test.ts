import { describe, expect, it } from 'vitest';
import {
  SLASH_COMMANDS,
  SLASH_COMMAND_GROUPS,
  buildIssueUrl,
  defaultExportFilename,
  findSlashCommand,
  formatConversationMarkdown,
  formatSlashHelp,
  formatSlashUsage,
  formatUsageReport,
  formatUsd,
  getSlashQuery,
  groupSlashCommands,
  matchModel,
  matchSlashCommands,
  normalizeExportFilename,
  parseSlashCommand,
  resolveCheckpoint,
  resolveProject,
} from '@/lib/slashCommands';
import { MODEL_OPTIONS } from '@/lib/modelOptions';
import { composeSystemPrompt, formatOutputStyleForPrompt } from '@/lib/promptComposer';
import { createHarness } from '@/lib/harness';

describe('slash commands', () => {
  it('parses command names and arguments', () => {
    expect(parseSlashCommand('  /review  focus on security  ')).toEqual({
      name: 'review',
      args: 'focus on security',
      raw: '/review  focus on security',
    });
    expect(parseSlashCommand('/Output-Style concise')?.name).toBe('output-style');
    expect(parseSlashCommand('explain this')).toBeNull();
    expect(parseSlashCommand('/')).toBeNull();
  });

  it('resolves names and aliases', () => {
    expect(findSlashCommand('tests')?.name).toBe('test');
    expect(findSlashCommand('reset')?.name).toBe('clear');
    expect(findSlashCommand('new')?.name).toBe('clear');
    expect(findSlashCommand('settings')?.name).toBe('config');
    expect(findSlashCommand('allowed-tools')?.name).toBe('permissions');
    expect(findSlashCommand('bashes')?.name).toBe('tasks');
    expect(findSlashCommand('quit')?.name).toBe('exit');
    expect(findSlashCommand('checkpoint')?.name).toBe('rewind');
    expect(findSlashCommand('feedback')?.name).toBe('bug');
    expect(findSlashCommand('nope')).toBeUndefined();
    expect(findSlashCommand('tests')?.prompt?.('the auth flow')).toContain('the auth flow');
  });

  it('has unique names and aliases, each in a known group', () => {
    const seen = new Set<string>();
    for (const command of SLASH_COMMANDS) {
      for (const key of [command.name, ...(command.aliases ?? [])]) {
        expect(seen.has(key), `duplicate ${key}`).toBe(false);
        seen.add(key);
      }
      expect(SLASH_COMMAND_GROUPS).toContain(command.group);
      if (command.kind === 'prompt') expect(command.prompt).toBeTypeOf('function');
    }
  });

  it('keeps Claude Code prompt-based commands as prompt kind', () => {
    for (const name of ['init', 'review', 'security-review', 'pr-comments']) {
      expect(findSlashCommand(name)?.kind).toBe('prompt');
    }
    for (const name of ['cost', 'model', 'doctor', 'memory', 'hooks', 'mcp', 'permissions']) {
      expect(findSlashCommand(name)?.kind).toBe('local');
    }
  });

  it('detects the autocomplete query only before the first space', () => {
    expect(getSlashQuery('/')).toBe('');
    expect(getSlashQuery('/Co')).toBe('co');
    expect(getSlashQuery('/compact now')).toBeNull();
    expect(getSlashQuery('hello')).toBeNull();
  });

  it('ranks prefix matches before alias and substring matches', () => {
    const names = matchSlashCommands('co').map((c) => c.name);
    expect(names.slice(0, 5)).toEqual(['copy', 'context', 'compact', 'cost', 'config']);
    // "reset" alias of clear comes after name prefix matches
    const re = matchSlashCommands('re').map((c) => c.name);
    expect(re.indexOf('resume')).toBeLessThan(re.indexOf('clear'));
    // substring in name
    expect(matchSlashCommands('review').map((c) => c.name)).toEqual(
      expect.arrayContaining(['review', 'security-review'])
    );
    expect(matchSlashCommands('review')[0].name).toBe('review');
    expect(matchSlashCommands('')).toHaveLength(SLASH_COMMANDS.length);
    expect(matchSlashCommands('zzzz')).toEqual([]);
  });

  it('groups commands in a stable group order and prints help with args', () => {
    const groups = groupSlashCommands();
    expect(groups.map((g) => g.group)).toEqual(SLASH_COMMAND_GROUPS);
    expect(groups.reduce((n, g) => n + g.commands.length, 0)).toBe(SLASH_COMMANDS.length);

    const help = formatSlashHelp();
    for (const group of SLASH_COMMAND_GROUPS) expect(help).toContain(`**${group}**`);
    expect(help).toContain('`/model [name]`');
    expect(help).toContain('/reset');
    expect(formatSlashUsage(findSlashCommand('add-dir')!)).toBe('/add-dir <path>');
  });

  it('fuzzy-matches models', () => {
    expect(matchModel('gpt-4o', MODEL_OPTIONS).match?.value).toBe('gpt-4o');
    expect(matchModel('deepseek v3', MODEL_OPTIONS).match?.value).toBe('openrouter:deepseek/deepseek-chat');
    expect(matchModel('ultra', MODEL_OPTIONS).match?.value).toBe('nemotron-3-ultra:cloud');
    const ambiguous = matchModel('sonnet', MODEL_OPTIONS);
    expect(ambiguous.match).toBeUndefined();
    expect(ambiguous.candidates.length).toBeGreaterThan(1);
    expect(matchModel('nonexistent', MODEL_OPTIONS).candidates).toEqual([]);
  });

  it('resolves checkpoints by index or hash prefix', () => {
    const list = [{ sha: 'abc12345ff' }, { sha: 'abd99999aa' }];
    expect(resolveCheckpoint('1', list)).toBe(list[0]);
    expect(resolveCheckpoint('2', list)).toBe(list[1]);
    expect(resolveCheckpoint('3', list)).toBeUndefined();
    expect(resolveCheckpoint('abd9', list)).toBe(list[1]);
    expect(resolveCheckpoint('ab', list)).toBeUndefined();
    expect(resolveCheckpoint('abc1; rm', list)).toBeUndefined();
  });

  it('resolves projects by id, title, or unique substring', () => {
    const projects = [
      { id: 'proj_a', title: 'Todo app' },
      { id: 'proj_b', title: 'Todo api' },
      { id: 'proj_c', title: 'Blog' },
    ];
    expect(resolveProject('proj_c', projects)?.title).toBe('Blog');
    expect(resolveProject('todo app', projects)?.id).toBe('proj_a');
    expect(resolveProject('blo', projects)?.id).toBe('proj_c');
    expect(resolveProject('todo', projects)).toBeUndefined();
  });

  it('formats usage reports with totals and cost', () => {
    const report = formatUsageReport(
      [
        { model: 'gpt-4o', requests: 2, prompt_tokens: 1500, completion_tokens: 500, cost_usd: 0.00875 },
        { model: 'llama', requests: 1, prompt_tokens: 100, completion_tokens: 50, cost_usd: 0 },
      ],
      'Demo'
    );
    expect(report).toContain('Token usage for Demo');
    expect(report).toContain('Requests: 3');
    expect(report).toContain('Input tokens: 1,600');
    expect(report).toContain('Output tokens: 550');
    expect(report).toContain('$0.0088');
    expect(formatUsageReport([])).toContain('No model requests');
    expect(formatUsd(12.345)).toBe('$12.35');
  });

  it('builds export markdown and safe filenames', () => {
    const md = formatConversationMarkdown(
      [
        { role: 'user', text: 'Hi' },
        { role: 'assistant', text: 'Hello' },
        { role: 'assistant', text: '   ' },
      ],
      'Demo',
      new Date('2026-01-02T03:04:05Z')
    );
    expect(md).toBe('# Demo\n\nExported 2026-01-02T03:04:05.000Z\n\n## User\n\nHi\n\n## Assistant\n\nHello\n');
    expect(defaultExportFilename('My App!', new Date('2026-09-25T00:00:00Z'))).toBe('my-app-2026-09-25.md');
    expect(normalizeExportFilename('../notes', 'x.md')).toBe('-notes.md');
    expect(normalizeExportFilename('chat.md', 'x.md')).toBe('chat.md');
    expect(normalizeExportFilename('  ', 'x.md')).toBe('x.md');
  });

  it('prefills the GitHub issue title', () => {
    expect(buildIssueUrl('Crash on /model')).toBe(
      'https://github.com/VC-OF/Ai-Code-Platform-/issues/new?title=Crash+on+%2Fmodel'
    );
    expect(buildIssueUrl('')).toBe('https://github.com/VC-OF/Ai-Code-Platform-/issues/new');
  });

  it('adds the output style section to the system prompt', () => {
    expect(formatOutputStyleForPrompt('default')).toBe('');
    const prompt = composeSystemPrompt({
      basePrompt: 'base',
      harness: createHarness('app'),
      outputStyle: 'concise',
    });
    expect(prompt).toContain('## Output Style: Concise');
  });
});
