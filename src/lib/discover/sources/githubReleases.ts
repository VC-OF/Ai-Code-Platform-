/**
 * Recent releases of the GitHub repos OpenCode watches (SDKs, MCP, runtimes).
 */
import {
  cleanText,
  getJson,
  githubHeaders,
  plainText,
  REPO_RE,
  safeUrl,
  type DiscoverConfig,
  type DiscoverItem,
  type DiscoverSource,
  type FetchLike,
} from '../types';

const SOURCE = 'github-releases';
const LABEL = 'GitHub releases';
const WINDOW_MS = 45 * 24 * 3600_000;
// Still one request per repo; 30 reaches past a week of canaries or a monorepo's sub-package train
const PER_PAGE = 30;
const MAX_REPOS = 20; // unauthenticated GitHub allows 60 requests/hour
const MAX_ITEMS = 15;
const PER_REPO_SHOWN = 2;
const MAX_NAME = 60;
const MAX_TITLE = 200;
const TIMEOUT_MS = 15_000;

interface GhRelease {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  reactions?: { total_count?: unknown } | null;
}

// Where a release of a watched repo most likely lands in OpenCode.
const REPO_AREAS: [RegExp, string][] = [
  [/^modelcontextprotocol\//i, 'MCP client (src/lib/mcpClient.ts, src/lib/mcpTransports.ts)'],
  [/^openai\//i, 'LLM client (src/lib/llmClient.ts), including request, streaming and tool-call handling'],
  [/^anthropics\//i, 'LLM client (src/lib/llmClient.ts) and model list (src/lib/models.ts), including new models, tool use and caching'],
  [/^ollama\//i, 'local-model support in the LLM client (src/lib/llmClient.ts, src/lib/models.ts)'],
  [/^vercel\/next\.js$/i, 'Next.js app (next.config.ts, src/app)'],
  [/^vercel\/ai$/i, 'agent loop (src/lib/agentLoop.ts) and LLM client, including streaming and tool-calling patterns'],
  [/playwright/i, 'browser tools (src/lib/browserTools.ts) and e2e tests'],
  [/docker|moby/i, 'sandboxed execution (src/lib/dockerService.ts)'],
];

function areaFor(repo: string): string {
  return (
    REPO_AREAS.find(([re]) => re.test(repo))?.[1] ??
    'agent loop (src/lib/agentLoop.ts), tools (src/lib/tools.ts) or MCP client (src/lib/mcpClient.ts)'
  );
}

/** `owner/name` per REPO_RE; also rejects `.`/`..` names, which would rewrite the URL path. */
export function isWatchableRepo(repo: unknown): repo is string {
  return typeof repo === 'string' && REPO_RE.test(repo) && !/\/\.{1,2}$/.test(repo);
}

/** Release notes are Markdown; keep the words, drop the syntax and changelog links. */
export function markdownToText(md: unknown): string {
  if (typeof md !== 'string') return '';
  return md
    .replace(/^\s*\**Full Changelog\**:.*$/gim, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*|__|`/g, '');
}

/** A tag's package prefix and version: 'ai@7.0.1' → ai, '@ai-sdk/gateway@4.0.96' → @ai-sdk/gateway,
 *  'vertex-sdk-v0.19.11' → vertex-sdk; 'v16.4.0-canary.5' and '1.30.1' have none. */
export function splitTag(tag: string): { pkg: string; version: string } {
  const m = tag.match(/^(.+?)[@/_-]v?(\d[\w.+-]*)$/);
  // 'v1.0.0-beta-2' is a version with a suffix, not package 'v1.0.0-beta'
  if (!m || /^v?\d/i.test(m[1])) return { pkg: '', version: tag.replace(/^v(?=\d)/i, '') };
  return { pkg: m[1], version: m[2] };
}

/** A monorepo's main package: no prefix, or a package name made of words of the repo name
 *  ('sdk' in anthropic-sdk-typescript, 'ai' in vercel/ai — not 'vertex-sdk' or '@ai-sdk/gateway'). */
export function isMainPackage(pkg: string, repo: string): boolean {
  if (!pkg) return true;
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const repoWords = new Set(words(repo.slice(repo.indexOf('/') + 1)));
  const name = words(pkg.replace(/^@[^/]*\//, ''));
  return name.length > 0 && name.every((w) => repoWords.has(w));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The release name when it adds something to the tag: 'sdk: v0.65.0' for tag 'sdk-v0.65.0' or
 *  'v0.40.0' for 'v0.40.0-rc0' does not; 'v2.0.0: Agents' for 'v2.0.0' adds 'Agents'. */
function nameSuffix(tag: string, name: string): string {
  if (!name || norm(tag).includes(norm(name))) return '';
  const rest = name.toLowerCase().startsWith(tag.toLowerCase()) ? name.slice(tag.length).replace(/^[\s:–—-]+/, '') : name;
  return rest && Array.from(rest).length <= MAX_NAME ? ` — ${rest}` : '';
}

/** Tag and name are plain text decoded once already, so only clip here (by code point). */
function releaseTitle(repo: string, tag: string, name: string): string {
  const chars = Array.from(`${repo} ${tag}${nameSuffix(tag, name)}`);
  return chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join('').trimEnd()}…` : chars.join('');
}

function isMajor(tag: string): boolean {
  const m = tag.match(/(\d+)\.(\d+)\.(\d+)/);
  return !!m && Number(m[1]) >= 1 && m[2] === '0' && m[3] === '0';
}

function releaseGoal(repo: string, title: string, url: string, prerelease: boolean): string {
  const read = `Read the release notes for ${title} (${url}) and work out what they mean for OpenCode's ${areaFor(repo)}. `;
  if (prerelease) {
    return `${read}This is a prerelease: assess what it would let OpenCode do and what it would break, and record the findings without shipping code that depends on it.`;
  }
  return (
    `${read}Adapt OpenCode's code to the new capabilities and deprecations that matter, in ways that keep working ` +
    'with the version installed now, and add tests. The version bump itself is applied manually, not by this upgrade.'
  );
}

interface Release {
  item: DiscoverItem;
  tag: string;
  prerelease: boolean;
}

function parseReleases(payload: unknown, repo: string, now: number): Release[] {
  if (!Array.isArray(payload)) return [];
  const out: Release[] = [];
  for (const rel of payload as GhRelease[]) {
    if (!rel || typeof rel !== 'object' || rel.draft === true) continue;
    const tag = plainText(rel.tag_name, 100);
    const url = safeUrl(rel.html_url);
    const published = typeof rel.published_at === 'string' ? Date.parse(rel.published_at) : NaN;
    if (!tag || !url || !Number.isFinite(published) || published < now - WINDOW_MS) continue;
    const prerelease = rel.prerelease === true;
    const title = releaseTitle(repo, tag, plainText(rel.name, 200));
    const summary = cleanText(markdownToText(rel.body), 400);
    const reactions = rel.reactions?.total_count;
    out.push({
      tag,
      prerelease,
      item: {
        id: `${SOURCE}:${repo.toLowerCase()}:${tag}`,
        category: 'updates',
        source: SOURCE,
        sourceLabel: LABEL,
        title,
        url,
        ...(summary ? { summary } : {}),
        date: new Date(published).toISOString(),
        ...(typeof reactions === 'number' && Number.isFinite(reactions) ? { score: reactions } : {}),
        tags: [prerelease ? 'prerelease' : 'release', ...(isMajor(tag) ? ['major'] : [])],
        goal: releaseGoal(repo, title, url, prerelease),
      },
    });
  }
  return out;
}

/** GitHub `/releases` payload for `repo` → non-draft releases published in the 45 days before `now`. */
export function parseGithubReleases(payload: unknown, repo: string, now: number): DiscoverItem[] {
  return parseReleases(payload, repo, now).map((r) => r.item);
}

/**
 * The releases of one repo worth showing, so patch trains, canaries and a monorepo's
 * sub-packages do not crowd out the rest: main package before sub-packages, stable before
 * prerelease, the package's newest major before backports to an older one, newest first.
 */
export function pickRepoReleases(payload: unknown, repo: string, now: number, limit = PER_REPO_SHOWN): DiscoverItem[] {
  const ranked = parseReleases(payload, repo, now).map((r) => {
    const { pkg, version } = splitTag(r.tag);
    return { ...r, pkg, major: Number.parseInt(version, 10), main: isMainPackage(pkg, repo) };
  });
  const newestMajor = new Map<string, number>();
  for (const r of ranked) {
    if (!r.prerelease && Number.isFinite(r.major)) newestMajor.set(r.pkg, Math.max(newestMajor.get(r.pkg) ?? r.major, r.major));
  }
  const backport = (r: (typeof ranked)[number]) => !r.prerelease && r.major < (newestMajor.get(r.pkg) ?? -Infinity);
  return ranked
    .sort(
      (a, b) =>
        Number(!a.main) - Number(!b.main) ||
        Number(a.prerelease) - Number(b.prerelease) ||
        Number(backport(a)) - Number(backport(b)) ||
        (b.item.date ?? '').localeCompare(a.item.date ?? ''),
    )
    .slice(0, limit)
    .map((r) => r.item);
}

/** Valid, distinct watched repos (case-insensitive), capped for the rate limit. */
export function pickRepos(repos: unknown): string[] {
  if (!Array.isArray(repos)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of repos) {
    const repo = typeof r === 'string' ? r.trim() : r;
    if (!isWatchableRepo(repo) || seen.has(repo.toLowerCase())) continue;
    seen.add(repo.toLowerCase());
    out.push(repo);
    if (out.length === MAX_REPOS) break;
  }
  return out;
}

export const githubReleasesSource: DiscoverSource = {
  id: SOURCE,
  label: LABEL,
  category: 'updates',
  async fetch(fetchImpl: FetchLike, cfg: DiscoverConfig): Promise<DiscoverItem[]> {
    const repos = pickRepos(cfg.watchedRepos);
    if (!repos.length) return [];
    const now = cfg.now?.() ?? Date.now();
    const headers = githubHeaders(cfg);
    const results = await Promise.allSettled(
      repos.map(async (repo) => {
        try {
          const url = `https://api.github.com/repos/${repo}/releases?per_page=${PER_PAGE}`;
          return pickRepoReleases(await getJson<unknown>(fetchImpl, url, headers, TIMEOUT_MS), repo, now);
        } catch (err) {
          throw new Error(`${repo}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    // One broken or renamed repo must not hide the others
    if (!ok.length) {
      const first = (results[0] as PromiseRejectedResult).reason as Error;
      throw new Error(`GitHub releases failed for all ${repos.length} watched repos; first error: ${first.message}`);
    }
    return ok
      .flat()
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, MAX_ITEMS);
  },
};
