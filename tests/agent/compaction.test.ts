import { describe, it, expect } from 'vitest';
import {
  splitForCompaction,
  serializeForSummary,
  type ContextMessage,
} from '@/lib/contextManager';

const sys = (): ContextMessage => ({ role: 'system', content: 'prompt' });
const user = (c: string): ContextMessage => ({ role: 'user', content: c });
const asst = (c: string, calls = false): ContextMessage => ({
  role: 'assistant',
  content: c,
  ...(calls ? { tool_calls: [{ id: 't1' }] } : {}),
});
const tool = (c: string): ContextMessage => ({
  role: 'tool',
  content: c,
  tool_call_id: 't1',
  tool_name: 'read_file',
});

describe('splitForCompaction', () => {
  it('returns null when there is too little to evict', () => {
    expect(splitForCompaction([sys(), user('a'), asst('b')], 8)).toBeNull();
  });

  it('keeps the system message in head and preserves the tail', () => {
    const msgs = [sys(), user('1'), asst('2'), user('3'), asst('4'), user('5'), asst('6')];
    const split = splitForCompaction(msgs, 2)!;
    expect(split.head).toHaveLength(1);
    expect(split.head[0].role).toBe('system');
    expect(split.preserved).toHaveLength(2);
    expect(split.evicted).toHaveLength(4);
    // No message lost
    expect(split.head.length + split.evicted.length + split.preserved.length)
      .toBe(msgs.length);
  });

  it('never starts the preserved span with a tool message', () => {
    // Cut point would land on a tool result — boundary must walk back so the
    // assistant tool_calls message stays with its results
    const msgs = [
      sys(),
      user('build it'), asst('plan'), user('go'), asst('ok'),
      asst('reading', true), tool('contents A'), tool('contents B'),
      asst('done'),
    ];
    // preserveLastN = 3 → naive boundary lands on tool('contents A')
    const split = splitForCompaction(msgs, 3)!;
    expect(split).not.toBeNull();
    expect(split.preserved[0].role).not.toBe('tool');
    // The assistant that issued the tool calls is preserved with its results
    expect(split.preserved.map((m) => m.role)).toEqual([
      'assistant', 'tool', 'tool', 'assistant',
    ]);
    expect(split.evicted).toHaveLength(4);
  });

  it('returns null when the boundary walk-back leaves too little to evict', () => {
    const msgs = [
      sys(),
      user('a'), asst('b', true), tool('A'), tool('B'), asst('done'),
    ];
    expect(splitForCompaction(msgs, 3)).toBeNull();
  });
});

describe('serializeForSummary', () => {
  it('labels roles and truncates long messages', () => {
    const out = serializeForSummary([
      user('goal'),
      tool('x'.repeat(5000)),
    ]);
    expect(out).toContain('### user');
    expect(out).toContain('### tool(read_file)');
    expect(out).toContain('…[truncated]');
    expect(out.length).toBeLessThan(5000);
  });
});
