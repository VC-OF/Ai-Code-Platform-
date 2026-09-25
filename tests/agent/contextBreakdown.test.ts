import { describe, expect, it } from 'vitest';
import { computeBreakdownFromParts } from '@/lib/contextBreakdown';
import { createHarness } from '@/lib/harness';
import { formatSkillsForPrompt, type SkillDefinition } from '@/lib/skills';

const skill: SkillDefinition = {
  name: 'Testing',
  description: 'Verify changes',
  instructions: 'X'.repeat(8000),
  source: '.agents/skills/testing/SKILL.md',
};

function breakdown(windowSize: number, messageChars: number) {
  return computeBreakdownFromParts({
    model: 'test-model',
    windowSize,
    parts: {
      basePrompt: 'Base policy',
      agentsMemory: 'Use npm test',
      harness: createHarness('app'),
      skills: [skill],
      knowledgeItems: [],
    },
    mcpTools: [{ type: 'function', function: { name: 'mcp_demo_tool', parameters: {} } }],
    messages: messageChars ? [{ role: 'user', content: 'a'.repeat(messageChars) }] : [],
  });
}

describe('computeBreakdownFromParts', () => {
  it('categories sum to used, and used + free + buffer fill the window', () => {
    const b = breakdown(128_000, 4000);
    const sum = b.categories.reduce((s, c) => s + c.tokens, 0);
    expect(sum).toBe(b.used);
    expect(b.buffer).toBe(128_000 - Math.floor(128_000 * 0.6));
    expect(b.used + b.free + b.buffer).toBe(128_000);
    expect(b.categories.map((c) => c.key)).toEqual(['system', 'tools', 'mcp', 'memory', 'skills', 'messages']);
    expect(b.mcpTools[0].name).toBe('mcp_demo_tool');
    expect(b.memoryFiles.map((m) => m.name)).toContain('AGENTS.md');
    expect(b.messageCount).toBe(1);
  });

  it('never reports negative free space or buffer when over the window', () => {
    const b = breakdown(1_000, 400_000);
    expect(b.used).toBeGreaterThan(1_000);
    expect(b.free).toBe(0);
    expect(b.buffer).toBeGreaterThanOrEqual(0);
  });

  it('counts skills at listing cost, not full-instruction cost', () => {
    const b = breakdown(128_000, 0);
    const skills = b.categories.find((c) => c.key === 'skills')!;
    expect(skills.tokens).toBeLessThan(200);
    expect(b.skills[0]).toMatchObject({ name: 'Testing' });
    expect(formatSkillsForPrompt([skill])).not.toContain('XXXX');
  });
});
