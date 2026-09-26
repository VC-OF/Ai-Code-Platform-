import { usageDb } from './db';
import { computeCostUsd } from './models';

export function trackUsage(entry: {
  projectId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  turnIndex: number;
  /** Prompt tokens read from the provider's prompt cache, when reported */
  cachedTokens?: number;
}): { costUsd: number } {
  usageDb.insert({
    project_id: entry.projectId,
    model: entry.model,
    prompt_tokens: entry.promptTokens,
    completion_tokens: entry.completionTokens,
    turn_index: entry.turnIndex,
    cached_tokens: entry.cachedTokens ?? null,
  });

  return {
    costUsd: computeCostUsd(entry.model, entry.promptTokens, entry.completionTokens),
  };
}
