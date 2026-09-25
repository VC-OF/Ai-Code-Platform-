import { formatHarnessForPrompt, type AgentHarness } from './harness';
import { formatSkillsForPrompt, type SkillDefinition } from './skills';
import { formatKnowledgeForPrompt, type KnowledgeItem } from './knowledge';

export interface PromptParts {
  basePrompt: string;
  agentsMemory?: string;
  harness: AgentHarness;
  skills?: SkillDefinition[];
  knowledgeItems?: KnowledgeItem[];
  mode?: 'auto' | 'manual' | 'plan';
}

function formatModeForPrompt(mode?: 'auto' | 'manual' | 'plan'): string {
  if (mode === 'manual') {
    return '## Execution Mode: Manual (Supervised)\nYou are running in Manual Supervision Mode. All modifying operations (file creations, edits, deletions, shell commands, and docker runs) will be submitted to the user for interactive approval. Clearly state what you intend to do before executing mutating tools.';
  }
  if (mode === 'plan') {
    return '## Execution Mode: Plan-First (Architect)\nYou are running in Plan-First Mode. Before modifying files or running commands, inspect the workspace and call `update_plan` to outline your architecture and step-by-step strategy for the user.';
  }
  return '## Execution Mode: Autonomous (Full-Auto)\nYou are running in Autonomous Mode. You have full permission to plan, edit files, execute commands/tests, and iteratively verify solutions until the goal is fully accomplished.';
}

/** Compose stable policy context once per agent run. Ephemeral request context
 * should remain in user messages so provider prompt caching still works. */
export function composeSystemPrompt(parts: PromptParts): string {
  return [
    parts.basePrompt,
    formatHarnessForPrompt(parts.harness),
    parts.agentsMemory ? `## Project Memory (AGENTS.md)\n${parts.agentsMemory}` : '',
    formatKnowledgeForPrompt(parts.knowledgeItems ?? []),
    formatSkillsForPrompt(parts.skills ?? []),
    formatModeForPrompt(parts.mode),
  ].filter(Boolean).join('\n\n');
}
