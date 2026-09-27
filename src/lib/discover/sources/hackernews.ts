/**
 * Hacker News stories from the last week that match the configured keywords,
 * via the Algolia search API (no key needed).
 */
import { scoreRelevance } from '../relevance';
import { cleanText, getJson, plainText, safeUrl, type DiscoverConfig, type DiscoverItem, type DiscoverSource, type FetchLike } from '../types';

const SOURCE = 'hackernews';
const LABEL = 'Hacker News';
const SEARCH_URL = 'https://hn.algolia.com/api/v1/search';
const WINDOW_S = 7 * 24 * 3600;
const MIN_POINTS = 30;
const HITS_PER_QUERY = 20;
const MAX_KEYWORDS = 4;
const MAX_ITEMS = 15;
const TIMEOUT_MS = 15_000;

interface HnHit {
  objectID?: unknown;
  title?: unknown;
  url?: unknown;
  story_text?: unknown;
  points?: unknown;
  num_comments?: unknown;
  created_at?: unknown;
  created_at_i?: unknown;
}

// Which OpenCode files a story that touches an OpenCode area (relevance.ts) most
// likely concerns; first match on the title wins.
const AREA_FILES: [RegExp, string][] = [
  [/\bmcp\b|model context protocol/i, 'MCP client (src/lib/mcpClient.ts, src/lib/mcpTransports.ts)'],
  [/sandbox|docker|container|prompt injection|jailbreak|permission|vulnerab|\bsecurity\b/i, 'sandbox and permissions (src/lib/dockerService.ts, src/lib/permissions.ts)'],
  [/sub-?agent|multi-agent|orchestrat|parallel (\w+[- ])?agents|agent team|swarm/i, 'sub-agents (src/lib/subagents.ts)'],
  [/\btools?\b|tool[- ]?(use|call)|function[- ]call/i, 'tools and tool-call handling (src/lib/tools.ts)'],
  [/context (window|length|management|engineering|compression)|long[- ]context|\bmemory\b|compaction|prompt cach|\brag\b|retrieval/i, 'context management and memory (src/lib/contextManager.ts, src/lib/autoMemory.ts)'],
  [/physics|mathemat|\bmath\b|\bscien|simulat|quantum|theorem|numerical|\bpde\b/i, 'science and physics tooling (src/lib/scienceTools.ts)'],
  [/\bbrowser\b|playwright|computer use|web agent|gui agent/i, 'browser tools (src/lib/browserTools.ts)'],
  [/\bagent|planner|planning|multi-step|prompt|reasoning|\bcoding\b|\bcode\b|refactor|debugg|benchmark|\bevals?\b|leaderboard|swe-?bench/i, 'agent loop (src/lib/agentLoop.ts) and system prompt (src/lib/systemPrompt.ts)'],
  [/\bllms?\b|language model|foundation model|\bollama\b|\bopenai\b|anthropic|\bclaude\b|gemini|\bgpt|\bllama\b|\bqwen\b|deepseek|mistral|inference|quantiz|\bgguf\b|open[- ]weight/i, 'model support (src/lib/models.ts, src/lib/llmClient.ts)'],
];
const ANY_AREA = 'agent loop (src/lib/agentLoop.ts), tools (src/lib/tools.ts) or MCP client (src/lib/mcpClient.ts)';

/** Whether the title touches an OpenCode area, by the feed's shared definition. */
function touchesOpenCode(title: string): boolean {
  return scoreRelevance({ title }).areas.length > 0;
}

function hnGoal(title: string, url: string): string {
  const story = `Read the Hacker News story "${title}" (${url})`;
  // No area match: ask for a judgement instead of pretending the story is about the agent loop
  if (!touchesOpenCode(title)) {
    return (
      `${story} and decide whether it matters for OpenCode (agent loop, tools, MCP client, models, sub-agents, sandbox, science tooling); ` +
      'if it points to a concrete improvement, make the smallest useful change with tests, otherwise record why it does not apply.'
    );
  }
  const area = AREA_FILES.find(([re]) => re.test(title))?.[1] ?? ANY_AREA;
  return (
    `${story} and evaluate whether the technique or tool it describes would improve OpenCode's ${area}; ` +
    'if it would, make the smallest useful change with tests, otherwise record why it does not fit.'
  );
}

function isoDate(hit: HnHit): string | undefined {
  const t = typeof hit.created_at === 'string' ? Date.parse(hit.created_at)
    : typeof hit.created_at_i === 'number' ? hit.created_at_i * 1000 : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** Algolia search payload → items tagged with the keyword that found them. */
export function parseHackerNews(payload: unknown, keyword?: string): DiscoverItem[] {
  const hits = (payload as { hits?: unknown } | null)?.hits;
  if (!Array.isArray(hits)) return [];
  const kw = keyword ? plainText(keyword, 100).toLowerCase() : ''; // never shorter than a valid keyword (≤60)
  const items: DiscoverItem[] = [];
  for (const raw of hits as HnHit[]) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.objectID === 'string' && /^\d{1,12}$/.test(raw.objectID) ? raw.objectID : null;
    // Titles are plain text: keep "Array<string>" as written
    const title = plainText(raw.title, 200);
    if (!id || !title) continue;
    // A present-but-unsafe link (javascript:, data:) drops the story; a missing
    // one (Ask HN, text posts) falls back to the discussion page.
    const hasLink = typeof raw.url === 'string' && raw.url.trim() !== '';
    const url = hasLink ? safeUrl(raw.url) : `https://news.ycombinator.com/item?id=${id}`;
    if (!url) continue;
    const summary = cleanText(raw.story_text, 400);
    items.push({
      id: `${SOURCE}:${id}`,
      category: 'updates',
      source: SOURCE,
      sourceLabel: LABEL,
      title,
      url,
      ...(summary ? { summary } : {}),
      date: isoDate(raw),
      ...(typeof raw.points === 'number' && Number.isFinite(raw.points) ? { score: raw.points } : {}),
      tags: ['news', ...(kw ? [kw] : [])],
      goal: hnGoal(title, url),
    });
  }
  return items;
}

