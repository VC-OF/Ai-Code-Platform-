import { OPENCODE_AREAS } from '../relevance';
import { getJson, plainText, safeUrl } from '../types';
import type { DiscoverConfig, DiscoverItem, DiscoverSource, FetchLike } from '../types';

/**
 * MCP servers published to the official MCP registry
 * (registry.modelcontextprotocol.io) in the last 12 hours, filtered to the
 * ones OpenCode's coding agent could use and ranked by relevance, with a
 * boost for servers new to the registry over version updates.
 */

const BASE = 'https://registry.modelcontextprotocol.io/v0/servers';
const ID = 'mcp-registry';
const LABEL = 'MCP registry';
const OFFICIAL = 'io.modelcontextprotocol.registry/official';
const MAX_ITEMS = 15;
// The registry lists servers by name, not date, in pages of ≤100 with a
// cursor. ~380 servers change per 12 h, so the whole window is read (up to
// MAX_PAGES) and then ranked; newest-first alone gives the last ~20 minutes.
const WINDOW_HOURS = 12;
const MAX_PAGES = 6;
const TYPE_RE = /^[a-z0-9-]{1,30}$/;
const IDENTIFIER_RE = /^[@A-Za-z0-9._/:-]{1,120}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
// _meta has no first-publish date, so a first-release version marks a new server
const FIRST_VERSION_RE = /^v?(?:0\.0\.\d+|0\.1\.0|1\.0\.0)(?:[-+][0-9A-Za-z.-]*)?$/;
/** New servers rank higher, in proportion, so a weak match stays weak */
const NEW_BOOST = 1.5;

// Every item is an MCP server and most say they are "for AI agents" or name a
// client, so these areas would match nearly all of them.
const GENERIC_AREAS = new Set(['Tools & MCP', 'Agent loop', 'Models & providers']);
/** Kinds of server OpenCode's coding agent would use; same-named areas merge. */
const MCP_AREAS: { area: string; re: RegExp }[] = [
  { area: 'Git & GitHub', re: /\bgit\b|github|gitlab|bitbucket|pull requests?|commit (?:messages?|history)|\bdiffs?\b/i },
  { area: 'Dev tools', re: /\bides?\b|language server|\blsp\b|\blint(?:er|ing)\b|eslint|compiler|debugger|\bshell\b|terminal|file ?system|\bcode (?:execution|search|index|map|graph|reading)|unit tests?|test runners?|end-to-end tests?/i },
  { area: 'Docs', re: /\bdocs\b|documentation|api references?/i },
  { area: 'Browser & UI', re: /\bbrowsers?\b|puppeteer|selenium|headless|\bscrap(?:e|er|ing)\b|\bcrawl/i },
  { area: 'Context & memory', re: /\bmemory\b|knowledge graph|\bembeddings?\b/i },
  { area: 'Databases', re: /databases?|\bsql\b|postgres|mysql|sqlite|mongo|redis|supabase|vector (?:db|store|search)/i },
  { area: 'Search', re: /web search|search engine|semantic search|full-text search|code search|search the (?:web|internet)/i },
  { area: 'Science & physics', re: /\bmath|arxiv|pubmed|wolfram|symbolic|equations?|statistic|\bchemi(?:stry|cal)|biolog|jupyter|latex|\bcad\b|scientists?|literature/i },
];
const AREAS = [...OPENCODE_AREAS.filter((a) => !GENERIC_AREAS.has(a.area)), ...MCP_AREAS];
// Said by nearly every server; removed before matching keywords and topics
const BOILERPLATE_RE = /\b(?:ai|llm|your)[- ](?:agents?|assistants?|models?|clients?)\b|\bmcp(?:[- ](?:servers?|clients?|tools?))?\b|model context protocol|\bagentic\b/gi;

type Raw = Record<string, unknown>;
type Terms = Pick<DiscoverConfig, 'keywords' | 'topics'>;
type Matcher = { term: string; re: RegExp };

