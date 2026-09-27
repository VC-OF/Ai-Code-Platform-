import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { USER_AGENT } from '@/lib/discover/types';
import type { DiscoverConfig, FetchLike } from '@/lib/discover/types';
import {
  classifyUpdate,
  compareVersions,
  installedFromRange,
  npmUpdatesSource,
  parseDependencies,
  parseNpmUpdates,
  parseVersion,
  registryUrl,
} from '@/lib/discover/sources/npmUpdates';
import type { NpmLatestEntry } from '@/lib/discover/sources/npmUpdates';

// Trimmed from real GET https://registry.npmjs.org/<name>/latest responses
const LATEST: Record<string, Record<string, unknown>> = {
  next: {
    _id: 'next@17.0.0',
    name: 'next',
    version: '17.0.0',
    description: 'The React Framework',
    homepage: 'https://nextjs.org',
    dist: { tarball: 'https://registry.npmjs.org/next/-/next-17.0.0.tgz' },
  },
  zod: {
    _id: 'zod@4.6.5',
    name: 'zod',
    version: '4.6.5',
    description: 'TypeScript-first schema declaration and validation library with static type inference',
    homepage: 'https://zod.dev',
    repository: { url: 'git+https://github.com/colinhacks/zod.git', type: 'git' },
    dist: { tarball: 'https://registry.npmjs.org/zod/-/zod-4.6.5.tgz' },
  },
  '@types/node': {
    _id: '@types/node@26.6.3',
    name: '@types/node',
    version: '26.6.3',
    description: 'TypeScript definitions for node',
    homepage: 'https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node',
    dist: { tarball: 'https://registry.npmjs.org/@types/node/-/node-26.6.3.tgz' },
  },
  react: { _id: 'react@19.2.4', name: 'react', version: '19.2.4', description: 'React is a JavaScript library for building user interfaces.' },
  vitest: { _id: 'vitest@4.1.12', name: 'vitest', version: '4.1.12', description: 'Next generation testing framework powered by Vite' },
};

const entry = (name: string, installed: string, dev = false, latest: unknown = LATEST[name]): NpmLatestEntry => ({
  name,
  range: `^${installed}`,
  dev,
  installed,
  latest,
});

