import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadCustomCommands } from '@/lib/customCommands';
import {
  expandCommandBody,
  customCommandDefinitions,
  parseSlashCommand,
  findSlashCommand,
  getSlashQuery,
  matchSlashCommands,
  SLASH_COMMANDS,
} from '@/lib/slashCommands';

describe('custom slash commands', () => {
  it('loads .claude/commands/*.md with frontmatter and namespaces', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-code-cmds-'));
    await fs.mkdir(path.join(root, '.claude', 'commands', 'db'), { recursive: true });
    await fs.mkdir(path.join(root, '.opencode', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.claude', 'commands', 'derive.md'),
      '---\ndescription: Derive and verify an equation\nargument-hint: <equation>\n---\nDerive $ARGUMENTS step by step, then verify numerically with execute_code.',
    );
    await fs.writeFile(path.join(root, '.claude', 'commands', 'db', 'migrate.md'), 'Write a migration for $1 named $2.');
    await fs.writeFile(path.join(root, '.claude', 'commands', 'bad name.md'), 'ignored');
    await fs.writeFile(path.join(root, '.claude', 'commands', 'empty.md'), '---\ndescription: nothing\n---\n');
    await fs.writeFile(path.join(root, '.opencode', 'commands', 'derive.md'), 'shadowed duplicate');
    await fs.writeFile(path.join(root, '.opencode', 'commands', 'lint-all.md'), 'Run every linter.');

    const commands = await loadCustomCommands(root);
    expect(commands.map((c) => c.name)).toEqual(['db:migrate', 'derive', 'lint-all']);
    expect(commands[1]).toMatchObject({
      description: 'Derive and verify an equation',
      argumentHint: '<equation>',
      source: '.claude/commands/derive.md',
    });
    expect(commands[1].body).toBe('Derive $ARGUMENTS step by step, then verify numerically with execute_code.');
    expect(commands[0].description).toContain('.claude/commands/db/migrate.md');
  });

  it('returns nothing for a workspace without commands', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-code-nocmds-'));
    expect(await loadCustomCommands(root)).toEqual([]);
  });

  it('expands $ARGUMENTS and positional placeholders', () => {
    expect(expandCommandBody('Derive $ARGUMENTS now', 'E = mc^2')).toBe('Derive E = mc^2 now');
    expect(expandCommandBody('Migrate $1 to $2 ($3)', 'users "add email" ')).toBe('Migrate users to add email ()');
    expect(expandCommandBody('Run every linter.', '')).toBe('Run every linter.');
    // No placeholder → arguments are appended
    expect(expandCommandBody('Run every linter.', 'only src/')).toBe('Run every linter.\n\nonly src/');
  });

  it('turns served commands into registry definitions, skipping builtin names', () => {
    const defs = customCommandDefinitions([
      { name: 'derive', description: 'd', body: 'Derive $ARGUMENTS', source: 's', argumentHint: '<eq>' },
      { name: 'help', description: 'clash', body: 'x', source: 's' },
      { name: 'db:migrate', description: 'm', body: 'Migrate $1', source: 's' },
      { name: 'bad name', description: 'n', body: 'x', source: 's' },
    ]);
    expect(defs.map((d) => d.name)).toEqual(['derive', 'db:migrate']);
    expect(defs[0]).toMatchObject({ group: 'Project', kind: 'prompt', args: '<eq>' });
    expect(defs[0].prompt?.('x = y')).toBe('Derive x = y');
    expect(defs[1].args).toBe('[arguments]');

    const all = [...SLASH_COMMANDS, ...defs];
    expect(findSlashCommand('db:migrate', all)?.description).toBe('m');
    expect(findSlashCommand('derive')).toBeUndefined(); // not in the builtin registry
    expect(matchSlashCommands('db:', all).map((c) => c.name)).toEqual(['db:migrate']);
  });

  it('parses namespaced command names', () => {
    expect(parseSlashCommand('/db:migrate users')).toEqual({ name: 'db:migrate', args: 'users', raw: '/db:migrate users' });
    expect(getSlashQuery('/db:mi')).toBe('db:mi');
    expect(getSlashQuery('/db:migrate x')).toBeNull();
  });
});
