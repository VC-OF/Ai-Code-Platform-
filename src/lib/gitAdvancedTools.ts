import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { safeResolve } from "./safeResolve";
import { ensureOpenCodeIgnored } from "./openCodeDir";
import type { ScienceToolResult } from "./scienceTools";

const execFileAsync = promisify(execFile);

export type GitAdvancedToolResult = ScienceToolResult;

const GIT_TIMEOUT_MS = 60_000;

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
      },
    });
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message: string; code?: number };
    const errText = (error.stderr || error.stdout || error.message || "").trim();
    throw new Error(`git ${args[0]} failed: ${errText}`);
  }
}

// Ensure .open-code/ directory is excluded in .git/info/exclude
async function ensureGitExclude(workspace: string): Promise<void> {
  try {
    const { stdout } = await runGit(workspace, ["rev-parse", "--git-common-dir"]);
    const gitDir = stdout.trim();
    const excludePath = path.isAbsolute(gitDir)
      ? path.join(gitDir, "info", "exclude")
      : path.join(workspace, gitDir, "info", "exclude");

    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    let current = "";
    try {
      current = await fs.readFile(excludePath, "utf-8");
    } catch {}

    if (!current.split(/\r?\n/).includes(".open-code/")) {
      const updated = `${current}${current && !current.endsWith("\n") ? "\n" : ""}.open-code/\n`;
      await fs.writeFile(excludePath, updated, "utf-8");
    }
  } catch {
    // Non-fatal if git exclude cannot be modified
  }
}

// ─── Schemas ───────────────────────────────────────────────────────────────────

const fn = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = []
) => ({
  type: "function" as const,
  function: {
    name,
    description,
    parameters: { type: "object", properties, required },
  },
});

export const GIT_ADVANCED_TOOL_SCHEMAS = [
  fn(
    "git_worktree_create",
    "Create an isolated git worktree at .open-code/worktrees/<name>. Enables subagents or speculative tasks to make changes in parallel without interfering with the primary workspace files.",
    {
      name: {
        type: "string",
        description: "Identifier/folder name for the worktree (e.g. 'feature-auth', 'agent-scratch')",
      },
      branch: {
        type: "string",
        description: "Branch name to create or checkout (defaults to 'worktree-<name>')",
      },
      commit: {
        type: "string",
        description: "Base commit hash or branch to branch off of (defaults to HEAD)",
      },
    },
    ["name"]
  ),
  fn("git_worktree_list", "List all active git worktrees with their filesystem paths, commit hashes, and branches."),
  fn(
    "git_worktree_remove",
    "Safely remove a git worktree and clean up its filesystem directory and git worktree metadata.",
    {
      name: {
        type: "string",
        description: "Name or relative path of the worktree to remove",
      },
      delete_branch: {
        type: "boolean",
        description: "Whether to delete the associated git branch as well (default: false)",
      },
    },
    ["name"]
  ),
  fn(
    "git_stash_push",
    "Save uncommitted workspace changes to a git stash snapshot to allow safe experimentation or switching branches without losing work.",
    {
      message: {
        type: "string",
        description: "Optional description for this stash snapshot",
      },
      include_untracked: {
        type: "boolean",
        description: "Include untracked newly-created files in the stash (default: true)",
      },
    }
  ),
  fn(
    "git_stash_pop",
    "Restore the most recently stashed changes (or a specific stash index) back to the working directory.",
    {
      index: {
        type: "integer",
        description: "Stash index to pop (e.g. 0 for stash@{0}; default: 0)",
      },
    }
  ),
  fn("git_stash_list", "List all available git stash snapshots with indices and descriptions."),
  fn(
    "git_blame",
    "Inspect commit author, date, and history line-by-line for a file to understand why code was written.",
    {
      path: {
        type: "string",
        description: "Workspace-relative file path to blame",
      },
      start_line: {
        type: "integer",
        description: "First line to inspect (1-indexed, optional)",
      },
      end_line: {
        type: "integer",
        description: "Last line to inspect (1-indexed, inclusive, optional)",
      },
    },
    ["path"]
  ),
];

