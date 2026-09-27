import { getJson, plainText, safeUrl } from '../types';
import type { DiscoverConfig, DiscoverItem, DiscoverSource } from '../types';
import { OPENCODE_AREAS } from '../relevance';

/**
 * Hugging Face daily papers: the community-upvoted research feed. Papers
 * matching the user's keywords rank first, then by upvotes. Also home to the
 * helpers both paper sources share (goal, byline, summary).
 */

const SOURCE_ID = 'hf-papers';
const SOURCE_LABEL = 'Hugging Face papers';
const API_URL = 'https://huggingface.co/api/daily_papers?limit=50';
const MAX_ITEMS = 15;
/** Paper ids are arXiv ids (2609.28603); must start alphanumeric so `.`/`..` can't change the path */
const PAPER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A new-style arXiv id, optionally versioned; group 1 is the versionless id */
const ARXIV_NEW_ID_RE = /^(\d{4}\.\d{4,5})(?:v\d+)?$/;

type Raw = Record<string, unknown>;

const asObj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);

export function isoDate(v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** "A, B, C et al." from already-decoded names; '' when there are none. */
export function authorLine(names: string[], max = 3): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (!clean.length) return '';
  return clean.slice(0, max).join(', ') + (clean.length > max ? ' et al.' : '');
}

/** "Byline — abstract", clipped to 400 code points. Inputs are plain text
 *  already, so this does not decode entities a second time. */
export function paperSummary(byline: string, abstract: string, max = 400): string {
  const text = byline && abstract ? `${byline} — ${abstract}` : abstract;
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

// Where in OpenCode a paper's idea would land, keyed by relevance.ts area names
// (plus two arXiv-category fallbacks that span two areas)
const SE_FALLBACK = 'Software engineering';
const PROMPT_FALLBACK = 'Prompting';
const AREA_TARGETS: Record<string, string> = {
  'Tools & MCP': 'tool layer and MCP client (src/lib/tools.ts, src/lib/mcpClient.ts)',
  'Sub-agents': 'sub-agent delegation (src/lib/subagents.ts)',
  'Context & memory': 'context management and auto-memory (src/lib/contextManager.ts, src/lib/autoMemory.ts)',
  'Sandbox & security': 'sandboxed execution and permission rules (src/lib/safeExec.ts, src/lib/permissionRules.ts)',
  'Science & physics': 'science and physics tooling (src/lib/scienceTools.ts)',
  'Browser & UI': 'browser tools (src/lib/browserTools.ts)',
  'Code generation': 'code-editing tools and system prompt (src/lib/tools.ts, src/lib/systemPrompt.ts)',
  'Models & providers': 'model client and model catalog (src/lib/llmClient.ts, src/lib/models.ts)',
  'Agent loop': 'agent loop (src/lib/agentLoop.ts)',
  [SE_FALLBACK]: 'code-editing tools and agent loop (src/lib/tools.ts, src/lib/agentLoop.ts)',
  [PROMPT_FALLBACK]: 'system prompt and context management (src/lib/systemPrompt.ts, src/lib/contextManager.ts)',
};
// Most specific first (breaks ties in the title). Evaluation is handled apart
// (benchmark goals); the agent loop and models are the weakest signals: agent
// papers name the models they tested
const SPECIFIC_AREAS = ['Tools & MCP', 'Sub-agents', 'Context & memory', 'Sandbox & security', 'Science & physics', 'Browser & UI', 'Code generation'];
// arXiv primary category → area, used when the text names nothing more specific
const CATEGORY_AREAS: Record<string, string> = {
  'cs.cr': 'Sandbox & security',
  'cs.se': SE_FALLBACK,
  'cs.pl': SE_FALLBACK,
  'cs.cl': PROMPT_FALLBACK,
  'cs.ma': 'Sub-agents',
  'cs.ir': 'Context & memory',
  'cs.lg': 'Agent loop',
  'cs.ai': 'Agent loop',
};
// Papers are all AI research, so bare words relevance.ts avoids in general
// news ("memory", "GUI") are safe signals here
const PAPER_AREAS = [
  ...OPENCODE_AREAS,
  // …but not the hardware sense of memory (quantization, fine-tuning efficiency papers)
  { area: 'Context & memory', re: /(?<!\b(?:gpu|peak|optimizer|kv|activation|device|vram) )\bmemory\b(?![- ](?:efficient|footprint|usage|bandwidth|overhead|cost|consumption|savings?))|\bretrieval\b/i },
  { area: 'Browser & UI', re: /\bgui\b|\bbrowser\b|web (navigation|browsing)/i },
];
const EVAL_TITLE_RE = /bench|leaderboard|\bevals?\b|\bevaluat(e|es|ed|ing|ion|ions)\b|\bmeasuring\b/i;
// Title words that look like evaluation but are not about a benchmark
const NOT_EVAL_RE = /workbench|self[- ]evaluat\w*/gi;

function categoryArea(category = ''): string | undefined {
  const cat = category.toLowerCase();
  if (/^(physics\.|quant-ph$|math-ph$|math\.na$)/.test(cat)) return 'Science & physics';
  return CATEGORY_AREAS[cat];
}

/** Area → index of its first mention in `text`. */
function areaHits(text: string): Map<string, number> {
  const at = new Map<string, number>();
  for (const { area, re } of PAPER_AREAS) {
    const i = text.search(re);
    if (i >= 0 && i < (at.get(area) ?? Infinity)) at.set(area, i);
  }
  return at;
}

export interface PaperTarget {
  /** relevance.ts area name (or a category fallback) the idea lands in */
  area: string;
  /** Goal text naming the OpenCode files */
  where: string;
  /** A benchmark/eval paper: the goal is a regression scenario, not a feature */
  benchmark: boolean;
}

/**
 * The OpenCode area a paper most plausibly improves: a specific area named in
 * the title (most specific first), else the one the abstract mentions first,
 * else the arXiv primary category, then models (only without an agent angle),
 * then the agent loop.
 */
export function paperTarget(title: string, abstract = '', category?: string): PaperTarget {
  const inTitle = areaHits(title);
  const hits = areaHits(`${title} ${abstract}`);
  const benchmark = EVAL_TITLE_RE.test(title.replace(NOT_EVAL_RE, ' ')) || (hits.size === 1 && hits.has('Evaluation'));
  const byCategory = categoryArea(category);
  // Abstracts cite "scientific discovery" or "simulation" in passing, so science needs the title
  const inAbstract = SPECIFIC_AREAS.filter((a) => hits.has(a) && a !== 'Science & physics');
  const area = SPECIFIC_AREAS.find((a) => inTitle.has(a))
    ?? inAbstract.sort((a, b) => (hits.get(a) ?? 0) - (hits.get(b) ?? 0))[0]
    ?? (byCategory && byCategory !== 'Agent loop' ? byCategory : undefined)
    ?? (hits.has('Models & providers') && !hits.has('Agent loop') ? 'Models & providers' : 'Agent loop');
  return { area, where: AREA_TARGETS[area], benchmark };
}

/** Suggested upgrade goal for a research paper (plain text, names title and URL). */
export function paperGoal(title: string, url: string, abstract = '', category?: string): string {
  const { where, benchmark } = paperTarget(title, abstract, category);
  if (benchmark) {
    return `Read the paper "${title}" (${url}) and add a regression scenario inspired by its benchmark tasks to OpenCode's agent regression tests (tests/agent, scripted with the mock model in tests/helpers/mockLLM.ts) that exercises the ${where}. Pick one representative task, reproduce it at small scale and assert what a strong coding agent should do; if OpenCode falls short, fix it there without adding dependencies.`;
  }
  return `Read the paper "${title}" (${url}) and evaluate whether its method would measurably improve OpenCode's ${where}. If it would, implement a small version of it there behind a setting, without adding dependencies, with tests that show the difference.`;
}

/** Keywords (trimmed, original case) that appear in `text`, case-insensitively. */
export function matchKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const k of keywords) {
    const kw = typeof k === 'string' ? k.trim() : '';
    if (kw && lower.includes(kw.toLowerCase()) && !out.some((o) => o.toLowerCase() === kw.toLowerCase())) out.push(kw);
  }
  return out;
}

