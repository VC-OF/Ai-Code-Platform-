import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHarness } from '@/lib/harness';
import { composeSystemPrompt } from '@/lib/promptComposer';
import { loadSkills } from '@/lib/skills';
import { splitForCompaction } from '@/lib/contextManager';

describe('agent extensions', () => {
  it('loads project-local skills with frontmatter', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-code-skills-'));
    await fs.mkdir(path.join(root, '.opencode', 'skills', 'testing'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.opencode', 'skills', 'testing', 'SKILL.md'),
      '---\nname: Testing\ndescription: Verify changes\n---\nRun the narrowest relevant test first.',
      'utf8'
    );

    const skills = await loadSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: 'Testing', description: 'Verify changes' });
    expect(skills[0].instructions).toContain('narrowest relevant test');
  });

  it('composes guardrails, project memory, and skills', () => {
    const prompt = composeSystemPrompt({
      basePrompt: 'Base policy',
      agentsMemory: 'Use npm test',
      harness: createHarness('build'),
      skills: [{
        name: 'Testing',
        description: 'Verify changes',
        instructions: 'Run focused tests.',
        source: '.opencode/skills/testing/SKILL.md',
      }],
    });

    expect(prompt).toContain('Base policy');
    expect(prompt).toContain('Agent Harness and Guardrails');
    expect(prompt).toContain('Use npm test');
    expect(prompt).toContain('## Project Skills');
    expect(prompt).toContain('Run focused tests.');
  });

  it('does not orphan tool results during compaction', () => {
    const messages = [
      { role: 'system', content: 'policy' },
      { role: 'user', content: 'request' },
      { role: 'assistant', content: 'planning' },
      { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function' }] },
      { role: 'tool', content: 'result', tool_call_id: '1', tool_name: 'read_file' },
      { role: 'assistant', content: 'continue' },
      { role: 'user', content: 'finish' },
    ] as const;

    const split = splitForCompaction([...messages], 2);
    expect(split).not.toBeNull();
    expect(split?.preserved[0].role).not.toBe('tool');
  });
});
