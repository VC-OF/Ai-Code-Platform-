import { describe, it, expect, afterEach } from 'vitest';
import { executeTool, createTurnContext } from '@/lib/tools';
import { createWorkspace, createNodeWorkspace, TestWorkspace } from '../helpers/workspace';

describe('verification tools (run_lint and run_tests)', () => {
  let ws: TestWorkspace;

  afterEach(() => ws.cleanup());

  it('run_lint returns structured result', async () => {
    ws = await createNodeWorkspace();
    const result = await executeTool('run_lint', {}, ws.root, createTurnContext());
    expect(result.success).toBe(true);
    expect(result.structured).toHaveProperty('passed');
  }, 90_000); // really runs tsc

  it('run_tests skips cleanly when no test script exists', async () => {
    ws = await createWorkspace({
      'package.json': JSON.stringify({ name: 'no-tests', version: '1.0.0' }),
    });
    const result = await executeTool('run_tests', {}, ws.root, createTurnContext());
    expect(result.success).toBe(true);
    expect(result.structured?.skipped).toBe(true);
  });
});