/** Every word of the keyword appears in the title as a whole word, plurals allowed:
 *  'LLM' matches "LLMs", 'AI agent' matches "AI coding agents"; 'AI' does not match "Airbnb". */
export function titleMentions(title: string, keyword: string): boolean {
  // Split on non-letters/digits, so each word is safe inside a RegExp
  const words = keyword.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length > 0 && words.every((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?:e?s)?(?![\\p{L}\\p{N}])`, 'iu').test(title));
}

/**
 * Merge per-keyword results (one list per keyword): dedupe by story with the union of
 * keyword tags, drop stories whose title neither touches an OpenCode area nor names a
 * keyword, take the rest round-robin by keyword so a broad keyword cannot fill the feed,
 * then rank by OpenCode relevance of the title, then points.
 */
export function mergeHackerNews(lists: DiscoverItem[][], limit = MAX_ITEMS): DiscoverItem[] {
  const byId = new Map<string, DiscoverItem>();
  for (const item of lists.flat()) {
    const prev = byId.get(item.id);
    if (!prev) byId.set(item.id, { ...item, tags: [...item.tags] });
    else for (const tag of item.tags) if (!prev.tags.includes(tag)) prev.tags.push(tag);
  }
  const rel = new Map([...byId.values()].map((i) => [i.id, scoreRelevance({ title: i.title })]));
  const relevant = (i: DiscoverItem) =>
    rel.get(i.id)!.areas.length > 0 || i.tags.some((t) => t !== 'news' && titleMentions(i.title, t));
  const rank = (a: DiscoverItem, b: DiscoverItem) =>
    rel.get(b.id)!.score - rel.get(a.id)!.score || (b.score ?? 0) - (a.score ?? 0) || (b.date ?? '').localeCompare(a.date ?? '');

  const queues = lists.map((list) => [...new Set(list.map((i) => i.id))].map((id) => byId.get(id)!).filter(relevant).sort(rank));
  const picked = new Map<string, DiscoverItem>();
  while (picked.size < limit && queues.some((q) => q.length)) {
    for (const q of queues) {
      while (q.length && picked.has(q[0].id)) q.shift();
      const next = q.shift();
      if (next) picked.set(next.id, next);
      if (picked.size === limit) break;
    }
  }
  return [...picked.values()].sort(rank);
}

/** Up to 4 distinct, non-empty keywords. */
export function pickKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const kw = typeof k === 'string' ? k.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
    if (!kw || seen.has(kw.toLowerCase())) continue;
    seen.add(kw.toLowerCase());
    out.push(kw);
    if (out.length === MAX_KEYWORDS) break;
  }
  return out;
}

// typoTolerance=false: with typos on, 'tool use' matches 'Tools' and 'MCP' matches 'map'.
// restrictSearchableAttributes=title: story_text pulled in launches that merely mention a
// keyword, and URL slugs matched off-topic stories.
export function hackerNewsSearchUrl(keyword: string, sinceSec: number): string {
  const filters = `created_at_i>${Math.floor(sinceSec)},points>=${MIN_POINTS}`;
  return (
    `${SEARCH_URL}?tags=story&query=${encodeURIComponent(keyword)}&numericFilters=${encodeURIComponent(filters)}` +
    `&hitsPerPage=${HITS_PER_QUERY}&typoTolerance=false&restrictSearchableAttributes=title`
  );
}

export const hackerNewsSource: DiscoverSource = {
  id: SOURCE,
  label: LABEL,
  category: 'updates',
  async fetch(fetchImpl: FetchLike, cfg: DiscoverConfig): Promise<DiscoverItem[]> {
    // Headlines are short: broad news keywords match them far better than research phrases
    const keywords = pickKeywords(cfg.newsKeywords?.length ? cfg.newsKeywords : cfg.keywords);
    if (!keywords.length) return [];
    const since = Math.floor((cfg.now?.() ?? Date.now()) / 1000) - WINDOW_S;
    const results = await Promise.allSettled(
      keywords.map(async (kw) => parseHackerNews(await getJson(fetchImpl, hackerNewsSearchUrl(kw, since), {}, TIMEOUT_MS), kw)),
    );
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (!ok.length) {
      const reason = (results[0] as PromiseRejectedResult).reason;
      throw new Error(`Hacker News search failed: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    return mergeHackerNews(ok);
  },
};
