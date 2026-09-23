import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getWorkspaceRoot, safeResolve, ensureWorkspace } from "@/lib/workspace";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = body.projectId || "default";
    const filePath = body.path;

    if (!filePath) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 }
      );
    }

    await ensureWorkspace(projectId);
    const root = getWorkspaceRoot(projectId);

    // Validate the path stays inside the workspace before handing it to git
    safeResolve(filePath, projectId);
    const normalizedPath = filePath.replace(/\\/g, "/");

    await execFileAsync("git", ["checkout", "HEAD", "--", normalizedPath], {
      cwd: root,
    });

    return NextResponse.json({ success: true, path: filePath });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
