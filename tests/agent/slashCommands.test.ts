import { describe, expect, it } from 'vitest';
import {
  findSlashCommand,
  formatSlashHelp,
  parseSlashCommand,
} from '@/lib/slashCommands';

describe('slash commands', () => {
  it('parses command names and arguments', () => {
    expect(parseSlashCommand('  /review  focus on security  ')).toEqual({
      name: 'review',
      args: 'focus on security',
      raw: '/review  focus on security',
    });
    expect(parseSlashCommand('explain this')).toBeNull();
  });

  it('resolves aliases and expands task commands', () => {
    const command = findSlashCommand('tests');
    expect(command?.name).toBe('test');
    expect(command?.prompt?.('the auth flow')).toContain('the auth flow');
  });

  it('lists every registered command in help', () => {
    const help = formatSlashHelp();
    expect(help).toContain('/help');
    expect(help).toContain('/clear');
    expect(help).toContain('/review');
    expect(help).toContain('/permissions');
  });
});