const asObj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const asList = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(asObj).filter((x): x is Raw => !!x) : []);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isoDate(v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Registry request: latest versions updated within WINDOW_HOURS of `now`. */
export function registryUrl(now: number, cursor?: string): string {
  const params = new URLSearchParams({
    limit: '100',
    version: 'latest',
    // Rounded to 10 minutes so repeated refreshes hit the registry's cache
    updated_since: new Date(Math.floor((now - WINDOW_HOURS * 3_600_000) / 600_000) * 600_000).toISOString(),
  });
  if (cursor) params.set('cursor', cursor);
  return `${BASE}?${params}`;
}

/** First-release version numbers (0.0.x, 0.1.0, 1.0.0) look like a new server. */
export function looksNew(version: unknown): boolean {
  return typeof version === 'string' && FIRST_VERSION_RE.test(version.trim());
}

/** A keyword or topic ("coding agent", "coding-agent") as a whole-phrase matcher. */
function termMatcher(term: string): Matcher | null {
  const words = term.replace(BOILERPLATE_RE, ' ').toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);
  if (!words.length) return null;
  // Word separators may be spaces, dashes, dots, slashes or underscores ("Node.js", "CI/CD")
  return { term, re: new RegExp(`(?<![a-z0-9])${words.map(escapeRe).join('[\\s._/-]+')}s?(?![a-z0-9])`, 'i') };
}

/** Keywords, then topics; one matcher per phrase ("coding agent" = "coding-agent"). */
function termMatchers(cfg: Terms): Matcher[] {
  const terms = [...(cfg.keywords ?? []), ...(cfg.topics ?? [])].filter((t): t is string => typeof t === 'string');
  const bySource = new Map<string, Matcher>();
  for (const m of terms.map(termMatcher)) if (m && !bySource.has(m.re.source)) bySource.set(m.re.source, m);
  return [...bySource.values()];
}

function relevance(title: string, description: string, matchers: Matcher[]) {
  const text = `${title} ${description}`;
  const areas = [...new Set(AREAS.filter((a) => a.re.test(text)).map((a) => a.area))];
  const titleAreas = new Set(AREAS.filter((a) => a.re.test(title)).map((a) => a.area)).size;
  const plain = text.replace(BOILERPLATE_RE, ' ');
  const terms = [...new Set(matchers.filter((m) => m.re.test(plain)).map((m) => m.term))];
  return { score: areas.length * 2 + titleAreas + terms.length * 2, areas, terms };
}

/**
 * How useful a server looks to OpenCode, from its title and description:
 * 2 per OpenCode area matched (+1 when the title matches it) and 2 per
 * configured keyword or topic found.
 */
export function mcpRelevance(title: string, description: string, cfg: Terms): { score: number; areas: string[]; terms: string[] } {
  return relevance(title, description, termMatchers(cfg));
}

/** How to reach the server, for the goal: a remote endpoint or a package. */
function accessHint(remotes: Raw[], packages: Raw[]): string {
  for (const r of remotes) {
    const url = safeUrl(r.url);
    const type = typeof r.type === 'string' && TYPE_RE.test(r.type) ? r.type : 'remote';
    if (url) return `, reachable as a ${type} endpoint at ${url}`;
  }
  for (const p of packages) {
    const type = typeof p.registryType === 'string' && TYPE_RE.test(p.registryType) ? p.registryType : '';
    // mcpb identifiers are URLs: only http(s) ones are shown
    const id = typeof p.identifier === 'string' && IDENTIFIER_RE.test(p.identifier) && (!p.identifier.includes('://') || safeUrl(p.identifier)) ? p.identifier : '';
    if (type && id) {
      return `, installable as the ${type} package ${id}`;
    }
  }
  return '';
}

const listOf = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');

function goalFor(s: { title: string; url: string; access: string; isNew: boolean; version: string | null; areas: string[]; terms: string[] }): string {
  const why = s.areas.length
    ? ` It looks relevant to OpenCode's ${listOf(s.areas.slice(0, 3))} work.`
    : s.terms.length ? ` It matches the Discover keywords ${listOf(s.terms.slice(0, 3).map((t) => `"${t}"`))}.` : '';
  const config = "OpenCode's MCP configuration (.platform/mcp.json or a project .mcp.json)";
  const client = "OpenCode's MCP client (src/lib/mcpClient.ts)";
  const noDeps = ' Run it through its own command or endpoint; do not add it to package.json.';
  if (s.isNew) {
    return (
      `Evaluate ${s.title} (${s.url}), an MCP server new to the official MCP registry${s.access}.${why} ` +
      `Connect it through ${client}, check that its tools load and behave well in the agent loop (src/lib/agentLoop.ts), ` +
      `and if they help coding or science workflows, add it as a documented, opt-in option in ${config}.${noDeps}`
    );
  }
  return (
    `Re-check ${s.title} (${s.url}), an MCP server just updated${s.version ? ` to version ${s.version}` : ''} in the official MCP registry${s.access}.${why} ` +
    `If ${config} already lists it, confirm the new version still connects through ${client} and update the entry; ` +
    `otherwise try its tools in the agent loop (src/lib/agentLoop.ts) and add it as a documented, opt-in option if they help coding or science workflows.${noDeps}`
  );
}

