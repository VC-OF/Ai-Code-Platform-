import { describe, it, expect } from 'vitest';
import { CappedOutput, SANDBOX_HOME } from '@/lib/safeExec';
import { testPlan, parseTestCounts } from '@/lib/stackVerify';
import { truncate } from '@/lib/tools';
import { createWorkspace } from '../helpers/workspace';

describe('command output capture', () => {
  it('keeps head and tail of an over-long stream (summary lines come last)', () => {
    const buf = new CappedOutput(100);
    buf.push('START\n' + 'x'.repeat(500));
    buf.push('\nTests run: 7, Failures: 0, Errors: 0');
    const out = buf.toString();
    expect(out.startsWith('START')).toBe(true);
    expect(out).toContain('Tests run: 7, Failures: 0, Errors: 0');
    expect(out).toContain('chars of output truncated');
    expect(out.length).toBeLessThan(200);
  });

  it('passes short output through unchanged', () => {
    const buf = new CappedOutput(100);
    buf.push('a');
    buf.push('b');
    expect(buf.toString()).toBe('ab');
  });

  it('tool-output truncation keeps the tail too', () => {
    const s = 'HEAD' + '-'.repeat(1000) + 'FINAL SUMMARY';
    const t = truncate(s, 200);
    expect(t.startsWith('HEAD')).toBe(true);
    expect(t.endsWith('FINAL SUMMARY')).toBe(true);
  });

  it('sandbox HOME is not the workspace (cargo init refuses to run in $HOME)', () => {
    expect(SANDBOX_HOME).not.toBe('/workspace');
  });
});

describe('maven test plan', () => {
  it('does not run quietly, so the surefire summary is parseable', async () => {
    const ws = await createWorkspace({ 'pom.xml': '<project/>' });
    try {
      const plan = await testPlan('maven', ws.root, true);
      if ('skipped' in plan) throw new Error('unexpected skip');
      const cmd = plan.candidates[0].command;
      expect(cmd).not.toMatch(/(^|\s)-q(\s|$)/);
      const out = '[INFO] Tests run: 7, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.2 s -- in A$B\n' +
        '[INFO] Tests run: 0, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.3 s -- in A\n' +
        '[INFO] Results:\n[INFO] Tests run: 7, Failures: 0, Errors: 0, Skipped: 0\n';
      expect(parseTestCounts('maven', out)).toEqual({ total: 7, failed: 0 });
    } finally {
      await ws.cleanup();
    }
  });
});
