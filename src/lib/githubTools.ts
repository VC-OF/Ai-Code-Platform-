import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { getDecryptedEnv } from "./settingsStore";
import type { ScienceToolResult } from "./scienceTools";

const execFileAsync = promisify(execFile);

/**
 * GitHub tools: open and inspect pull requests and issues for the repo the
 * workspace's `origin` remote points at. Token from GITHUB_TOKEN in the
 * per-project or global settings store, or the server env (like
 * VERCEL_TOKEN in deploy.ts). git runs via execFile — no shell.
 */

export type GithubToolResult = ScienceToolResult;

const API = "https://api.github.com";
const GIT_TIMEOUT_MS = 60_000;

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required } },
});

const STATES = ["open", "closed", "all"] as const;

export const GITHUB_TOOL_SCHEMAS = [
  fn(
    "github_create_pr",
    "Push the current branch to origin (git push -u origin <branch>) and open a GitHub pull request. Commit your changes first. Only call when the user asks for a PR. Requires GITHUB_TOKEN in Settings and a github.com origin remote.",
    {
      title: { type: "string", description: "PR title" },
      body: { type: "string", description: "PR description (Markdown)" },
      base: { type: "string", description: "Target branch (default: the repo's default branch)" },
      head: { type: "string", description: "Source branch (default: the current branch)" },
      draft: { type: "boolean", description: "Open as a draft PR" },
    },
    ["title", "body"]
  ),
  fn("github_list_prs", "List pull requests of the workspace's GitHub repo.", {
    state: { type: "string", enum: STATES, description: "Default open" },
  }),
  fn(
    "github_get_pr",
    "Get a pull request: description, branches, merge state, review comments and CI check-run conclusions.",
    { number: { type: "integer", description: "PR number" } },
    ["number"]
  ),
  fn(
    "github_comment",
    "Post a comment on a GitHub issue or pull request.",
    { number: { type: "integer", description: "Issue or PR number" }, body: { type: "string", description: "Comment (Markdown)" } },
    ["number", "body"]
  ),
  fn("github_list_issues", "List issues (not PRs) of the workspace's GitHub repo.", {
    state: { type: "string", enum: STATES, description: "Default open" },
    labels: { type: "array", items: { type: "string" }, description: "Only issues with all of these labels" },
  }),
  fn(
    "github_get_issue",
    "Get an issue with its comments.",
    { number: { type: "integer", description: "Issue number" } },
    ["number"]
  ),
];

const branchName = z.string().min(1).max(250).regex(/^[\w./-]+$/, "invalid branch name").refine((b) => !b.startsWith("-") && !b.includes(".."), "invalid branch name");
const num = z.number().int().min(1);

export const GITHUB_ZOD_SCHEMAS = {
  github_create_pr: z.object({
    title: z.string().min(1).max(256),
    body: z.string().max(65_000),
    base: branchName.optional(),
    head: branchName.optional(),
    draft: z.boolean().optional(),
  }),
  github_list_prs: z.object({ state: z.enum(STATES).optional() }),
  github_get_pr: z.object({ number: num }),
  github_comment: z.object({ number: num, body: z.string().min(1).max(65_000) }),
  github_list_issues: z.object({
    state: z.enum(STATES).optional(),
    labels: z.array(z.string().min(1).max(100)).max(20).optional(),
  }),
  github_get_issue: z.object({ number: num }),
};

export function isGithubTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(GITHUB_ZOD_SCHEMAS, name);
}

// ─── Repo / token resolution ──────────────────────────────────────────────────

export interface GithubRepo {
  owner: string;
  repo: string;
}

