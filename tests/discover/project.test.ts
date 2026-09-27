import { describe, it, expect } from 'vitest';
import { githubIssues, githubCi, parseIssues, parseCheckRuns, titleToText, REPO_UNKNOWN } from '@/lib/discover/sources/githubProject';
import type { DiscoverConfig, FetchLike } from '@/lib/discover/types';

const cfg = (over: Partial<DiscoverConfig> = {}): DiscoverConfig => ({
  keywords: [],
  watchedRepos: [],
  topics: [],
  repo: 'VC-OF/Ai-Code-Platform-',
  root: '/repo',
  now: () => Date.parse('2026-09-27T12:00:00Z'),
  ...over,
});

// Trimmed from GET /repos/{repo}/issues?state=open (modelcontextprotocol/typescript-sdk, VC-OF/Ai-Code-Platform-)
const ISSUES = [
  {
    number: 2786,
    title: 'A handler that throws McpError produces a double-prefixed message on the client',
    html_url: 'https://github.com/modelcontextprotocol/typescript-sdk/issues/2786',
    labels: [{ name: 'v1' }],
    comments: 4,
    updated_at: '2026-09-27T11:25:58Z',
    state: 'open',
    body: '## What happens\n\nA request handler that throws `McpError` produces a **message** the client shows twice.\n\n```ts\nthrow new McpError(1, "x")\n```\n<!-- template -->See [the docs](https://example.com).',
  },
  {
    number: 1234,
    title: 'OAuth: Resource metadata URL lost after redirect, causing token exchange to fail',
    html_url: 'https://github.com/modelcontextprotocol/typescript-sdk/issues/1234',
    labels: [{ name: 'Bug' }, { name: 'ready for work' }, { name: 'P2' }, { name: 'auth' }, { name: 'fix proposed' }],
    comments: 3,
    updated_at: '2026-09-27T11:25:37Z',
    state: 'open',
    body: null,
  },
  {
    number: 6,
    title: 'Fix E2E and Docker CI jobs',
    html_url: 'https://github.com/VC-OF/Ai-Code-Platform-/pull/6',
    pull_request: { url: 'https://api.github.com/repos/VC-OF/Ai-Code-Platform-/pulls/6', html_url: 'https://github.com/VC-OF/Ai-Code-Platform-/pull/6', merged_at: null },
    labels: [],
    comments: 0,
    updated_at: '2026-09-27T11:43:49Z',
    state: 'open',
    body: '## Summary\nFixes the two jobs still failing on `main`.',
  },
];

// Trimmed from GET /repos/VC-OF/Ai-Code-Platform-/commits/main/check-runs
const CHECK_RUNS = {
  total_count: 5,
  check_runs: [
    {
      id: 108580177672,
      name: 'E2E Tests',
      head_sha: 'fe2b76b0c1d2e3f4',
      status: 'completed',
      conclusion: 'failure',
      started_at: '2026-09-27T08:06:17Z',
      completed_at: '2026-09-27T08:08:01Z',
      html_url: 'https://github.com/VC-OF/Ai-Code-Platform-/actions/runs/36304899048/job/108580177672',
      details_url: 'https://github.com/VC-OF/Ai-Code-Platform-/actions/runs/36304899048/job/108580177672',
      output: { title: 'Playwright', summary: '3 tests failed' },
    },
    {
      id: 108579843362,
      name: 'Build',
      head_sha: 'fe2b76b0c1d2e3f4',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-09-27T08:04:04Z',
      completed_at: '2026-09-27T08:06:14Z',
      html_url: 'https://github.com/VC-OF/Ai-Code-Platform-/actions/runs/36304899048/job/108579843362',
      details_url: 'https://github.com/VC-OF/Ai-Code-Platform-/actions/runs/36304899048/job/108579843362',
      output: { title: null, summary: '' },
    },
    {
      id: 108579479095,
      name: 'Build & Push',
      head_sha: 'fe2b76b0c1d2e3f4',
      status: 'completed',
      conclusion: 'timed_out',
      started_at: '2026-09-27T08:01:36Z',
      completed_at: '2026-09-27T08:01:57Z',
      html_url: null,
      details_url: 'https://github.com/VC-OF/Ai-Code-Platform-/actions/runs/36304899036/job/108579479095',
      output: { title: null, summary: '' },
    },
  ],
};

