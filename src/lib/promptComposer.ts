import { formatHarnessForPrompt, type AgentHarness } from './harness';
import { formatSkillsForPrompt, type SkillDefinition } from './skills';
import type { OutputStyle } from './outputStyle';
import { formatKnowledgeForPrompt, type KnowledgeItem } from './knowledge';

export interface PromptParts {
  basePrompt: string;
  agentsMemory?: string;
  harness: AgentHarness;
  skills?: SkillDefinition[];
  knowledgeItems?: KnowledgeItem[];
  mode?: 'auto' | 'manual' | 'plan';
  outputStyle?: OutputStyle;
}

/** Optional response-style guidance selected with /output-style. */
export function formatOutputStyleForPrompt(style?: OutputStyle): string {
  if (style === 'explanatory') {
    return '## Output Style: Explanatory\nWhile completing the task, briefly explain the reasoning behind implementation choices and point out relevant codebase patterns, so the user understands why, not just what.';
  }
  if (style === 'learning') {
    return '## Output Style: Learning\nTreat the user as a learner. Explain key concepts as you go, and where a small, well-scoped piece of code would be instructive, leave it for the user to write (mark it with a TODO(human) comment) and describe what it should do.';
  }
  if (style === 'concise') {
    return "## Output Style: Concise\nKeep responses short. Report only what changed, the verification result, and anything that needs the user's attention. No preamble or recap.";
  }
  return '';
}

export function formatModeForPrompt(mode?: 'auto' | 'manual' | 'plan'): string {
  if (mode === 'manual') {
    return '## Execution Mode: Manual (Supervised)\nYou are running in Manual Supervision Mode. All modifying operations (file creations, edits, deletions, shell commands, and docker runs) will be submitted to the user for interactive approval. Clearly state what you intend to do before executing mutating tools.';
  }
  if (mode === 'plan') {
    return '## Execution Mode: Plan-First (Architect)\nYou are running in Plan Mode, which is read-only: only reading/searching tools, `explore`/`research` sub-agents, `update_plan` and `ask_user` run — edits and commands are refused. Inspect the workspace, then call `exit_plan_mode` with your implementation plan in markdown (files to change, steps, how you will verify). If the user approves, the rest of the turn runs in auto mode and you implement the plan; otherwise refine it and call `exit_plan_mode` again.';
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
    formatOutputStyleForPrompt(parts.outputStyle),
  ].filter(Boolean).join('\n\n');
}

export { OUTPUT_STYLES, isOutputStyle, type OutputStyle } from './outputStyle';