/** GET /api/daily_papers payload → items, keyword matches first, then by upvotes. */
export function parseHfDailyPapers(raw: unknown, keywords: string[] = []): DiscoverItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const ranked: { item: DiscoverItem; matched: number; order: number }[] = [];
  raw.forEach((entry, order) => {
    const e = asObj(entry);
    const p = asObj(e?.paper);
    if (!e || !p) return;
    const id = typeof p.id === 'string' ? p.id.trim() : '';
    if (!PAPER_ID_RE.test(id) || seen.has(id)) return;
    const url = safeUrl(`https://huggingface.co/papers/${encodeURIComponent(id)}`);
    const title = plainText(p.title ?? e.title, 200);
    if (!url || !title) return;
    seen.add(id);
    const abstract = plainText(p.summary ?? e.summary, 5000);
    const matched = matchKeywords(`${title} ${abstract}`, keywords);
    const authors = Array.isArray(p.authors) ? p.authors.map((a) => plainText(asObj(a)?.name, 60)) : [];
    const summary = paperSummary(authorLine(authors), abstract);
    const date = isoDate(p.publishedAt ?? e.publishedAt);
    const upvotes = typeof p.upvotes === 'number' && Number.isFinite(p.upvotes) ? Math.max(0, p.upvotes) : undefined;
    const tags = [...new Set([...matched.map((k) => k.toLowerCase()), 'paper'])];
    // Same key as the arXiv source, so the feed shows the paper once
    const arxivId = ARXIV_NEW_ID_RE.exec(id)?.[1];
    ranked.push({
      matched: matched.length,
      order,
      item: {
        id: `${SOURCE_ID}:${id}`,
        category: 'research',
        source: SOURCE_ID,
        sourceLabel: SOURCE_LABEL,
        title,
        url,
        ...(summary ? { summary } : {}),
        ...(date ? { date } : {}),
        ...(upvotes !== undefined ? { score: upvotes } : {}),
        tags,
        goal: paperGoal(title, url, abstract),
        ...(arxivId ? { canonicalId: `arxiv:${arxivId}` } : {}),
      },
    });
  });
  ranked.sort((a, b) => Number(b.matched > 0) - Number(a.matched > 0) || (b.item.score ?? 0) - (a.item.score ?? 0) || a.order - b.order);
  return ranked.slice(0, MAX_ITEMS).map((r) => r.item);
}

export const hfPapersSource: DiscoverSource = {
  id: SOURCE_ID,
  label: SOURCE_LABEL,
  category: 'research',
  // Daily list; upvotes move during the day
  ttlMs: 60 * 60_000,
  async fetch(fetchImpl, cfg: DiscoverConfig) {
    const raw = await getJson<unknown>(fetchImpl, API_URL);
    if (!Array.isArray(raw)) throw new Error('huggingface.co returned an unexpected daily papers payload');
    return parseHfDailyPapers(raw, cfg.keywords);
  },
};
