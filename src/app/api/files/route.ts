import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  getWorkspaceRoot,
  safeResolve,
  toRelative,
  ensureWorkspace,
} from "@/lib/workspace";

const execFileAsync = promisify(execFile);

const IGNORE = new Set(["node_modules", ".next", ".git"]);

async function walk(
  dir: string,
  projectId: string = "default"
): Promise<{ path: string; isDirectory: boolean }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: { path: string; isDirectory: boolean }[] = [];
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    results.push({
      path: toRelative(full, projectId),
      isDirectory: entry.isDirectory(),
    });
    if (entry.isDirectory()) {
      results.push(...(await walk(full, projectId)));
    }
  }
  return results;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") || "default";
  await ensureWorkspace(projectId);

  const filePath = searchParams.get("path");
  const version = searchParams.get("version");

  try {
    if (filePath) {
      const full = safeResolve(filePath, projectId);
      const stat = await fs.stat(full);
      if (stat.isDirectory()) {
        return NextResponse.json(
          { error: "Path is a directory" },
          { status: 400 }
        );
      }

      if (version === "git") {
        const root = getWorkspaceRoot(projectId);
        try {
          // Normalize to forward slashes for git
          const normalizedPath = filePath.replace(/\\/g, "/");
          const { stdout } = await execFileAsync(
            "git",
            ["show", `HEAD:${normalizedPath}`],
            { cwd: root }
          );
          return NextResponse.json({ path: filePath, content: stdout });
        } catch {
          // File might not be tracked in git yet
          return NextResponse.json({ path: filePath, content: "" });
        }
      }

      const content = await fs.readFile(full, "utf8");
      return NextResponse.json({ path: filePath, content });
    }

    const root = getWorkspaceRoot(projectId);
    const tree = await walk(root, projectId);
    return NextResponse.json({ tree });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = body.projectId || "default";
    await ensureWorkspace(projectId);

    const { path: relPath, content } = body;
    if (!relPath) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 }
      );
    }
    const full = safeResolve(relPath, projectId);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content ?? "", "utf8");
    return NextResponse.json({ success: true, path: relPath });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId") || "default";
    await ensureWorkspace(projectId);

    let relPath = searchParams.get("path");
    if (!relPath) {
      const body = await req.json().catch(() => ({}));
      relPath = body.path;
    }
    if (!relPath) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 }
      );
    }
    const full = safeResolve(relPath, projectId);
    await fs.rm(full, { recursive: true, force: true });
    return NextResponse.json({ success: true, path: relPath });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