describe('parseVersion', () => {
  it('parses x.y.z with an optional prerelease', () => {
    expect(parseVersion('16.3.6')).toEqual({ major: 16, minor: 3, patch: 6, prerelease: [] });
    expect(parseVersion('1.0.0-rc.1')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: ['rc', '1'] });
    expect(parseVersion('v2.1.0')).toEqual({ major: 2, minor: 1, patch: 0, prerelease: [] });
    expect(parseVersion('1.2.3+build.5')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });
  it('rejects anything else', () => {
    for (const v of ['1.2', '01.2.3', '^1.2.3', 'latest', '1.2.3-', '1.2.3 || 2', '']) expect(parseVersion(v), v).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion(123)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('follows semver precedence', () => {
    const ordered = [
      '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11',
      '1.0.0-rc.1', '1.0.0', '1.0.1', '1.9.0', '1.10.0', '2.0.0',
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(ordered[i], ordered[i + 1]), `${ordered[i]} < ${ordered[i + 1]}`).toBeLessThan(0);
      expect(compareVersions(ordered[i + 1], ordered[i]), `${ordered[i + 1]} > ${ordered[i]}`).toBeGreaterThan(0);
    }
    expect(compareVersions('3.4.5', '3.4.5')).toBe(0);
    expect(compareVersions(parseVersion('3.4.5')!, '3.4.6')).toBeLessThan(0);
  });
  it('throws on an invalid version string', () => {
    expect(() => compareVersions('1.x', '1.0.0')).toThrow(/Invalid version/);
  });
});

describe('classifyUpdate', () => {
  it('classifies newer releases', () => {
    expect(classifyUpdate('16.3.6', '17.0.0')).toBe('major');
    expect(classifyUpdate('4.4.3', '4.6.5')).toBe('minor');
    expect(classifyUpdate('19.2.4', '19.2.5')).toBe('patch');
    expect(classifyUpdate('2.0.0-rc.1', '2.0.0')).toBe('patch');
  });
  it('treats a 0.x minor bump as breaking', () => {
    expect(classifyUpdate('0.18.9', '0.19.0')).toBe('major');
    expect(classifyUpdate('0.18.9', '0.18.10')).toBe('patch');
  });
  it('returns null when latest is not newer, is a prerelease or is unparseable', () => {
    expect(classifyUpdate('4.6.5', '4.6.5')).toBeNull();
    expect(classifyUpdate('5.0.0', '4.6.5')).toBeNull();
    expect(classifyUpdate('16.4.0-canary.3', '16.3.6')).toBeNull();
    expect(classifyUpdate('16.3.6', '17.0.0-rc.0')).toBeNull();
    expect(classifyUpdate('latest', '1.0.0')).toBeNull();
    expect(classifyUpdate('1.0.0', 'nope')).toBeNull();
  });
});

describe('installedFromRange', () => {
  it('strips ^, ~, >= and pads partial versions', () => {
    expect(installedFromRange('^16.3.6')).toBe('16.3.6');
    expect(installedFromRange('~1.2')).toBe('1.2.0');
    expect(installedFromRange('^4')).toBe('4.0.0');
    expect(installedFromRange('>=2.0.0-beta.1')).toBe('2.0.0-beta.1');
    expect(installedFromRange('19.2.4')).toBe('19.2.4');
  });
  it('gives up on anything that is not a single plain version', () => {
    for (const r of ['*', 'latest', '1.x', '>=1 <2', '1 || 2', '']) expect(installedFromRange(r), r).toBeNull();
  });
});

describe('parseDependencies', () => {
  it('reads dependencies and devDependencies, dependencies winning', () => {
    const deps = parseDependencies({
      dependencies: { next: '^16.3.6', zod: '^4.4.3' },
      devDependencies: { zod: '^4.0.0', '@types/node': '^20' },
    });
    expect(deps).toEqual([
      { name: 'next', range: '^16.3.6', dev: false },
      { name: 'zod', range: '^4.4.3', dev: false },
      { name: '@types/node', range: '^20', dev: true },
    ]);
  });
  it('skips non-registry specs and invalid names', () => {
    const deps = parseDependencies({
      dependencies: {
        local: 'file:../local',
        linked: 'link:../x',
        gh: 'user/repo',
        git: 'git+https://github.com/a/b.git',
        alias: 'npm:zod@4',
        ws: 'workspace:*',
        '../evil': '^1.0.0',
        'a b': '^1.0.0',
        '.hidden': '^1.0.0',
        'javascript:alert(1)': '^1.0.0',
        bad: 42,
        empty: ' ',
        ok: '^1.0.0',
      },
    });
    expect(deps.map((d) => d.name)).toEqual(['ok']);
    expect(parseDependencies(null)).toEqual([]);
    expect(parseDependencies({ dependencies: ['next'] })).toEqual([]);
  });
});

describe('registryUrl', () => {
  it('encodes scoped names as @scope%2Fpkg', () => {
    expect(registryUrl('@types/node')).toBe('https://registry.npmjs.org/@types%2Fnode/latest');
    expect(registryUrl('next')).toBe('https://registry.npmjs.org/next/latest');
  });
  it('refuses invalid names', () => {
    expect(() => registryUrl('../../-/user/org.couchdb.user:x')).toThrow(/Invalid npm package name/);
    expect(() => registryUrl('a?b=c')).toThrow(/Invalid npm package name/);
  });
});

describe('parseNpmUpdates', () => {
  const items = parseNpmUpdates([
    entry('zod', '4.4.3'),
    entry('@types/node', '20.19.0', true),
    entry('react', '19.2.4'),
    entry('next', '16.3.6'),
    entry('vitest', '4.1.9', true),
  ]);

  it('emits only outdated packages, major first, then minor, patch, name', () => {
    expect(items.map((i) => i.title)).toEqual([
      'next 16.3.6 → 17.0.0', // runtime before dev within a kind
      '@types/node 20.19.0 → 26.6.3',
      'zod 4.4.3 → 4.6.5',
      'vitest 4.1.9 → 4.1.12',
    ]);
  });

  it('fills every field', () => {
    const next = items.find((i) => i.title.startsWith('next'))!;
    expect(next).toMatchObject({
      id: 'npm-updates:next@17.0.0',
      category: 'dependencies',
      source: 'npm-updates',
      sourceLabel: 'npm updates',
      url: 'https://www.npmjs.com/package/next',
      tags: ['major'],
      command: 'npm install next@17.0.0',
    });
    expect(next.summary).toBe('Installed 16.3.6, latest 17.0.0 (major). The React Framework');
    const types = items.find((i) => i.title.startsWith('@types/node'))!;
    expect(types.url).toBe('https://www.npmjs.com/package/@types/node');
    expect(types.tags).toEqual(['major', 'dev']);
    expect(types.command).toBe('npm install -D @types/node@26.6.3');
    expect(types.summary).toMatch(/^Installed 20\.19\.0, latest 26\.6\.3 \(major\)\. Dev dependency\./);
    const vitest = items.find((i) => i.title.startsWith('vitest'))!;
    expect(vitest.tags).toEqual(['patch', 'dev']);
  });

  it('writes plain-text goals that name the item, its URL and the manual package.json step', () => {
    for (const item of items) {
      expect(item.goal).toContain(item.title);
      expect(item.goal).toContain(item.url);
      expect(item.goal).toContain(item.command!);
      expect(item.goal).toMatch(/applied manually, since upgrade candidates may not edit package\.json/);
      expect(item.goal).not.toMatch(/[`*#[\]]/);
    }
    const next = items.find((i) => i.title.startsWith('next'))!;
    expect(next.goal).toMatch(/^Assess the major upgrade next 16\.3\.6 → 17\.0\.0/);
    expect(next.goal).toMatch(/breaking changes that affect OpenCode \(the Next\.js app/);
    const zod = items.find((i) => i.title.startsWith('zod'))!;
    expect(zod.goal).toMatch(/^Review the changelog for the minor update zod 4\.4\.3 → 4\.6\.5/);
    expect(zod.goal).toMatch(/fixes and new features OpenCode should use/);
  });

  it('keeps ids stable across refreshes', () => {
    const again = parseNpmUpdates([entry('next', '16.3.6'), entry('zod', '4.4.3')]);
    expect(again.map((i) => i.id)).toEqual(['npm-updates:next@17.0.0', 'npm-updates:zod@4.6.5']);
    expect(items.filter((i) => again.some((a) => a.id === i.id))).toHaveLength(2);
  });

  it('drops payloads without a usable version, name mismatches and unsafe names', () => {
    const out = parseNpmUpdates([
      entry('next', '16.3.6', false, { name: 'next' }),
      entry('next', '16.3.6', false, { name: 'next', version: 'garbage' }),
      entry('next', '16.3.6', false, { name: 'next', version: '17.1.0-canary.2' }),
      entry('zod', '4.4.3', false, { name: 'not-zod', version: '9.0.0' }),
      entry('zod', '4.4.3', false, 'Not Found'),
      entry('zod', '4.4.3', false, null),
      entry('javascript:alert(1)', '1.0.0', false, { version: '2.0.0' }),
      entry('ok', 'weird', false, { name: 'ok', version: '2.0.0' }),
    ]);
    expect(out).toEqual([]);
  });

  it('returns at most 15 items', () => {
    const many = Array.from({ length: 30 }, (_, i) => entry(`pkg-${String(i).padStart(2, '0')}`, '1.0.0', false, { version: '1.0.1' }));
    const out = parseNpmUpdates(many);
    expect(out).toHaveLength(15);
    expect(out[0].title).toBe('pkg-00 1.0.0 → 1.0.1');
    expect(out[14].title).toBe('pkg-14 1.0.0 → 1.0.1');
  });
});

describe('npmUpdatesSource.fetch', () => {
  let root: string;
  const cfg = (): DiscoverConfig => ({ keywords: [], watchedRepos: [], topics: [], repo: null, root, now: () => 0 });

  const writeJson = (file: string, data: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-npm-updates-'));
    writeJson(path.join(root, 'package.json'), {
      name: 'fake-open-code',
      dependencies: { next: '^16.0.0', zod: '^4.4.3', react: '19.2.4', local: 'file:../local', '../evil': '^1.0.0' },
      devDependencies: { '@types/node': '^20', vitest: '^4.1.9' },
    });
    // Installed versions come from node_modules; react is missing there and falls back to its range
    writeJson(path.join(root, 'node_modules', 'next', 'package.json'), { name: 'next', version: '16.3.6' });
    writeJson(path.join(root, 'node_modules', 'zod', 'package.json'), { name: 'zod', version: '4.4.3' });
    writeJson(path.join(root, 'node_modules', '@types', 'node', 'package.json'), { name: '@types/node', version: '20.19.0' });
    writeJson(path.join(root, 'node_modules', 'vitest', 'package.json'), { name: 'vitest', version: '4.1.9' });
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  function fakeRegistry(status: (name: string) => number = () => 200) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      const name = decodeURIComponent(url.replace('https://registry.npmjs.org/', '').replace(/\/latest$/, ''));
      const code = status(name);
      return code === 200 && LATEST[name] ? json(LATEST[name]) : json('Not Found', code === 200 ? 404 : code);
    };
    return { fetchImpl, calls };
  }

  it('describes itself', () => {
    expect(npmUpdatesSource).toMatchObject({ id: 'npm-updates', label: 'npm updates', category: 'dependencies' });
  });

  it('reads package.json + node_modules and asks the registry for each package', async () => {
    const { fetchImpl, calls } = fakeRegistry();
    const items = await npmUpdatesSource.fetch(fetchImpl, cfg());
    expect(calls.map((c) => c.url).sort()).toEqual([
      'https://registry.npmjs.org/@types%2Fnode/latest',
      'https://registry.npmjs.org/next/latest',
      'https://registry.npmjs.org/react/latest',
      'https://registry.npmjs.org/vitest/latest',
      'https://registry.npmjs.org/zod/latest',
    ]);
    for (const { init } of calls) {
      const headers = init?.headers as Record<string, string>;
      expect(headers['User-Agent']).toBe(USER_AGENT);
      expect(headers.Accept).toBe('application/json');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(items.map((i) => i.title)).toEqual([
      'next 16.3.6 → 17.0.0', // runtime before dev within a kind
      '@types/node 20.19.0 → 26.6.3',
      'zod 4.4.3 → 4.6.5',
      'vitest 4.1.9 → 4.1.12',
    ]);
    expect(items.find((i) => i.title.startsWith('vitest'))?.command).toBe('npm install -D vitest@4.1.12');
  });

  it('keeps at most 6 registry requests in flight', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-npm-pool-'));
    try {
      const deps = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`pkg-${i}`, '^1.0.0']));
      writeJson(path.join(dir, 'package.json'), { dependencies: deps });
      let inFlight = 0;
      let peak = 0;
      const fetchImpl: FetchLike = async (url) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        const name = url.split('/')[3];
        return json({ name, version: '1.2.0' });
      };
      const items = await npmUpdatesSource.fetch(fetchImpl, { ...cfg(), root: dir });
      expect(peak).toBeLessThanOrEqual(6);
      expect(peak).toBeGreaterThan(1);
      expect(items).toHaveLength(15);
      expect(items.every((i) => i.tags[0] === 'minor')).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips a single failing package but throws when every lookup fails', async () => {
    const partial = fakeRegistry((name) => (name === 'next' ? 404 : 200));
    const items = await npmUpdatesSource.fetch(partial.fetchImpl, cfg());
    expect(items.map((i) => i.title)).not.toContain('next 16.3.6 → 17.0.0');
    expect(items).toHaveLength(3);

    const down = fakeRegistry(() => 503);
    await expect(npmUpdatesSource.fetch(down.fetchImpl, cfg())).rejects.toThrow(/npm registry lookups failed.*registry\.npmjs\.org returned 503/);
  });

  it('throws a clear error when package.json is missing', async () => {
    const { fetchImpl, calls } = fakeRegistry();
    await expect(npmUpdatesSource.fetch(fetchImpl, { ...cfg(), root: path.join(root, 'nope') })).rejects.toThrow(/Cannot read .*package\.json/);
    expect(calls).toHaveLength(0);
  });
});