/** owner/repo from an https or ssh github.com remote URL, else null. */
export function parseGithubRemote(url: string): GithubRepo | null {
  const u = url.trim();
  const m =
    u.match(/^https?:\/\/(?:[^@/]+@)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i) ||
    u.match(/^(?:ssh:\/\/)?git@github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

async function git(workspace: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspace,
    timeout: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

export async function detectGithubRepo(workspace: string): Promise<GithubRepo> {
  let url: string;
  try {
    url = await git(workspace, ["remote", "get-url", "origin"]);
  } catch {
    throw new Error("No git remote 'origin' in this workspace. Add one with `git remote add origin https://github.com/<owner>/<repo>.git`.");
  }
  const repo = parseGithubRemote(url);
  if (!repo) throw new Error(`The origin remote (${url.replace(/\/\/[^@/]+@/, "//")}) is not a github.com repository.`);
  return repo;
}

export async function currentBranch(workspace: string): Promise<string> {
  const b = await git(workspace, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!b || b === "HEAD") throw new Error("Detached HEAD — check out a branch before opening a PR.");
  return b;
}

export async function resolveGithubToken(projectId: string): Promise<string> {
  let secrets: Record<string, string> = {};
  try {
    secrets = await getDecryptedEnv(projectId);
  } catch {}
  const token = secrets.GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "No GITHUB_TOKEN configured. Create a token at github.com/settings/tokens (repo scope) " +
        "and add it as GITHUB_TOKEN in Settings → Environment Variables."
    );
  }
  return token;
}

// ─── HTTP ──────────────────────────────────────────────────────────────────────

async function gh<T>(token: string, method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "open-code",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = data as { message?: string; errors?: { message?: string }[] } | null;
    const detail = [d?.message, ...(d?.errors ?? []).map((e) => e.message)].filter(Boolean).join("; ");
    throw new Error(`GitHub API ${method} ${pathname} failed (${res.status}): ${detail || String(text).slice(0, 300)}`);
  }
  return data as T;
}

interface GhUser { login: string }
interface GhPr {
  number: number; title: string; state: string; html_url: string; draft?: boolean; body?: string | null;
  user?: GhUser; head: { ref: string; sha: string }; base: { ref: string };
  merged?: boolean; mergeable?: boolean | null; mergeable_state?: string;
}
interface GhIssue {
  number: number; title: string; state: string; html_url: string; body?: string | null;
  user?: GhUser; labels?: ({ name?: string } | string)[]; pull_request?: unknown; comments?: number;
}
interface GhComment { user?: GhUser; body?: string; path?: string; line?: number | null; created_at?: string }

const who = (u?: GhUser) => (u?.login ? `@${u.login}` : "unknown");
const labelNames = (i: GhIssue) => (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean);
const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// ─── Executor ──────────────────────────────────────────────────────────────────