/**
 * Registry `/v0/servers` payload → items: active latest versions with a
 * description that match an OpenCode area, keyword or topic, ranked by
 * relevance (×NEW_BOOST for new servers), then by publish date.
 */
export function parseRegistry(raw: unknown, cfg: Terms = { keywords: [], topics: [] }): DiscoverItem[] {
  const byName = new Map<string, { server: Raw; time: number; date?: string }>();
  for (const entry of asList(asObj(raw)?.servers)) {
    const server = asObj(entry.server);
    const meta = asObj(asObj(entry._meta)?.[OFFICIAL]);
    if (!server || !meta || meta.status !== 'active' || meta.isLatest !== true) continue;
    const name = plainText(server.name, 200);
    if (!name) continue;
    const date = isoDate(meta.publishedAt);
    const time = date ? Date.parse(date) : 0;
    const prev = byName.get(name);
    if (prev && prev.time >= time) continue;
    byName.set(name, { server, time, date });
  }

  const matchers = termMatchers(cfg);
  const ranked: { item: DiscoverItem; rank: number; time: number }[] = [];
  for (const [name, { server, time, date }] of byName) {
    const summary = plainText(server.description, 400);
    if (!summary) continue;
    const ownTitle = plainText(server.title, 200);
    const title = ownTitle || name;
    // Untitled: match the last name segment, as `io.github.*` namespaces say nothing
    const rel = relevance(ownTitle || name.slice(name.lastIndexOf('/') + 1), summary, matchers);
    if (!rel.areas.length && !rel.terms.length) continue;
    const url =
      safeUrl(asObj(server.repository)?.url) ??
      safeUrl(server.websiteUrl) ??
      `${BASE}?search=${encodeURIComponent(name)}`;
    const remotes = asList(server.remotes);
    const packages = asList(server.packages);
    const registryTypes = packages
      .map((p) => (typeof p.registryType === 'string' ? p.registryType.toLowerCase() : ''))
      .filter((t) => TYPE_RE.test(t));
    const isNew = looksNew(server.version);
    const version = typeof server.version === 'string' && VERSION_RE.test(server.version) ? server.version : null;
    ranked.push({
      rank: rel.score * (isNew ? NEW_BOOST : 1),
      time,
      item: {
        id: `${ID}:${name}`,
        category: 'tools',
        source: ID,
        sourceLabel: LABEL,
        title,
        url,
        summary,
        date,
        tags: [...new Set(['mcp', isNew ? 'new' : 'update', ...(remotes.length ? ['remote'] : []), ...registryTypes])],
        goal: goalFor({ title, url, access: accessHint(remotes, packages), isNew, version, areas: rel.areas, terms: rel.terms }),
      },
    });
  }
  return ranked
    .sort((a, b) => b.rank - a.rank || b.time - a.time || a.item.id.localeCompare(b.item.id))
    .slice(0, MAX_ITEMS)
    .map((x) => x.item);
}

export const mcpRegistry: DiscoverSource = {
  id: ID,
  label: LABEL,
  category: 'tools',
  async fetch(fetchImpl: FetchLike, cfg: DiscoverConfig): Promise<DiscoverItem[]> {
    const now = (cfg.now ?? Date.now)();
    const servers: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      let raw: Raw | null;
      try {
        // The registry is sometimes slow (15–25 s cold); allow more than the default
        raw = asObj(await getJson<unknown>(fetchImpl, registryUrl(now, cursor), {}, 35_000));
      } catch (err) {
        // A later page failing keeps what the earlier pages returned
        if (page > 0) break;
        throw err;
      }
      if (!raw || !Array.isArray(raw.servers)) {
        if (page > 0) break;
        throw new Error('MCP registry returned an unexpected payload');
      }
      servers.push(...raw.servers);
      const next = asObj(raw.metadata)?.nextCursor;
      if (typeof next !== 'string' || !next || next === cursor) break;
      cursor = next;
    }
    return parseRegistry({ servers }, cfg);
  },
};
