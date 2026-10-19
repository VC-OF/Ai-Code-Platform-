import { NextRequest, NextResponse } from "next/server";
import { getProjectByShareToken } from "@/lib/projects";
import { getWorkspaceRoot } from "@/lib/workspace";
import fs from "fs/promises";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const project = await getProjectByShareToken(token);
    if (!project) {
      return NextResponse.json(
        { error: "Shared project not found or sharing has been disabled" },
        { status: 404 }
      );
    }

    // List top-level files for overview
    const workspaceRoot = getWorkspaceRoot(project.id);
    let files: string[] = [];
    try {
      const entries = await fs.readdir(workspaceRoot);
      files = entries.filter((e) => !e.startsWith("."));
    } catch {}

    return NextResponse.json({
      project: {
        id: project.id,
        title: project.title,
        kind: project.kind,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      files,
      isReadOnly: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
