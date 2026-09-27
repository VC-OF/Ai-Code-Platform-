import { cleanText, getJson, githubHeaders, REPO_RE, safeUrl } from '../types';
import type { DiscoverConfig, DiscoverItem, DiscoverSource, FetchLike } from '../types';

/**
 * New GitHub repos: projects created in the last 30 days under the configured
 * topics (mcp-server, ai-agents, ...), merged across topics, most-starred first.
 */

const API = 'https://api.github.com';
const ID = 'github-new-repos';
const LABEL = 'New on GitHub';
const MAX_ITEMS = 15;
const MAX_TOPICS = 3;
const PER_TOPIC = 10;
const MIN_STARS = 20;
const WINDOW_DAYS = 30;
const TOPIC_RE = /^[a-z0-9-]{1,50}$/;
const MCP_SERVER_TOPIC_RE = /^mcp-servers?$|model-context-protocol/;

type Raw = Record<string, unknown>;

const asObj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);

function isoDate(v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Valid, de-duplicated topics, at most MAX_TOPICS (each costs one search request). */
export function validTopics(topics: unknown): string[] {
  if (!Array.isArray(topics)) return [];
  const valid = topics.filter((t): t is string => typeof t === 'string' && TOPIC_RE.test(t));
  return [...new Set(valid)].slice(0, MAX_TOPICS);
}

/** GitHub search URL for repos under `topic` created after `since` (YYYY-MM-DD). */
export function searchUrl(topic: string, since: string): string {
  const params = new URLSearchParams({
    q: `topic:${topic} created:>${since}`,
    sort: 'stars',
    order: 'desc',
    per_page: String(PER_TOPIC),
  });
  return `${API}/search/repositories?${params}`;
}

function goalFor(name: string, url: string, repoTopics: string[]): string {
  if (repoTopics.some((t) => MCP_SERVER_TOPIC_RE.test(t))) {
    return `Try ${name} (${url}), a new MCP server on GitHub, through OpenCode's MCP client. If its tools help coding or science workflows, add it as a documented option in OpenCode's MCP configuration (.platform/mcp.json or a project .mcp.json).`;
  }
  if (repoTopics.some((t) => t.includes('agent'))) {
    return `Study ${name} (${url}), a new agent project on GitHub: compare its agent loop, tool design, sub-agent handling and sandboxing with OpenCode's. Port any idea that would make OpenCode's coding agent more capable or reliable.`;
  }
  return `Evaluate ${name} (${url}), a new project on GitHub: decide whether OpenCode should adopt it as an agent tool, library or MCP server, and prototype the integration if it clearly helps OpenCode users.`;
}

/**
 * GitHub search payloads (one per topic) → items. Merges and de-duplicates by
 * full_name, drops forks, archived repos and repos under MIN_STARS stars.
 */
export function parseNewRepos(payloads: unknown[], topics: string[] = []): DiscoverItem[] {
  const wanted = new Set(topics);
  const seen = new Set<string>();
  const items: DiscoverItem[] = [];
  for (const payload of payloads) {
    const list = asObj(payload)?.items;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const repo = asObj(entry);
      if (!repo || repo.fork === true || repo.archived === true) continue;
      const fullName = repo.full_name;
      if (typeof fullName !== 'string' || !REPO_RE.test(fullName)) continue;
      const key = fullName.toLowerCase();
      const stars = repo.stargazers_count;
      if (seen.has(key) || typeof stars !== 'number' || !Number.isFinite(stars) || stars < MIN_STARS) continue;
      const url = safeUrl(repo.html_url);
      if (!url) continue;
      seen.add(key);
      const title = cleanText(fullName, 200);
      const repoTopics = Array.isArray(repo.topics)
        ? repo.topics.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase())
        : [];
      const language = cleanText(repo.language, 30).toLowerCase();
      const tags = [...new Set([...repoTopics.filter((t) => wanted.has(t)), ...(language ? [language] : [])])];
      const summary = cleanText(repo.description, 400);
      items.push({
        id: `${ID}:${key}`,
        category: 'tools',
        source: ID,
        sourceLabel: LABEL,
        title,
        url,
        ...(summary ? { summary } : {}),
        date: isoDate(repo.created_at),
        score: stars,
        tags,
        goal: goalFor(title, url, repoTopics),
      });
    }
  }
  const time = (i: DiscoverItem) => (i.date ? Date.parse(i.date) : 0);
  items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || time(b) - time(a) || a.id.localeCompare(b.id));
  return items.slice(0, MAX_ITEMS);
}

export const githubNewRepos: DiscoverSource = {
  id: ID,
  label: LABEL,
  category: 'tools',
  async fetch(fetchImpl: FetchLike, cfg: DiscoverConfig): Promise<DiscoverItem[]> {
    const topics = validTopics(cfg.topics);
    if (!topics.length) return [];
    const since = new Date((cfg.now ?? Date.now)() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const payloads = await Promise.all(
      topics.map((t) => getJson<unknown>(fetchImpl, searchUrl(t, since), githubHeaders(cfg))),
    );
    if (!payloads.some((p) => Array.isArray(asObj(p)?.items))) throw new Error('GitHub search returned an unexpected payload');
    return parseNewRepos(payloads, topics);
  },
};
