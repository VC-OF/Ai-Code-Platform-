import fs from 'fs/promises';
import path from 'path';
import { cleanText, getJson, safeUrl } from '../types';
import type { DiscoverConfig, DiscoverItem, DiscoverSource, FetchLike } from '../types';

/**
 * OpenCode's own outdated npm dependencies: package.json dependencies and
 * devDependencies compared with the registry's `latest` dist-tag. Only
 * outdated packages are returned, most disruptive (major) first.
 */

const SOURCE_ID = 'npm-updates';
const SOURCE_LABEL = 'npm updates';
const REGISTRY = 'https://registry.npmjs.org';
const MAX_ITEMS = 15;
const CONCURRENCY = 6;
const TIMEOUT_MS = 10_000;

export type UpdateKind = 'major' | 'minor' | 'patch';

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty for a release */
  prerelease: string[];
}

export interface DepSpec {
  name: string;
  range: string;
  dev: boolean;
}

export interface NpmLatestEntry extends DepSpec {
  /** Installed version (node_modules, else the range floor) */
  installed: string;
  /** Raw payload of GET <registry>/<name>/latest */
  latest: unknown;
}

type Raw = Record<string, unknown>;

const asObj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);

const SEMVER_RE = /^v?(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
// npm package names (legacy mixed-case names included); never starts with '.' or '_'
const NAME_RE = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;
const KIND_ORDER: Record<UpdateKind, number> = { major: 0, minor: 1, patch: 2 };

// What each dependency backs in OpenCode, to point the upgrade agent at the right code
const AREAS: Record<string, string> = {
  next: 'the Next.js app: src/app pages, API routes and next.config',
  react: 'the React UI in src/app and src/components',
  'react-dom': 'the React UI in src/app and src/components',
  openai: 'the LLM client in src/lib/llmClient.ts and the agent loop',
  'better-sqlite3': 'the SQLite store in src/lib/db.ts',
  'playwright-core': 'the browser tools in src/lib/browserSession.ts and src/lib/browserTools.ts',
  '@playwright/test': 'the e2e suite in e2e/',
  katex: 'math rendering in src/components/chat/Markdown.tsx',
  zod: 'the tool input schemas in src/lib and src/lib/config.ts',
  'cross-spawn': 'process spawning in src/lib/safeExec.ts, src/lib/mcpTransports.ts and src/lib/previewManager.ts',
  'fast-glob': 'the file search tools in src/lib/tools.ts',
  '@monaco-editor/react': 'the code editor in src/components/CodeTab.tsx',
  archiver: 'project downloads in src/app/api/download/route.ts',
  zustand: 'client state stores in src/hooks',
  vitest: 'the vitest suite that the upgrade gate runs',
  typescript: 'type-checking (tsc --noEmit in the upgrade gate)',
  eslint: 'the lint config',
  tailwindcss: 'the Tailwind styles',
};

/** Parse `x.y.z` with an optional prerelease (a leading `v` and build metadata are ignored). */
export function parseVersion(input: unknown): SemVer | null {
  if (typeof input !== 'string') return null;
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ? m[4].split('.') : [] };
}

function formatVersion(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease.length ? `-${v.prerelease.join('.')}` : ''}`;
}

function toSemVer(v: string | SemVer): SemVer {
  if (typeof v !== 'string') return v;
  const parsed = parseVersion(v);
  if (!parsed) throw new Error(`Invalid version: ${v}`);
  return parsed;
}

/** Semver precedence: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string | SemVer, b: string | SemVer): number {
  const x = toSemVer(a);
  const y = toSemVer(b);
  if (x.major !== y.major) return x.major - y.major;
  if (x.minor !== y.minor) return x.minor - y.minor;
  if (x.patch !== y.patch) return x.patch - y.patch;
  // A release outranks any of its prereleases
  if (!x.prerelease.length || !y.prerelease.length) return y.prerelease.length - x.prerelease.length;
  for (let i = 0; i < Math.max(x.prerelease.length, y.prerelease.length); i++) {
    const p = x.prerelease[i];
    const q = y.prerelease[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pNum = /^\d+$/.test(p);
    const qNum = /^\d+$/.test(q);
    if (pNum && qNum) return Number(p) - Number(q);
    if (pNum !== qNum) return pNum ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * How big the jump from `installed` to `latest` is; null when latest is not
 * newer, is a prerelease, or either version is unparseable. Below 1.0.0 a
 * minor bump counts as major, as npm's ^0.x ranges treat it as breaking.
 */
export function classifyUpdate(installed: string, latest: string): UpdateKind | null {
  const from = parseVersion(installed);
  const to = parseVersion(latest);
  if (!from || !to || to.prerelease.length || compareVersions(to, from) <= 0) return null;
  if (to.major !== from.major) return 'major';
  if (to.minor !== from.minor) return from.major === 0 ? 'major' : 'minor';
  return 'patch';
}

export function isPackageName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 214 && NAME_RE.test(name);
}

/** The lowest version a plain range like `^4`, `~1.2.3` or `>=2.0.0` allows; null for anything else. */
export function installedFromRange(range: string): string | null {
  const m = /^\s*(?:\^|~|>=|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?\s*$/.exec(range);
  if (!m) return null;
  const v = parseVersion(`${m[1]}.${m[2] ?? '0'}.${m[3] ?? '0'}${m[4] ?? ''}`);
  return v ? formatVersion(v) : null;
}

/** Registry dependencies from a package.json; `dependencies` win over `devDependencies`. */
export function parseDependencies(pkg: unknown): DepSpec[] {
  const o = asObj(pkg);
  if (!o) return [];
  const out = new Map<string, DepSpec>();
  for (const [field, dev] of [['dependencies', false], ['devDependencies', true]] as const) {
    const deps = asObj(o[field]);
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      // Skip file:, link:, git, URL, workspace: and npm: alias specs — not plain registry versions
      if (out.has(name) || !isPackageName(name) || typeof range !== 'string' || !range.trim() || /[:/]/.test(range)) continue;
      out.set(name, { name, range: range.trim(), dev });
    }
  }
  return [...out.values()];
}

/** `@scope/pkg` → `https://registry.npmjs.org/@scope%2Fpkg/latest` */
export function registryUrl(name: string): string {
  if (!isPackageName(name)) throw new Error(`Invalid npm package name: ${name}`);
  return `${REGISTRY}/${encodeURIComponent(name).replace(/^%40/, '@')}/latest`;
}

