import { formatHarnessForPrompt, type AgentHarness } from './harness';
import { formatSkillsForPrompt, type SkillDefinition } from './skills';

export interface PromptParts {
  basePrompt: string;
  agentsMemory?: string;
  harness: AgentHarness;
  skills?: SkillDefinition[];
}

/** Compose stable policy context once per agent run. Ephemeral request context
 * should remain in user messages so provider prompt caching still works. */
export function composeSystemPrompt(parts: PromptParts): string {
  return [
    parts.basePrompt,
    formatHarnessForPrompt(parts.harness),
    parts.agentsMemory ? `## Project Memory (AGENTS.md)\n${parts.agentsMemory}` : '',
    formatSkillsForPrompt(parts.skills ?? []),
  ].filter(Boolean).join('\n\n');
}
