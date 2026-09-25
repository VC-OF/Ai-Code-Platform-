import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeTool, createTurnContext } from '@/lib/tools';
import { validateToolArgs } from '@/lib/toolValidator';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

describe('load_skill tool', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({
      '.agents/skills/deploy-check/SKILL.md':
        '---\nname: Deploy-Check\ndescription: Verify before deploying\n---\nAlways run the smoke test first.',
    });
  });

  afterEach(() => ws.cleanup());

  it('returns full instructions (case-insensitive name)', async () => {
    const result = await executeTool('load_skill', { name: 'deploy-check' }, ws.root, createTurnContext());
    expect(result.success).toBe(true);
    expect(result.output).toContain('Always run the smoke test first.');
    expect(result.summary).toContain('Deploy-Check');
  });

  it('errors on an unknown skill and lists available names', async () => {
    const result = await executeTool('load_skill', { name: 'nope' }, ws.root, createTurnContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown skill 'nope'");
    expect(result.output).toContain('Deploy-Check');
  });

  it('validates arguments', () => {
    expect(validateToolArgs('load_skill', { name: 'x' }).success).toBe(true);
    expect(validateToolArgs('load_skill', {}).success).toBe(false);
  });
});