export const GIT_ADVANCED_ZOD_SCHEMAS = {
  git_worktree_create: z.object({
    name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "Name must be alphanumeric with dashes/underscores"),
    branch: z.string().min(1).max(100).optional(),
    commit: z.string().max(100).optional(),
  }),
  git_worktree_list: z.object({}).optional(),
  git_worktree_remove: z.object({
    name: z.string().min(1).max(200),
    delete_branch: z.boolean().optional(),
  }),
  git_stash_push: z.object({
    message: z.string().max(200).optional(),
    include_untracked: z.boolean().optional(),
  }),
  git_stash_pop: z.object({
    index: z.number().int().min(0).max(100).optional(),
  }),
  git_stash_list: z.object({}).optional(),
  git_blame: z.object({
    path: z.string().min(1).max(500),
    start_line: z.number().int().min(1).optional(),
    end_line: z.number().int().min(1).optional(),
  }),
};

const GIT_ADVANCED_NAMES = new Set(GIT_ADVANCED_TOOL_SCHEMAS.map((s) => s.function.name));

export function isGitAdvancedTool(name: string): boolean {
  return GIT_ADVANCED_NAMES.has(name);
}

// ─── Executor ──────────────────────────────────────────────────────────────────

export async function executeGitAdvancedTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string
): Promise<GitAdvancedToolResult> {
  // Verify workspace is in a git repository
  try {
    await runGit(workspace, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return {
      success: false,
      output: "Error: Current workspace is not a valid git repository or git is not installed.",
      summary: "Git operation failed: not a git repo",
      error: "Workspace is not a git repository",
    };
  }

  await ensureGitExclude(workspace);
  await ensureOpenCodeIgnored(workspace);

  switch (name) {
    case "git_worktree_create": {
      const wtName = String(args.name);
      const branch = args.branch ? String(args.branch) : `worktree-${wtName}`;
      const base = args.commit ? String(args.commit) : "HEAD";
      const wtRelPath = path.join(".open-code", "worktrees", wtName).replace(/\\/g, "/");
      safeResolve(workspace, wtRelPath);

      // Check if branch already exists
      let branchExists = false;
      try {
        await runGit(workspace, ["rev-parse", "--verify", `refs/heads/${branch}`]);
        branchExists = true;
      } catch {}

      const gitArgs = branchExists
        ? ["worktree", "add", wtRelPath, branch]
        : ["worktree", "add", "-b", branch, wtRelPath, base];

      try {
        await runGit(workspace, gitArgs);
        return {
          success: true,
          output:
            `Created git worktree '${wtName}':\n` +
            `Path: ${wtRelPath}\n` +
            `Branch: ${branch}\n` +
            `Base: ${base}\n\n` +
            `Sub-agents or parallel commands can operate safely inside this worktree directory.`,
          summary: `Created worktree ${wtName} (${branch})`,
          extra: { name: wtName, path: wtRelPath, branch, base },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: `Failed to create worktree '${wtName}': ${msg}`,
          summary: `Failed to create worktree ${wtName}`,
          error: msg,
        };
      }
    }

    case "git_worktree_list": {
      try {
        const { stdout } = await runGit(workspace, ["worktree", "list", "--porcelain"]);
        const blocks = stdout.trim().split(/\n\n+/);
        const worktrees: { path: string; head: string; branch: string; bare?: boolean }[] = [];

        for (const block of blocks) {
          if (!block.trim()) continue;
          let wtPath = "";
          let head = "";
          let branch = "";
          let bare = false;

          for (const line of block.split("\n")) {
            if (line.startsWith("worktree ")) wtPath = line.slice(9);
            else if (line.startsWith("HEAD ")) head = line.slice(5);
            else if (line.startsWith("branch ")) branch = line.slice(7).replace("refs/heads/", "");
            else if (line === "bare") bare = true;
          }
          if (wtPath) {
            const rel = path.relative(workspace, wtPath) || ". (main workspace)";
            worktrees.push({ path: rel.replace(/\\/g, "/"), head: head.slice(0, 8), branch: branch || "(detached)", bare });
          }
        }

        const lines = worktrees.map(
          (w) => `• ${w.path} [${w.branch}] @ ${w.head}${w.bare ? " (bare)" : ""}`
        );

        return {
          success: true,
          output: `Active git worktrees (${worktrees.length}):\n\n${lines.join("\n")}`,
          summary: `Listed ${worktrees.length} git worktree(s)`,
          extra: { count: worktrees.length, worktrees },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: `Failed to list worktrees: ${msg}`,
          summary: "Failed to list worktrees",
          error: msg,
        };
      }
    }

    case "git_worktree_remove": {
      const rawName = String(args.name);
      const deleteBranch = Boolean(args.delete_branch);
      const wtRelPath = rawName.includes(".open-code/worktrees")
        ? rawName.replace(/\\/g, "/")
        : path.join(".open-code", "worktrees", rawName).replace(/\\/g, "/");

      try {
        // Try getting associated branch before removal
        let associatedBranch = "";
        try {
          const { stdout: listOut } = await runGit(workspace, ["worktree", "list", "--porcelain"]);
          const blocks = listOut.trim().split(/\n\n+/);
          for (const block of blocks) {
            if (block.includes(wtRelPath) || block.includes(rawName)) {
              for (const line of block.split("\n")) {
                if (line.startsWith("branch ")) {
                  associatedBranch = line.slice(7).replace("refs/heads/", "");
                }
              }
            }
          }
        } catch {}

        await runGit(workspace, ["worktree", "remove", "--force", wtRelPath]);
        await runGit(workspace, ["worktree", "prune"]);

        let branchMsg = "";
        if (deleteBranch && associatedBranch) {
          try {
            await runGit(workspace, ["branch", "-D", associatedBranch]);
            branchMsg = ` (and deleted branch '${associatedBranch}')`;
          } catch {
            branchMsg = ` (branch '${associatedBranch}' could not be deleted)`;
          }
        }

        return {
          success: true,
          output: `Successfully removed worktree '${wtRelPath}'${branchMsg}.`,
          summary: `Removed worktree ${rawName}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: `Failed to remove worktree '${wtRelPath}': ${msg}`,
          summary: `Failed to remove worktree ${rawName}`,
          error: msg,
        };
      }
    }

    case "git_stash_push": {
      const message = args.message ? String(args.message) : undefined;
      const includeUntracked = args.include_untracked !== false;

      const gitArgs = ["stash", "push"];
      if (includeUntracked) gitArgs.push("-u");
      if (message) gitArgs.push("-m", message);

      try {
        const { stdout } = await runGit(workspace, gitArgs);
        const out = stdout.trim();
        const success = !out.includes("No local changes to save");
        return {
          success: true,
          output: out || "Saved working directory changes to stash.",
          summary: success ? `Git stash: saved changes` : "Git stash: no changes to save",
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: `Git stash failed: ${msg}`,
          summary: "Git stash push failed",
          error: msg,
        };
      }
    }

    case "git_stash_pop": {
      const index = args.index !== undefined ? Number(args.index) : 0;
      const stashRef = `stash@{${index}}`;

      try {
        const { stdout } = await runGit(workspace, ["stash", "pop", stashRef]);
        return {
          success: true,
          output: `Successfully restored ${stashRef}:\n\n${stdout.trim()}`,
          summary: `Git stash popped ${stashRef}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: `Failed to pop ${stashRef}: ${msg}`,
          summary: `Git stash pop failed (${stashRef})`,
          error: msg,
          suggestion: "Check git status for unmerged conflicts before popping.",
        };
      }
    }

    case "git_stash_list": {
      try {
        const { stdout } = await runGit(workspace, ["stash", "list"]);
        const list = stdout.trim();
        if (!list) {
          return {
            success: true,
            output: "No git stashes currently exist in this repository.",
            summary: "Git stash: empty",
          };
        }
        const lines = list.split("\n");
        return {
          success: true,
          output: `Git Stash History (${lines.length}):\n\n${list}`,
          summary: `Git stash: ${lines.length} snapshot(s)`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: `Failed to list stashes: ${msg}`,
          summary: "Git stash list failed",
          error: msg,
        };
      }
    }

    case "git_blame": {
      const relPath = String(args.path);
      safeResolve(workspace, relPath);
      const startLine = args.start_line !== undefined ? Number(args.start_line) : undefined;
      const endLine = args.end_line !== undefined ? Number(args.end_line) : undefined;

      const gitArgs = ["blame", "--date=short"];
      if (startLine !== undefined && endLine !== undefined) {
        gitArgs.push(`-L`, `${startLine},${endLine}`);
      } else if (startLine !== undefined) {
        gitArgs.push(`-L`, `${startLine},+50`);
      }
      gitArgs.push(relPath);

      try {
        const { stdout } = await runGit(workspace, gitArgs);
        return {
          success: true,
          output: `Git Blame for ${relPath}:\n\n${stdout.trim()}`,
          summary: `Blamed ${relPath}${startLine ? ` L${startLine}-${endLine ?? ""}` : ""}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: `Git blame failed for '${relPath}': ${msg}`,
          summary: `Git blame failed: ${relPath}`,
          error: msg,
        };
      }
    }

    default:
      return {
        success: false,
        output: `Unknown git advanced tool: ${name}`,
        summary: `Unknown tool ${name}`,
        error: `Unknown tool ${name}`,
      };
  }
}
