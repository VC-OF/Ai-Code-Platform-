import { describe, expect, it } from 'vitest';
import {
  autoMemoryEnabled,
  parseMemoryProposals,
  existingMemoryLines,
  dedupeProposals,
  summarizeTurn,
} from '@/lib/autoMemory';
import type { LLMMessage } from '@/lib/llmClient';

describe('autoMemoryEnabled', () => {
  it('is on by default and off with OPEN_CODE_AUTO_MEMORY=0', () => {
    expect(autoMemoryEnabled({})).toBe(true);
    expect(autoMemoryEnabled({ OPEN_CODE_AUTO_MEMORY: '0' })).toBe(false);
    expect(autoMemoryEnabled({ OPEN_CODE_AUTO_MEMORY: 'off' })).toBe(false);
  });
});

describe('parseMemoryProposals', () => {
  it('parses bullets, caps at 3 and ignores prose', () => {
    const reply = 'Here are facts:\n- Tests run with `npx vitest run`\n* Uses **pnpm** workspaces\n1. API routes live in src/app/api\n- Fourth fact here ok';
    expect(parseMemoryProposals(reply)).toEqual([
      'Tests run with `npx vitest run`',
      'Uses pnpm workspaces',
      'API routes live in src/app/api',
    ]);
  });

  it('handles NONE, empty and junk', () => {
    expect(parseMemoryProposals('NONE')).toEqual([]);
    expect(parseMemoryProposals(null)).toEqual([]);
    expect(parseMemoryProposals('- ok\n- ' + 'x'.repeat(300))).toEqual([]);
  });
});

describe('dedupe', () => {
  const md = '# Project\n\n## Memory\n- Tests run with npx vitest run\n- Use pnpm\n\n## Other\n- not memory\n';

  it('reads existing memory bullets', () => {
    expect(existingMemoryLines(md)).toEqual(['Tests run with npx vitest run', 'Use pnpm']);
    expect(existingMemoryLines('no section')).toEqual([]);
  });

  it('drops proposals already in memory (case/punctuation-insensitive) and repeats', () => {
    expect(dedupeProposals(
      ['tests run with `npx vitest run`.', 'Build with npm run build', 'build with npm run build', 'not memory'],
      md
    )).toEqual(['Build with npm run build', 'not memory']);
  });
});

describe('summarizeTurn', () => {
  it('includes tool calls and skips the system prompt', () => {
    const text = summarizeTurn([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'add a test' },
      { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'run_tests', arguments: '{"cmd":"npm test"}' } }] },
    ] as LLMMessage[]);
    expect(text).not.toContain('SYS');
    expect(text).toContain('user: add a test');
    expect(text).toContain('run_tests({"cmd":"npm test"})');
  });
});