function goalFor(kind: UpdateKind, name: string, title: string, url: string, installed: string, command: string): string {
  const area = AREAS[name] ? ` (${AREAS[name]})` : '';
  const manual = `The bump itself (${command}) is applied manually, since upgrade candidates may not edit package.json.`;
  if (kind === 'major') {
    return `Assess the major upgrade ${title} (${url}): read its changelog and migration guide, list the breaking changes that affect OpenCode${area} and the exact code that must change, and make only the changes that also work with ${installed}. ${manual}`;
  }
  return `Review the changelog for the ${kind} update ${title} (${url}) for fixes and new features OpenCode should use${area}, and point out the code that would change. ${manual}`;
}

/** Raw registry `/latest` payloads → outdated-package items, major first, then minor, patch, name. */
export function parseNpmUpdates(entries: NpmLatestEntry[]): DiscoverItem[] {
  const rows: { kind: UpdateKind; name: string; item: DiscoverItem }[] = [];
  for (const e of entries) {
    const raw = asObj(e.latest);
    if (!raw || !isPackageName(e.name) || (typeof raw.name === 'string' && raw.name !== e.name)) continue;
    const from = parseVersion(e.installed);
    const to = parseVersion(raw.version);
    if (!from || !to) continue;
    const kind = classifyUpdate(formatVersion(from), formatVersion(to));
    if (!kind) continue;
    const url = safeUrl(`https://www.npmjs.com/package/${e.name}`);
    if (!url) continue;
    const installed = formatVersion(from);
    const latest = formatVersion(to);
    const title = cleanText(`${e.name} ${installed} → ${latest}`, 200);
    const command = `npm install ${e.dev ? '-D ' : ''}${e.name}@${latest}`;
    const description = cleanText(raw.description, 300);
    rows.push({
      kind,
      name: e.name,
      item: {
        id: `${SOURCE_ID}:${e.name}@${latest}`,
        category: 'dependencies',
        source: SOURCE_ID,
        sourceLabel: SOURCE_LABEL,
        title,
        url,
        summary: cleanText(`Installed ${installed}, latest ${latest} (${kind}).${e.dev ? ' Dev dependency.' : ''}${description ? ` ${description}` : ''}`, 400),
        tags: e.dev ? [kind, 'dev'] : [kind],
        goal: goalFor(kind, e.name, title, url, installed, command),
        command,
      },
    });
  }
  // Runtime dependencies before dev-only ones within each kind, so the cap
  // does not fill up with @types/* and tooling
  const dev = (r: (typeof rows)[number]) => Number(r.item.tags.includes('dev'));
  rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || dev(a) - dev(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows.slice(0, MAX_ITEMS).map((r) => r.item);
}

async function installedVersion(root: string, dep: DepSpec): Promise<string | null> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'node_modules', ...dep.name.split('/'), 'package.json'), 'utf8'));
    const v = parseVersion(asObj(pkg)?.version);
    if (v) return formatVersion(v);
  } catch {
    // not installed — fall back to the declared range
  }
  return installedFromRange(dep.range);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchNpmUpdates(fetchImpl: FetchLike, cfg: DiscoverConfig): Promise<DiscoverItem[]> {
  const pkgPath = path.join(cfg.root, 'package.json');
  let pkg: unknown;
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  let attempted = 0;
  const failures: string[] = [];
  const entries = await mapLimit(parseDependencies(pkg), CONCURRENCY, async (dep): Promise<NpmLatestEntry | null> => {
    const installed = await installedVersion(cfg.root, dep);
    if (!installed) return null;
    attempted++;
    try {
      return { ...dep, installed, latest: await getJson<unknown>(fetchImpl, registryUrl(dep.name), {}, TIMEOUT_MS) };
    } catch (err) {
      // One private or unpublished package should not hide the rest
      failures.push(`${dep.name}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });
  if (attempted > 0 && failures.length === attempted) {
    throw new Error(`npm registry lookups failed for all ${attempted} packages (${failures[0]})`);
  }
  return parseNpmUpdates(entries.filter((e): e is NpmLatestEntry => e !== null));
}

export const npmUpdatesSource: DiscoverSource = {
  id: SOURCE_ID,
  label: SOURCE_LABEL,
  category: 'dependencies',
  fetch: fetchNpmUpdates,
};