type Call = { url: string; init?: RequestInit };

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = responses[calls.length - 1] ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { impl, calls };
}

const headersOf = (c: Call) => (c.init?.headers ?? {}) as Record<string, string>;

describe('parseIssues', () => {
  it('maps issues and drops pull requests', () => {
    const items = parseIssues(ISSUES);
    expect(items).toHaveLength(2);
    const [a, b] = items;
    expect(a).toMatchObject({
      id: 'github-issues:2786',
      category: 'project',
      source: 'github-issues',
      sourceLabel: 'Open issues',
      title: '#2786 A handler that throws McpError produces a double-prefixed message on the client',
      url: 'https://github.com/modelcontextprotocol/typescript-sdk/issues/2786',
      date: '2026-09-27T11:25:58.000Z',
      score: 4,
      tags: ['v1', 'issue'],
    });
    expect(items.some((i) => i.url.includes('/pull/'))).toBe(false);
    expect(b.tags).toEqual(['bug', 'ready for work', 'p2', 'auth', 'issue']);
    expect(b.summary).toBeUndefined();
  });

  it('turns the Markdown body into a plain summary', () => {
    const s = parseIssues(ISSUES)[0].summary!;
    expect(s).toContain('What happens A request handler that throws McpError produces a message the client shows twice.');
    expect(s).toContain('See the docs.');
    expect(s).not.toMatch(/[#*`]|throw new|template|example\.com/);
    const long = parseIssues([{ ...ISSUES[0], body: 'word '.repeat(200) }])[0].summary!;
    expect(long.length).toBeLessThanOrEqual(400);
  });

  it('drops entries with unsafe or missing URLs and invalid numbers', () => {
    const bad = [
      { ...ISSUES[0], number: 1, html_url: 'javascript:alert(1)' },
      { ...ISSUES[0], number: 2, html_url: undefined },
      { ...ISSUES[0], number: 3, html_url: '/relative/path' },
      { ...ISSUES[0], number: '4' },
      { ...ISSUES[0], number: 5, title: '   ' },
      null,
      'nope',
    ];
    expect(parseIssues(bad)).toEqual([]);
    expect(parseIssues({ message: 'Not Found' })).toEqual([]);
  });

  it('caps at 15 items and clips titles', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...ISSUES[1], number: i + 1, html_url: `https://github.com/o/r/issues/${i + 1}`, title: 'x'.repeat(300) }));
    const items = parseIssues(many);
    expect(items).toHaveLength(15);
    expect(items.every((i) => i.title.length <= 200)).toBe(true);
  });

  it('keeps ids stable across refreshes', () => {
    const first = parseIssues(ISSUES).map((i) => i.id);
    const again = parseIssues([{ ...ISSUES[1], comments: 99, updated_at: '2026-09-28T00:00:00Z' }, ISSUES[0]]).map((i) => i.id);
    expect(first).toEqual(['github-issues:2786', 'github-issues:1234']);
    expect(new Set(again)).toEqual(new Set(first));
  });

  it('strips paired emphasis and code backticks from issue titles', () => {
    const [item] = parseIssues([{ ...ISSUES[0], title: 'Crash in `agentLoop.ts` when **context** is ~~almost~~ full' }]);
    expect(item.title).toMatch(/^#\d+ Crash in agentLoop\.ts when context is almost full$/);
    expect(item.goal).toContain('"Crash in agentLoop.ts when context is almost full"');
    expect(item.goal).not.toMatch(/[`*~]/);
  });

  it('keeps code identifiers in titles intact', () => {
    const cases: Array<[string, string]> = [
      ['__init__ fails on import', '__init__ fails on import'],
      ['`__init__` fails on import', '__init__ fails on import'],
      ['__init__ and __main__ both break', '__init__ and __main__ both break'],
      ['Tool `__dirname` is undefined in ESM', 'Tool __dirname is undefined in ESM'],
      ['Support `**kwargs` in tool calls', 'Support **kwargs in tool calls'],
      ['Support **kwargs and **options in tool calls', 'Support **kwargs and **options in tool calls'],
      ['2**10 and 3**4 overflow the calculator', '2**10 and 3**4 overflow the calculator'],
      ['`Array<string>` params lost; <br> shown & more', 'Array<string> params lost; <br> shown & more'],
      ['Double ``a`b`` span', 'Double a`b span'],
      ["Don't use ` in names", "Don't use ` in names"],
      ['snake_case_name and a_b_c stay', 'snake_case_name and a_b_c stay'],
      ['__very important__ bug', 'very important bug'],
      ['**`models.ts`** ignores the base URL', 'models.ts ignores the base URL'],
      ['Fix &amp; test, keep &amp;lt;', 'Fix & test, keep &lt;'],
    ];
    for (const [input, want] of cases) expect(titleToText(input), input).toBe(want);
    expect(titleToText(undefined)).toBe('');
    expect(titleToText('  `x`  ')).toBe('x');
    expect(Array.from(titleToText('\u{1F600}'.repeat(300), 180))).toHaveLength(180);
  });

  it('writes a goal naming the issue and its URL', () => {
    for (const item of parseIssues(ISSUES)) {
      const n = item.title.split(' ')[0];
      const name = item.title.slice(n.length + 1);
      expect(item.goal).toContain(`Fix issue ${n} "${name}" (${item.url})`);
      expect(item.goal).toContain('OpenCode');
      expect(item.goal).toContain('regression test under tests/');
      expect(item.goal).toContain("don't edit package.json");
      expect(item.goal).not.toMatch(/[*`#]{2}|\]\(/);
    }
  });
});

describe('parseCheckRuns', () => {
  it('emits one item per failing check and skips passing ones', () => {
    const items = parseCheckRuns(CHECK_RUNS, 'main');
    expect(items.map((i) => i.title)).toEqual(['CI: E2E Tests failing on main', 'CI: Build & Push failing on main']);
    expect(items[0]).toMatchObject({
      id: 'github-ci:main:E2E Tests',
      category: 'project',
      source: 'github-ci',
      sourceLabel: 'CI status',
      url: 'https://github.com/VC-OF/Ai-Code-Platform-/actions/runs/36304899048/job/108580177672',
      date: '2026-09-27T08:08:01.000Z',
      tags: ['ci', 'failure'],
    });
    expect(items[0].summary).toBe('The "E2E Tests" check failed on main at fe2b76b. Playwright: 3 tests failed');
    expect(items[1].tags).toEqual(['ci', 'timed_out']);
    expect(items[1].summary).toBe('The "Build & Push" check timed out on main at fe2b76b.');
  });

  it('falls back to details_url and drops runs without a safe URL', () => {
    const items = parseCheckRuns(CHECK_RUNS, 'main');
    expect(items[1].url).toBe('https://github.com/VC-OF/Ai-Code-Platform-/actions/runs/36304899036/job/108579479095');
    const unsafe = { check_runs: [{ ...CHECK_RUNS.check_runs[0], html_url: 'javascript:alert(1)', details_url: 'ftp://x/y' }] };
    expect(parseCheckRuns(unsafe, 'main')).toEqual([]);
  });

  it('returns [] when every check passed or the payload is malformed', () => {
    const green = { check_runs: CHECK_RUNS.check_runs.map((r) => ({ ...r, conclusion: 'success' })) };
    expect(parseCheckRuns(green, 'main')).toEqual([]);
    const pending = { check_runs: [{ ...CHECK_RUNS.check_runs[0], status: 'in_progress', conclusion: null }] };
    expect(parseCheckRuns(pending, 'main')).toEqual([]);
    expect(parseCheckRuns({ message: 'Not Found' }, 'main')).toEqual([]);
    expect(parseCheckRuns(null, 'main')).toEqual([]);
  });

  it('uses only the latest run per check name', () => {
    const e2e = CHECK_RUNS.check_runs[0];
    const rerunPassed = { check_runs: [{ ...e2e, id: e2e.id + 1, conclusion: 'success', started_at: '2026-09-27T09:00:00Z' }, e2e] };
    expect(parseCheckRuns(rerunPassed, 'main')).toEqual([]);
    const rerunFailed = { check_runs: [{ ...e2e, conclusion: 'success', started_at: '2026-09-27T07:00:00Z' }, { ...e2e, id: e2e.id + 1, conclusion: 'cancelled' }] };
    const items = parseCheckRuns(rerunFailed, 'main');
    expect(items).toHaveLength(1);
    expect(items[0].tags).toEqual(['ci', 'cancelled']);
  });

  it('caps at 15 items with stable ids', () => {
    const many = { check_runs: Array.from({ length: 25 }, (_, i) => ({ ...CHECK_RUNS.check_runs[0], id: i, name: `job ${i}` })) };
    const items = parseCheckRuns(many, 'main');
    expect(items).toHaveLength(15);
    expect(new Set(items.map((i) => i.id)).size).toBe(15);
    expect(parseCheckRuns(many, 'main').map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('writes a goal naming the check and its URL', () => {
    const [item] = parseCheckRuns(CHECK_RUNS, 'main');
    expect(item.goal).toBe(
      `Make OpenCode's "E2E Tests" CI check pass on main again (${item.url}): read the failing job log, find the root cause and fix it in the code or the workflow, without skipping or weakening the check. If the fix needs a dependency bump, don't edit package.json — say which one; the bump is applied manually.`,
    );
  });

  it('treats check names and branches as plain text', () => {
    const run = CHECK_RUNS.check_runs[0];
    const items = parseCheckRuns({ check_runs: [{ ...run, name: 'test (node <20>) &amp; lint' }] }, 'feat/<x>');
    expect(items[0].title).toBe('CI: test (node <20>) & lint failing on feat/<x>');
    expect(items[0].summary).toMatch(/^The "test \(node <20>\) & lint" check failed on feat\/<x> at fe2b76b\./);
    const long = parseCheckRuns({ check_runs: [{ ...run, name: 'n'.repeat(120) }] }, 'b'.repeat(100));
    expect(Array.from(long[0].title).length).toBeLessThanOrEqual(200);
    expect(long[0].title.endsWith('…')).toBe(true);
  });

  it('keeps Markdown stripping for check-run output', () => {
    const run = { ...CHECK_RUNS.check_runs[0], output: { title: '**2** alerts', summary: 'See [the log](https://x.y) for `lint` errors' } };
    expect(parseCheckRuns({ check_runs: [run] }, 'main')[0].summary).toBe('The "E2E Tests" check failed on main at fe2b76b. 2 alerts: See the log for lint errors');
  });
});

describe('githubIssues.fetch', () => {
  it('requests open issues for cfg.repo with GitHub headers', async () => {
    const { impl, calls } = fakeFetch([{ body: ISSUES }]);
    const items = await githubIssues.fetch(impl, cfg({ githubToken: 'test-token' }));
    expect(items).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/repos/VC-OF/Ai-Code-Platform-/issues?state=open&per_page=30&sort=updated');
    const h = headersOf(calls[0]);
    expect(h.Accept).toBe('application/vnd.github+json');
    expect(h['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(h.Authorization).toBe('Bearer test-token');
    expect(h['User-Agent']).toMatch(/open-code-discover/);
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('omits Authorization without a token', async () => {
    const { impl, calls } = fakeFetch([{ body: [] }]);
    await githubIssues.fetch(impl, cfg());
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
  });

  it('throws a how-to-fix error without a request when the repo is unknown or invalid', async () => {
    expect(REPO_UNKNOWN).toBe("OpenCode's GitHub repository is unknown — set it under Discover → Sources (owner/name).");
    for (const repo of [null, '', 'no-slash', 'a/b/c', 'owner/..', 'owner/.', '../etc', 'own er/x', 'o/x?y=1', 'o/x#frag']) {
      const { impl, calls } = fakeFetch([{ body: ISSUES }]);
      await expect(githubIssues.fetch(impl, cfg({ repo })), String(repo)).rejects.toThrow(REPO_UNKNOWN);
      expect(calls, String(repo)).toHaveLength(0);
    }
  });

  it('returns [] for a known repo with no open issues', async () => {
    const { impl, calls } = fakeFetch([{ body: [] }]);
    expect(await githubIssues.fetch(impl, cfg())).toEqual([]);
    expect(calls).toHaveLength(1);
    const prsOnly = fakeFetch([{ body: [ISSUES[2]] }]);
    expect(await githubIssues.fetch(prsOnly.impl, cfg())).toEqual([]);
  });

  it('throws on a non-OK response', async () => {
    const { impl } = fakeFetch([{ status: 403, body: { message: 'API rate limit exceeded' } }]);
    await expect(githubIssues.fetch(impl, cfg())).rejects.toThrow('api.github.com returned 403');
  });
});

describe('githubCi.fetch', () => {
  it('looks up the default branch, then its check runs', async () => {
    const { impl, calls } = fakeFetch([{ body: { default_branch: 'main' } }, { body: CHECK_RUNS }]);
    const items = await githubCi.fetch(impl, cfg());
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/VC-OF/Ai-Code-Platform-',
      'https://api.github.com/repos/VC-OF/Ai-Code-Platform-/commits/main/check-runs?per_page=100',
    ]);
    for (const c of calls) {
      expect(headersOf(c).Accept).toBe('application/vnd.github+json');
      expect(c.init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(items.map((i) => i.id)).toEqual(['github-ci:main:E2E Tests', 'github-ci:main:Build & Push']);
  });

  it('encodes the branch name in the URL path', async () => {
    const { impl, calls } = fakeFetch([{ body: { default_branch: 'release/2.0#x?y' } }, { body: CHECK_RUNS }]);
    const items = await githubCi.fetch(impl, cfg());
    expect(calls[1].url).toBe('https://api.github.com/repos/VC-OF/Ai-Code-Platform-/commits/release%2F2.0%23x%3Fy/check-runs?per_page=100');
    expect(items[0].title).toBe('CI: E2E Tests failing on release/2.0#x?y');
  });

  it('throws a how-to-fix error without a request when the repo is unknown or invalid', async () => {
    for (const repo of [null, '', 'owner/..', 'bad repo/x']) {
      const { impl, calls } = fakeFetch([{ body: { default_branch: 'main' } }, { body: CHECK_RUNS }]);
      await expect(githubCi.fetch(impl, cfg({ repo })), String(repo)).rejects.toThrow(REPO_UNKNOWN);
      expect(calls, String(repo)).toHaveLength(0);
    }
  });

  it('returns [] when all checks passed', async () => {
    const green = { check_runs: CHECK_RUNS.check_runs.map((r) => ({ ...r, conclusion: 'success' })) };
    const { impl } = fakeFetch([{ body: { default_branch: 'main' } }, { body: green }]);
    expect(await githubCi.fetch(impl, cfg())).toEqual([]);
  });

  it('throws on non-OK responses and a missing default branch', async () => {
    await expect(githubCi.fetch(fakeFetch([{ status: 404, body: {} }]).impl, cfg())).rejects.toThrow('api.github.com returned 404');
    await expect(githubCi.fetch(fakeFetch([{ body: { default_branch: 'main' } }, { status: 502, body: {} }]).impl, cfg())).rejects.toThrow('api.github.com returned 502');
    await expect(githubCi.fetch(fakeFetch([{ body: {} }]).impl, cfg())).rejects.toThrow(/no default branch/);
  });
});
