import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  due: [] as { id: string; project_id: string; cron: string; prompt: string; model: string | null }[],
  marked: [] as [string, number, number | null][],
  running: new Set<string>(),
  started: [] as unknown[][],
}));

vi.mock('@/lib/db', () => ({
  scheduleDb: {
    due: () => state.due,
    markRun: (id: string, last: number, next: number | null) => state.marked.push([id, last, next]),
  },
  projectDb: { getById: (id: string) => (id === 'missing' ? undefined : { id }) },
}));
vi.mock('@/lib/agentManager', () => ({
  agentManager: {
    isRunning: (id: string) => state.running.has(id),
    startAgent: (...args: unknown[]) => {
      state.started.push(args);
      return new ReadableStream();
    },
  },
}));
vi.mock('@/lib/workspaceLock', () => ({ workspaceLocks: { get: () => ({ isLocked: () => false }) } }));

import { parseCron, nextRun, cronMatches, isValidCron, runDueSchedules } from '@/lib/scheduler';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);
const fmt = (d: Date | null) =>
  d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('parseCron', () => {
  it('expands *, lists, ranges and steps', () => {
    const s = parseCron('*/15 9-17/4 1,15 * mon-fri');
    expect([...s.minutes]).toEqual([0, 15, 30, 45]);
    expect([...s.hours]).toEqual([9, 13, 17]);
    expect([...s.daysOfMonth]).toEqual([1, 15]);
    expect(s.months.size).toBe(12);
    expect([...s.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles names, 7 = Sunday and start/step', () => {
    expect([...parseCron('0 0 * jan,DEC 7').daysOfWeek]).toEqual([0]);
    expect([...parseCron('0 0 * jan,DEC 7').months]).toEqual([1, 12]);
    expect([...parseCron('5/20 * * * *').minutes]).toEqual([5, 25, 45]);
  });

  it('rejects malformed expressions', () => {
    for (const bad of ['* * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '5-1 * * * *', '*/0 * * * *', 'a * * * *', '1-2-3 * * * *', '']) {
      expect(isValidCron(bad), bad).toBe(false);
    }
    expect(() => parseCron('61 * * * *')).toThrow(/minute/);
  });
});

describe('nextRun', () => {
  it('is strictly after `from` and minute-aligned', () => {
    expect(fmt(nextRun('* * * * *', new Date(2026, 0, 1, 10, 0, 30)))).toBe('2026-01-01 10:01');
    expect(fmt(nextRun('0 * * * *', at(2026, 1, 1, 10, 0)))).toBe('2026-01-01 11:00');
  });

  it('finds daily, weekday and monthly runs', () => {
    expect(fmt(nextRun('30 9 * * *', at(2026, 1, 1, 10)))).toBe('2026-01-02 09:30');
    // 2026-01-02 is a Friday → next weekday 09:00 is Monday the 5th
    expect(fmt(nextRun('0 9 * * 1-5', at(2026, 1, 2, 10)))).toBe('2026-01-05 09:00');
    expect(fmt(nextRun('0 0 1 * *', at(2026, 1, 15)))).toBe('2026-02-01 00:00');
    expect(fmt(nextRun('0 12 31 * *', at(2026, 2, 1)))).toBe('2026-03-31 12:00');
  });

  it('crosses year boundaries and handles leap days', () => {
    expect(fmt(nextRun('0 0 1 1 *', at(2026, 6, 1)))).toBe('2027-01-01 00:00');
    expect(fmt(nextRun('0 0 29 2 *', at(2026, 1, 1)))).toBe('2028-02-29 00:00');
  });

  it('ORs day-of-month and day-of-week when both are restricted', () => {
    // the 13th, or any Friday — from Jan 1 2026 (Thursday) the first Friday is Jan 2
    expect(fmt(nextRun('0 0 13 * 5', at(2026, 1, 1, 1)))).toBe('2026-01-02 00:00');
  });

  it('returns null for a date that never occurs', () => {
    expect(nextRun('0 0 30 2 *', at(2026, 1, 1))).toBeNull();
  });

  it('agrees with cronMatches', () => {
    const spec = parseCron('*/10 8-18 * * 1-5');
    let d: Date | null = at(2026, 3, 6, 17, 55);
    for (let i = 0; i < 20 && d; i++) {
      d = nextRun(spec, d);
      expect(d && cronMatches(spec, d)).toBe(true);
    }
  });
});

describe('runDueSchedules', () => {
  beforeEach(() => {
    state.due = [];
    state.marked = [];
    state.running = new Set();
    state.started = [];
  });

  it('starts due schedules on idle projects and advances next_run_at', async () => {
    state.due = [
      { id: 's1', project_id: 'p1', cron: '0 9 * * *', prompt: 'run tests', model: 'm1' },
      { id: 's2', project_id: 'busy', cron: '* * * * *', prompt: 'x', model: null },
      { id: 's3', project_id: 'missing', cron: '* * * * *', prompt: 'x', model: null },
    ];
    state.running.add('busy');
    const now = at(2026, 1, 1, 9, 0);
    const started = await runDueSchedules(now);
    expect(started).toEqual(['s1']);
    expect(state.started).toHaveLength(1);
    const [projectId, messages, , model, mode] = state.started[0] as [string, { content: string }[], unknown, string, string];
    expect(projectId).toBe('p1');
    expect(messages[0].content).toContain('run tests');
    expect(model).toBe('m1');
    expect(mode).toBe('auto');
    // Only the started schedule is marked; busy one is retried next tick
    expect(state.marked).toEqual([['s1', now.getTime(), at(2026, 1, 2, 9, 0).getTime()]]);
  });
});
