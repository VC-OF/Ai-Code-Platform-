import path from "path";
import fs from "fs/promises";
import { projectDb } from "./db";

/**
 * All AI file operations are jailed inside WORKSPACE_ROOT.
 * This is the "sandbox" boundary for the simple (no-Docker) MVP mode.
 * Every path coming from the LLM is resolved and verified to stay
 * inside this directory before any fs operation runs.
 *
 * Normal ("app") projects live under workspaces/<id> — computed here.
 * Build Mode projects point at an arbitrary host folder, stored verbatim
 * in the DB's `workspace` column — looked up here so every existing call
 * site (files, download, command, git, deploy, preview routes) is
 * Build-Mode-aware without individual changes. The DB lookup is a
 * synchronous, indexed better-sqlite3 read (sub-millisecond); the
 * try/catch falls back to the computed default when the DB isn't ready
 * yet or the row doesn't exist (e.g. mid-creation, "default" project).
 */
export function getWorkspaceRoot(projectId: string = "default"): string {
  // Reject rather than silently strip — stripping could collapse two
  // different ids (e.g. "../x" and "x") into the same folder
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error(`Invalid project id: '${projectId}'`);
  }

  try {
    const row = projectDb.getById(projectId);
    if (row?.workspace) return row.workspace;
  } catch {
    // DB unavailable or row not found yet — fall through to the default
  }

  return path.join(process.cwd(), "workspaces", projectId);
}

export async function ensureWorkspace(projectId: string = "default") {
  const root = getWorkspaceRoot(projectId);
  await fs.mkdir(root, { recursive: true });
}

/**
 * Resolve a user/LLM supplied relative path safely.
 * Throws if the resolved path escapes the workspace root
 * (blocks things like "../../etc/passwd" or absolute paths).
 */
import { safeResolve as coreSafeResolve } from "./safeResolve";

export function safeResolve(
  relativePath: string,
  projectId: string = "default"
): string {
  const root = getWorkspaceRoot(projectId);
  return coreSafeResolve(root, relativePath);
}

export function toRelative(
  absolutePath: string,
  projectId: string = "default"
): string {
  const root = getWorkspaceRoot(projectId);
  return path.relative(root, absolutePath) || ".";
}
