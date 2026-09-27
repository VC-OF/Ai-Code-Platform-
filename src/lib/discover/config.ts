import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { REPO_RE, type DiscoverConfig } from './types';

/** User-editable Discover settings, stored in .platform/discover.json. */
export interface DiscoverSettings {
  /** Research phrases (arXiv, papers) */
  keywords: string[];
  /** Short headline words for Hacker News */
  newsKeywords: string[];
  watchedRepos: string[];
  topics: string[];
  /** Override for OpenCode's own GitHub repo; null = detect from `origin` */
  repo: string | null;
  /** Server-local hour (0–23) after which the daily "Today in AI" digest is built */
  digestHour: number;
}

export const DEFAULT_SETTINGS: DiscoverSettings = {
  keywords: ['coding agent', 'tool use', 'LLM agents', 'Model Context Protocol', 'code generation'],
  newsKeywords: ['LLM', 'AI agent', 'coding agent', 'MCP'],
  watchedRepos: [
    'ollama/ollama',
    'modelcontextprotocol/typescript-sdk',
    'openai/openai-node',
    'anthropics/anthropic-sdk-typescript',
    'vercel/ai',
    'vercel/next.js',
    'microsoft/playwright',
  ],
  topics: ['mcp-server', 'ai-agents', 'coding-agent'],
  repo: null,
  digestHour: 8,
};

export const TOPIC_RE = /^[a-z0-9-]{1,50}$/;
/** topics matches the new-repos adapter, which queries at most 3 (one GitHub search each) */
export const LIMITS = { keywords: 10, newsKeywords: 4, watchedRepos: 20, topics: 3 };

function settingsFile(root: string) {
  return path.join(root, '.platform', 'discover.json');
}

/** Validate untrusted input (API body or the settings file). Throws with a user-facing message. */
export function validateSettings(input: unknown): DiscoverSettings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const list = (key: 'keywords' | 'newsKeywords' | 'watchedRepos' | 'topics', check: (s: string) => boolean, what: string) => {
    const v = o[key] ?? DEFAULT_SETTINGS[key];
    if (!Array.isArray(v)) throw new Error(`${key} must be a list`);
    const items = [...new Set(v.map((s) => String(s).trim()).filter(Boolean))];
    if (items.length > LIMITS[key]) throw new Error(`At most ${LIMITS[key]} ${key}`);
    for (const s of items) if (!check(s)) throw new Error(`Invalid ${what}: "${s.slice(0, 80)}"`);
    return items;
  };
  const repo = o.repo === undefined || o.repo === null || o.repo === '' ? null : String(o.repo).trim();
  if (repo !== null && !REPO_RE.test(repo)) throw new Error(`Invalid repository "${repo.slice(0, 80)}" — use owner/name`);
  const hour = o.digestHour === undefined ? DEFAULT_SETTINGS.digestHour : Number(o.digestHour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('digestHour must be a whole hour from 0 to 23');
  return {
    keywords: list('keywords', (s) => s.length <= 60 && !/[\r\n]/.test(s), 'keyword'),
    newsKeywords: list('newsKeywords', (s) => s.length <= 60 && !/[\r\n]/.test(s), 'news keyword'),
    watchedRepos: list('watchedRepos', (s) => REPO_RE.test(s), 'repository (use owner/name)'),
    topics: list('topics', (s) => TOPIC_RE.test(s), 'topic (lowercase letters, digits and dashes)'),
    repo,
    digestHour: hour,
  };
}

export function loadSettings(root: string): DiscoverSettings {
  try {
    return validateSettings(JSON.parse(fs.readFileSync(settingsFile(root), 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(root: string, settings: DiscoverSettings): DiscoverSettings {
  const valid = validateSettings(settings);
  fs.mkdirSync(path.dirname(settingsFile(root)), { recursive: true });
  fs.writeFileSync(settingsFile(root), JSON.stringify(valid, null, 2));
  return valid;
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'ssh.github.com']);

/** `owner/name` from a GitHub remote (https, ssh://, or scp-style git@host:path), else null. */
export function parseGithubRemote(remote: string): string | null {
  const raw = remote.trim();
  let host: string;
  let repoPath: string;
  const scp = raw.match(/^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    host = scp[1];
    repoPath = scp[2];
  } else {
    try {
      const u = new URL(raw);
      host = u.hostname;
      repoPath = u.pathname;
    } catch {
      return null;
    }
  }
  if (!GITHUB_HOSTS.has(host.toLowerCase())) return null;
  const parts = repoPath.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
  if (parts.length !== 2) return null;
  const repo = `${parts[0]}/${parts[1]}`;
  return REPO_RE.test(repo) ? repo : null;
}

const repoCache = new Map<string, { repo: string | null; at: number }>();
const REPO_TTL_MS = 5 * 60_000;

/** The `origin` remote's GitHub repo, remembered for a few minutes (git spawns are synchronous). */
export function detectRepo(root: string): string | null {
  const hit = repoCache.get(root);
  if (hit && Date.now() - hit.at < REPO_TTL_MS) return hit.repo;
  let repo: string | null = null;
  try {
    repo = parseGithubRemote(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 5_000 }));
  } catch {}
  repoCache.set(root, { repo, at: Date.now() });
  return repo;
}

export function buildConfig(root: string, settings = loadSettings(root)): DiscoverConfig {
  return {
    keywords: settings.keywords,
    newsKeywords: settings.newsKeywords,
    watchedRepos: settings.watchedRepos,
    topics: settings.topics,
    repo: settings.repo ?? detectRepo(root),
    root,
    githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined,
  };
}

/** GITHUB_TOKEN / GH_TOKEN from Settings → API keys (global), then the environment. */
export async function resolveGithubToken(): Promise<string | undefined> {
  try {
    const { getDecryptedEnv } = await import('../settingsStore');
    const env = await getDecryptedEnv();
    return env.GITHUB_TOKEN || env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
  } catch {
    return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
  }
}
