import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

vi.mock('@/lib/settingsStore', () => ({ getDecryptedEnv: vi.fn(async () => ({})) }));

import { getDecryptedEnv } from '@/lib/settingsStore';
import {
  parseGithubRemote,
  detectGithubRepo,
  executeGithubTool,
  isGithubTool,
  GITHUB_ZOD_SCHEMAS,
} from '@/lib/githubTools';
import { validateToolArgs } from '@/lib/toolValidator';
import { APPROVAL_REQUIRED_TOOLS } from '@/lib/permissions';
import { TOOL_SCHEMAS } from '@/lib/tools';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

async function tempRepo(remote?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-gh-'));
  git(dir, 'init', '-q', '-b', 'feature/x');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  return dir;
}

describe('parseGithubRemote', () => {
  it('parses https and ssh github URLs', () => {
    expect(parseGithubRemote('https://github.com/acme/widgets.git')).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(parseGithubRemote('https://github.com/acme/widgets')).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(parseGithubRemote('https://x-access-token:abc@github.com/acme/my.repo.git')).toEqual({ owner: 'acme', repo: 'my.repo' });
    expect(parseGithubRemote('git@github.com:acme/widgets.git')).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(parseGithubRemote('ssh://git@github.com/acme/widgets')).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('rejects non-github remotes', () => {
    expect(parseGithubRemote('https://gitlab.com/acme/widgets.git')).toBeNull();
    expect(parseGithubRemote('git@bitbucket.org:acme/widgets.git')).toBeNull();
    expect(parseGithubRemote('/local/path')).toBeNull();
  });
});

describe('detectGithubRepo (temp git repo)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
  });

  it('reads the origin remote', async () => {
    const dir = await tempRepo('git@github.com:acme/widgets.git');
    dirs.push(dir);
    await expect(detectGithubRepo(dir)).resolves.toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('explains a missing or non-github remote', async () => {
    const none = await tempRepo();
    const other = await tempRepo('https://gitlab.com/a/b.git');
    dirs.push(none, other);
    await expect(detectGithubRepo(none)).rejects.toThrow(/No git remote 'origin'/);
    await expect(detectGithubRepo(other)).rejects.toThrow(/not a github.com repository/);
  });
});

describe('registration', () => {
  it('registers schemas, validators and approval rules', () => {
    const names = TOOL_SCHEMAS.map((t) => t.function.name);
    for (const n of Object.keys(GITHUB_ZOD_SCHEMAS)) {
      expect(names).toContain(n);
      expect(isGithubTool(n)).toBe(true);
    }
    expect(APPROVAL_REQUIRED_TOOLS).toContain('github_create_pr');
    expect(APPROVAL_REQUIRED_TOOLS).toContain('github_comment');
    expect(APPROVAL_REQUIRED_TOOLS).not.toContain('github_list_prs' as never);
    expect(validateToolArgs('github_get_pr', { number: 3 }).success).toBe(true);
    expect(validateToolArgs('github_get_pr', { number: 0 }).success).toBe(false);
    expect(validateToolArgs('github_create_pr', { title: 't', body: 'b', head: '--force' }).success).toBe(false);
  });
});

describe('executeGithubTool (fetch mocked)', () => {
  let dir: string;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    dir = await tempRepo('https://github.com/acme/widgets.git');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.mocked(getDecryptedEnv).mockResolvedValue({ GITHUB_TOKEN: 'tok123' });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const reply = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  it('errors clearly without a token', async () => {
    vi.mocked(getDecryptedEnv).mockResolvedValue({});
    const prev = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      await expect(executeGithubTool('github_list_prs', {}, dir, 'p1')).rejects.toThrow(/No GITHUB_TOKEN/);
    } finally {
      if (prev !== undefined) process.env.GITHUB_TOKEN = prev;
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists PRs with auth header', async () => {
    fetchMock.mockImplementation(() => reply([
      { number: 7, title: 'Add thing', state: 'open', html_url: 'u', user: { login: 'bob' }, head: { ref: 'f', sha: 's' }, base: { ref: 'main' } },
    ]));
    const r = await executeGithubTool('github_list_prs', { state: 'open' }, dir, 'p1');
    expect(r.success).toBe(true);
    expect(r.output).toContain('#7 [open] Add thing (f → main, @bob)');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/acme/widgets/pulls?state=open&per_page=30');
    expect(init.headers.Authorization).toBe('Bearer tok123');
  });

  it('gets a PR with review comments and check-run conclusions', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/pulls/7')) return reply({ number: 7, title: 'T', state: 'open', html_url: 'u', body: 'desc', head: { ref: 'f', sha: 'abc' }, base: { ref: 'main' }, mergeable_state: 'clean' });
      if (url.includes('/pulls/7/comments')) return reply([{ user: { login: 'rev' }, body: 'nit: rename', path: 'a.ts', line: 3 }]);
      if (url.includes('/issues/7/comments')) return reply([{ user: { login: 'amy' }, body: 'LGTM' }]);
      if (url.includes('/commits/abc/check-runs')) return reply({ check_runs: [{ name: 'ci', status: 'completed', conclusion: 'failure' }, { name: 'lint', status: 'completed', conclusion: 'success' }] });
      return reply({}, 404);
    });
    const r = await executeGithubTool('github_get_pr', { number: 7 }, dir, 'p1');
    expect(r.output).toContain('- ci: failure');
    expect(r.output).toContain('@rev on a.ts:3: nit: rename');
    expect(r.output).toContain('@amy: LGTM');
    expect(r.summary).toContain('1 failing');
  });

  it('lists issues without PRs and passes labels', async () => {
    fetchMock.mockImplementation(() => reply([
      { number: 1, title: 'Bug', state: 'open', html_url: 'u', labels: [{ name: 'bug' }] },
      { number: 2, title: 'A PR', state: 'open', html_url: 'u', pull_request: {} },
    ]));
    const r = await executeGithubTool('github_list_issues', { labels: ['bug', 'p1'] }, dir, 'p1');
    expect(r.output).toContain('#1 [open] Bug {bug}');
    expect(r.output).not.toContain('A PR');
    expect(fetchMock.mock.calls[0][0]).toContain('labels=bug%2Cp1');
  });

  it('gets an issue and posts a comment', async () => {
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (init?.method === 'POST') return reply({ html_url: 'https://github.com/acme/widgets/issues/4#c1' }, 201);
      if (url.endsWith('/issues/4')) return reply({ number: 4, title: 'Crash', state: 'open', html_url: 'u', body: 'trace' });
      return reply([]);
    });
    const issue = await executeGithubTool('github_get_issue', { number: 4 }, dir, 'p1');
    expect(issue.output).toContain('Issue #4: Crash [open]');
    const c = await executeGithubTool('github_comment', { number: 4, body: 'on it' }, dir, 'p1');
    expect(c.output).toContain('issues/4#c1');
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ body: 'on it' });
  });

  it('surfaces GitHub API errors', async () => {
    fetchMock.mockImplementation(() => reply({ message: 'Not Found' }, 404));
    await expect(executeGithubTool('github_get_issue', { number: 9 }, dir, 'p1')).rejects.toThrow(/404.*Not Found/);
  });

  it('create_pr fails with the git push error when the remote is unreachable', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'x');
    git(dir, 'add', '.');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
    // Point origin at a local path that does not exist → push fails fast, no network
    git(dir, 'remote', 'set-url', '--push', 'origin', path.join(dir, 'nope.git'));
    await expect(executeGithubTool('github_create_pr', { title: 't', body: 'b' }, dir, 'p1')).rejects.toThrow(/git push -u origin feature\/x failed/);
    expect(fetchMock).not.toHaveBeenCalled();
  }, 30_000);

  it('create_pr pushes then opens the PR against the default branch', async () => {
    const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-gh-bare-'));
    git(bare, 'init', '-q', '--bare');
    await fs.writeFile(path.join(dir, 'a.txt'), 'x');
    git(dir, 'add', '.');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
    git(dir, 'remote', 'set-url', '--push', 'origin', bare);
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (init?.method === 'POST') return reply({ number: 12, html_url: 'https://github.com/acme/widgets/pull/12', draft: true }, 201);
      return reply({ default_branch: 'main' });
    });
    try {
      const r = await executeGithubTool('github_create_pr', { title: 'Feat', body: 'Body', draft: true }, dir, 'p1');
      expect(r.summary).toBe('Opened PR #12 → https://github.com/acme/widgets/pull/12');
      const post = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')!;
      expect(JSON.parse(post[1].body)).toEqual({ title: 'Feat', body: 'Body', head: 'feature/x', base: 'main', draft: true });
      expect(git(bare, 'branch', '--list')).toContain('feature/x');
    } finally {
      await fs.rm(bare, { recursive: true, force: true });
    }
  }, 30_000);
});
