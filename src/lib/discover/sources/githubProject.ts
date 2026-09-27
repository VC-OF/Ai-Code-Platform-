import { cleanText, getJson, githubHeaders, plainText, REPO_RE, safeUrl } from '../types';
import type { DiscoverConfig, DiscoverItem, DiscoverSource } from '../types';

/**
 * OpenCode's own GitHub repo: open issues to fix and failing CI checks on the
 * default branch. Both sources throw when cfg.repo is unknown, so the UI can
 * say where to set it; a known repo with no issues (or green CI) gives [].
 */

const API = 'https://api.github.com';
const MAX_ITEMS = 15;
const ISSUES_ID = 'github-issues';
const ISSUES_LABEL = 'Open issues';
const CI_ID = 'github-ci';
const CI_LABEL = 'CI status';
const FAILING = new Set(['failure', 'timed_out', 'cancelled', 'action_required']);
const CONCLUSION_TEXT: Record<string, string> = {
  failure: 'failed',
  timed_out: 'timed out',
  cancelled: 'was cancelled',
  action_required: 'needs action',
};
export const REPO_UNKNOWN = "OpenCode's GitHub repository is unknown — set it under Discover → Sources (owner/name).";
const NO_PACKAGE_JSON = "If the fix needs a dependency bump, don't edit package.json — say which one; the bump is applied manually.";

type Raw = Record<string, unknown>;

const asObj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);

function isoDate(v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Clip text that is already clean (running plainText again would decode entities twice). */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

function repoOf(cfg: DiscoverConfig): string {
  if (typeof cfg.repo !== 'string' || !REPO_RE.test(cfg.repo)) throw new Error(REPO_UNKNOWN);
  return cfg.repo;
}

/** Issue bodies and check-run output are Markdown; keep the prose for the summary. */
function markdownToText(md: unknown): string {
  if (typeof md !== 'string') return '';
  return md
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\*\*|__|~~|`/g, '');
}

// A code span: a backtick run, then content, then a run of the same length
const CODE_SPAN = /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
// Paired **x**, __x__, ~~x~~ opening and closing at word edges, so `2**10` survives
const EMPHASIS = /(^|[\s([{"'])(\*\*|__|~~)(?=\S)([\s\S]+?)(?<=\S)\2(?=$|[\s)\]}"'.,:;!?])/g;
const MASK = /(\d+)/g;

/**
 * Issue titles are plain text that people sprinkle with inline Markdown.
 * Keep code as written (`__init__`, `Array<T>`, `**kwargs`) and drop only
 * backticks around code and paired emphasis markers.
 */
export function titleToText(title: unknown, max = 180): string {
  if (typeof title !== 'string') return '';
  const code: string[] = [];
  // Mask code spans so emphasis never matches inside them
  const masked = title
    .replace(/[]/g, '')
    .replace(CODE_SPAN, (_m, _run, body: string) => `${code.push(body) - 1}`);
  // __x__ only around several words: a single word may be a dunder like __init__
  // Nested emphasis ("**a _b_ c**") needs more than one pass; bounded
  let text = masked;
  for (let pass = 0; pass < 3; pass++) {
    const next = text.replace(EMPHASIS, (m, pre: string, mark: string, inner: string) => (mark === '__' && !/\s/.test(inner) ? m : pre + inner));
    if (next === text) break;
    text = next;
  }
  text = text.replace(MASK, (_m, i: string) => code[Number(i)]);
  return plainText(text, max);
}

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  const names = labels
    .map((l) => plainText(typeof l === 'string' ? l : asObj(l)?.name, 30).toLowerCase())
    .filter(Boolean);
  return [...new Set(names)].slice(0, 4);
}

// ─── Issues ──────────────────────────────────────────────────────────────────

/** GitHub `/repos/{repo}/issues` payload → items. Pull requests are dropped. */
export function parseIssues(raw: unknown): DiscoverItem[] {
  if (!Array.isArray(raw)) return [];
  const items: DiscoverItem[] = [];
  for (const entry of raw) {
    if (items.length >= MAX_ITEMS) break;
    const issue = asObj(entry);
    if (!issue || issue.pull_request != null) continue;
    const n = issue.number;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) continue;
    const url = safeUrl(issue.html_url);
    const name = titleToText(issue.title, 180);
    if (!url || !name) continue;
    const summary = cleanText(markdownToText(issue.body), 400);
    items.push({
      id: `${ISSUES_ID}:${n}`,
      category: 'project',
      source: ISSUES_ID,
      sourceLabel: ISSUES_LABEL,
      title: clip(`#${n} ${name}`, 200),
      url,
      ...(summary ? { summary } : {}),
      date: isoDate(issue.updated_at),
      score: typeof issue.comments === 'number' ? issue.comments : undefined,
      tags: [...labelNames(issue.labels), 'issue'],
      goal: `Fix issue #${n} "${name}" (${url}) in OpenCode: reproduce it, find the root cause in the affected code, fix it and add a regression test under tests/. ${NO_PACKAGE_JSON}`,
    });
  }
  return items;
}

