import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { executeTool, createTurnContext } from '@/lib/tools';
import { validateTool } from '@/lib/toolValidator';
import { planDb, projectDb } from '@/lib/db';

const PROJECT_ID = `test-plan-${Date.now()}`;
const WORKSPACE = path.join(process.cwd(), 'workspaces', PROJECT_ID);

describe('update_plan tool', () => {
  beforeAll(() => {
    // project_plans has a FK to projects — the row must exist
    projectDb.create({
      id: PROJECT_ID,
      name: 'plan test',
      workspace: WORKSPACE,
      description: null,
    });
  });

  afterAll(() => {
    try { projectDb.delete(PROJECT_ID); } catch {} // cascades the plan
  });

  it('validates task shape and caps', () => {
    expect(
      validateTool('update_plan', {
        tasks: [{ id: 't1', title: 'Build the thing', status: 'in_progress' }],
      }).ok
    ).toBe(true);

    expect(
      validateTool('update_plan', {
        tasks: [{ id: 't1', title: 'x', status: 'doing' }],
      }).ok
    ).toBe(false);

    expect(
      validateTool('update_plan', {
        tasks: Array.from({ length: 21 }, (_, i) => ({
          id: `t${i}`, title: 'task', status: 'pending',
        })),
      }).ok
    ).toBe(false);
  });

  it('persists the plan and reports progress', async () => {
    const ctx = createTurnContext();
    const result = await executeTool(
      'update_plan',
      {
        tasks: [
          { id: 't1', title: 'Scaffold app', status: 'completed' },
          { id: 't2', title: 'Add routes', status: 'in_progress' },
          { id: 't3', title: 'Write tests', status: 'pending' },
        ],
      },
      WORKSPACE,
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain('1/3 done');
    expect(result.summary).toContain('Add routes');
    expect(result.structured?.tasks).toHaveLength(3);

    // Survives to the next "turn" via the DB
    const persisted = planDb.get(PROJECT_ID);
    expect(persisted).toHaveLength(3);
    expect(persisted[1].status).toBe('in_progress');
  });
});
