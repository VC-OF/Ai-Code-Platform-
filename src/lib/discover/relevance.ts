import type { DiscoverItem } from './types';

/**
 * Which parts of OpenCode an item touches, by keyword. Deterministic (no
 * model call) so the feed ranks the same way offline and without quota.
 */
// Phrases, not bare words, where a bare word has common non-AI meanings
// ("user agent", "foreign agents", RAM "memory", "type inference").
export const OPENCODE_AREAS: { area: string; re: RegExp }[] = [
  { area: 'Agent loop', re: /(?<!user[- ])(?<!foreign )(?<!secret )(?<!travel )(?<!real[- ]estate )\bagents?\b|\bagentic\b|task planning|\bplanner\b|multi-step|self-(refine|correct|debug)|\breasoning\b/i },
  { area: 'Tools & MCP', re: /\bmcp\b|model context protocol|tool[- ]?(use|calling|call)|function[- ]calling/i },
  { area: 'Context & memory', re: /context (window|length|management|compression|engineering)|long[- ]context|(agent|long[- ]term|episodic|conversation(al)?) memory|memory (bank|module|layer) for|retrieval[- ]augmented|\brag\b|compaction|prompt cach/i },
  { area: 'Code generation', re: /\bcode (generation|model|llm|agent|review|repair|assistant)|\bcoding\b|program synthesis|software engineering|swe-?bench|refactor|\bdebugg/i },
  { area: 'Evaluation', re: /benchmark|\bevals?\b|evaluation of|leaderboard|swe-?bench/i },
  { area: 'Sub-agents', re: /multi-agent|sub-?agent|orchestrat|agent team|agent swarm/i },
  { area: 'Sandbox & security', re: /sandbox|prompt injection|jailbreak|\bsecurity\b|permission|vulnerab/i },
  { area: 'Science & physics', re: /physics|scientific|simulation|mathemat|theorem|numerical|\bpde\b|quantum/i },
  { area: 'Models & providers', re: /\bllms?\b|large language model|foundation model|\bgpt-?\d|\bollama\b|\bopenai\b|anthropic|\bclaude\b|\bgemini\b|\bllama\b|\bqwen\b|deepseek|mistral|(llm|model) inference|inference (engine|server|speed|cost)|quantiz|\bgguf\b/i },
  { area: 'Browser & UI', re: /\bbrowser (agents?|automation|use)\b|playwright|web agents?\b|computer use\b|\bgui agents?\b/i },
];

/** Areas matched in title + summary (search-keyword tags are not content). */
export function scoreRelevance(item: Pick<DiscoverItem, 'title' | 'summary'>, keywords: string[] = []): { score: number; areas: string[] } {
  const text = `${item.title} ${item.summary ?? ''}`;
  const areas = OPENCODE_AREAS.filter((a) => a.re.test(text)).map((a) => a.area);
  const lower = text.toLowerCase();
  const kw = keywords.filter((k) => k.trim() && lower.includes(k.trim().toLowerCase())).length;
  // Areas weigh more than raw keyword hits; the title counts double
  const titleAreas = OPENCODE_AREAS.filter((a) => a.re.test(item.title)).length;
  return { score: areas.length * 2 + titleAreas + kw, areas };
}

export type SortMode = 'relevant' | 'newest' | 'popular';

export function sortItems(items: DiscoverItem[], mode: SortMode): DiscoverItem[] {
  const time = (i: DiscoverItem) => (i.date ? Date.parse(i.date) || 0 : 0);
  const out = [...items];
  if (mode === 'newest') out.sort((a, b) => time(b) - time(a));
  else if (mode === 'popular') out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || time(b) - time(a));
  else out.sort((a, b) => (b.relevance?.score ?? 0) - (a.relevance?.score ?? 0) || time(b) - time(a));
  return out;
}