export const githubIssues: DiscoverSource = {
  id: ISSUES_ID,
  label: ISSUES_LABEL,
  category: 'project',
  async fetch(fetchImpl, cfg: DiscoverConfig) {
    const repo = repoOf(cfg);
    const raw = await getJson<unknown>(fetchImpl, `${API}/repos/${repo}/issues?state=open&per_page=30&sort=updated`, githubHeaders(cfg));
    return parseIssues(raw);
  },
};

// ─── CI ──────────────────────────────────────────────────────────────────────

function runTime(run: Raw): number {
  const t = Date.parse(String(run.started_at ?? run.completed_at ?? ''));
  return Number.isNaN(t) ? 0 : t;
}

/**
 * GitHub `/commits/{ref}/check-runs` payload → one item per check whose
 * latest run did not pass. Re-runs share a name, so older runs are ignored.
 */
export function parseCheckRuns(raw: unknown, branch: string): DiscoverItem[] {
  const runs = asObj(raw)?.check_runs;
  if (!Array.isArray(runs)) return [];
  const latest = new Map<string, Raw>();
  for (const entry of runs) {
    const run = asObj(entry);
    const name = plainText(run?.name, 120);
    if (!run || !name) continue;
    const prev = latest.get(name);
    const newer = !prev || runTime(run) > runTime(prev) || (runTime(run) === runTime(prev) && Number(run.id) > Number(prev.id));
    if (newer) latest.set(name, run);
  }
  const ref = plainText(branch, 100);
  const items: DiscoverItem[] = [];
  for (const [name, run] of latest) {
    if (items.length >= MAX_ITEMS) break;
    const conclusion = typeof run.conclusion === 'string' ? run.conclusion : '';
    if (!FAILING.has(conclusion)) continue;
    const url = safeUrl(run.html_url) ?? safeUrl(run.details_url);
    if (!url) continue;
    const output = asObj(run.output);
    const sha = typeof run.head_sha === 'string' ? ` at ${run.head_sha.slice(0, 7)}` : '';
    // Check-run output from GitHub Apps (CodeQL etc.) is Markdown
    const details = [cleanText(markdownToText(output?.title), 200), cleanText(markdownToText(output?.summary), 400)].filter(Boolean).join(': ');
    items.push({
      id: `${CI_ID}:${ref}:${name}`,
      category: 'project',
      source: CI_ID,
      sourceLabel: CI_LABEL,
      title: clip(`CI: ${name} failing on ${ref}`, 200),
      url,
      summary: clip(`The "${name}" check ${CONCLUSION_TEXT[conclusion]} on ${ref}${sha}.${details ? ` ${details}` : ''}`, 400),
      date: isoDate(run.completed_at),
      tags: ['ci', conclusion],
      goal: `Make OpenCode's "${name}" CI check pass on ${ref} again (${url}): read the failing job log, find the root cause and fix it in the code or the workflow, without skipping or weakening the check. ${NO_PACKAGE_JSON}`,
    });
  }
  return items;
}

export const githubCi: DiscoverSource = {
  id: CI_ID,
  label: CI_LABEL,
  category: 'project',
  async fetch(fetchImpl, cfg: DiscoverConfig) {
    const repoName = repoOf(cfg);
    const headers = githubHeaders(cfg);
    const repo = asObj(await getJson<unknown>(fetchImpl, `${API}/repos/${repoName}`, headers));
    const branch = repo?.default_branch;
    if (typeof branch !== 'string' || !branch.trim()) throw new Error(`GitHub reported no default branch for ${repoName}`);
    const raw = await getJson<unknown>(fetchImpl, `${API}/repos/${repoName}/commits/${encodeURIComponent(branch)}/check-runs?per_page=100`, headers);
    return parseCheckRuns(raw, branch);
  },
};