export async function executeGithubTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
  projectId: string
): Promise<GithubToolResult> {
  const token = await resolveGithubToken(projectId);
  const { owner, repo } = await detectGithubRepo(workspace);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const slug = `${owner}/${repo}`;

  switch (name) {
    case "github_create_pr": {
      const head = (args.head as string | undefined) || (await currentBranch(workspace));
      try {
        await git(workspace, ["push", "-u", "origin", head]);
      } catch (err) {
        const msg = (err as { stderr?: string }).stderr || (err instanceof Error ? err.message : String(err));
        throw new Error(`git push -u origin ${head} failed: ${String(msg).trim().slice(0, 800)}`);
      }
      let baseBranch = args.base as string | undefined;
      if (!baseBranch) {
        const info = await gh<{ default_branch: string }>(token, "GET", base);
        baseBranch = info.default_branch;
      }
      const pr = await gh<GhPr>(token, "POST", `${base}/pulls`, {
        title: args.title,
        body: args.body,
        head,
        base: baseBranch,
        draft: !!args.draft,
      });
      return {
        success: true,
        output: `Opened ${pr.draft ? "draft " : ""}PR #${pr.number} in ${slug}: ${pr.html_url}\n${head} → ${baseBranch}`,
        summary: `Opened PR #${pr.number} → ${pr.html_url}`,
        extra: { url: pr.html_url, number: pr.number },
      };
    }

    case "github_list_prs": {
      const state = (args.state as string) || "open";
      const prs = await gh<GhPr[]>(token, "GET", `${base}/pulls?state=${state}&per_page=30`);
      const lines = prs.map((p) => `#${p.number} [${p.state}${p.draft ? ", draft" : ""}] ${p.title} (${p.head.ref} → ${p.base.ref}, ${who(p.user)})`);
      return {
        success: true,
        output: lines.length ? `${state} PRs in ${slug}:\n${lines.join("\n")}` : `No ${state} PRs in ${slug}.`,
        summary: `${prs.length} ${state} PR${prs.length === 1 ? "" : "s"} in ${slug}`,
      };
    }

    case "github_get_pr": {
      const n = Number(args.number);
      const pr = await gh<GhPr>(token, "GET", `${base}/pulls/${n}`);
      const [reviewComments, issueComments, checks] = await Promise.all([
        gh<GhComment[]>(token, "GET", `${base}/pulls/${n}/comments?per_page=50`).catch(() => [] as GhComment[]),
        gh<GhComment[]>(token, "GET", `${base}/issues/${n}/comments?per_page=50`).catch(() => [] as GhComment[]),
        gh<{ check_runs?: { name: string; status: string; conclusion: string | null }[] }>(
          token, "GET", `${base}/commits/${pr.head.sha}/check-runs?per_page=50`
        ).catch(() => ({ check_runs: [] })),
      ]);
      const runs = checks.check_runs ?? [];
      const out = [
        `PR #${pr.number}: ${pr.title} [${pr.merged ? "merged" : pr.state}${pr.draft ? ", draft" : ""}]`,
        `${pr.html_url}`,
        `${pr.head.ref} → ${pr.base.ref} by ${who(pr.user)}; mergeable: ${pr.mergeable_state ?? String(pr.mergeable ?? "unknown")}`,
        "",
        clip(pr.body, 4000) || "(no description)",
        "",
        `Checks (${runs.length}):`,
        ...(runs.length ? runs.map((r) => `- ${r.name}: ${r.conclusion ?? r.status}`) : ["- none"]),
        "",
        `Review comments (${reviewComments.length}):`,
        ...reviewComments.map((c) => `- ${who(c.user)} on ${c.path ?? "?"}${c.line ? `:${c.line}` : ""}: ${clip(c.body, 600)}`),
        "",
        `Conversation (${issueComments.length}):`,
        ...issueComments.map((c) => `- ${who(c.user)}: ${clip(c.body, 600)}`),
      ];
      const failing = runs.filter((r) => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion)).length;
      return {
        success: true,
        output: out.join("\n"),
        summary: `PR #${pr.number}: ${runs.length} checks${failing ? ` (${failing} failing)` : ""}, ${reviewComments.length} review comments`,
      };
    }

    case "github_comment": {
      const n = Number(args.number);
      const c = await gh<{ html_url: string }>(token, "POST", `${base}/issues/${n}/comments`, { body: args.body });
      return { success: true, output: `Commented on #${n}: ${c.html_url}`, summary: `Commented on #${n}` };
    }

    case "github_list_issues": {
      const state = (args.state as string) || "open";
      const labels = (args.labels as string[] | undefined)?.join(",");
      const qs = `state=${state}&per_page=30${labels ? `&labels=${encodeURIComponent(labels)}` : ""}`;
      const issues = (await gh<GhIssue[]>(token, "GET", `${base}/issues?${qs}`)).filter((i) => !i.pull_request);
      const lines = issues.map((i) => {
        const l = labelNames(i);
        return `#${i.number} [${i.state}] ${i.title}${l.length ? ` {${l.join(", ")}}` : ""} (${who(i.user)})`;
      });
      return {
        success: true,
        output: lines.length ? `${state} issues in ${slug}:\n${lines.join("\n")}` : `No ${state} issues in ${slug}.`,
        summary: `${issues.length} ${state} issue${issues.length === 1 ? "" : "s"} in ${slug}`,
      };
    }

    case "github_get_issue": {
      const n = Number(args.number);
      const issue = await gh<GhIssue>(token, "GET", `${base}/issues/${n}`);
      const comments = await gh<GhComment[]>(token, "GET", `${base}/issues/${n}/comments?per_page=50`).catch(() => [] as GhComment[]);
      const l = labelNames(issue);
      const out = [
        `Issue #${issue.number}: ${issue.title} [${issue.state}]${l.length ? ` {${l.join(", ")}}` : ""}`,
        issue.html_url,
        `Opened by ${who(issue.user)}`,
        "",
        clip(issue.body, 6000) || "(no description)",
        "",
        `Comments (${comments.length}):`,
        ...comments.map((c) => `- ${who(c.user)}: ${clip(c.body, 800)}`),
      ];
      return { success: true, output: out.join("\n"), summary: `Issue #${issue.number}: ${clip(issue.title, 60)}` };
    }

    default:
      return { success: false, output: `Error: unknown GitHub tool ${name}`, summary: `Unknown tool ${name}`, error: "unknown tool" };
  }
}
