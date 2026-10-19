import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceRoot, ensureWorkspace } from "@/lib/workspace";
import { safeResolve } from "@/lib/safeResolve";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const projectId = (formData.get("projectId") as string) || "default";
    const destination = (formData.get("destination") as string) || "";
    const files = formData.getAll("files");

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "No files provided in request" },
        { status: 400 }
      );
    }

    await ensureWorkspace(projectId);
    const workspaceRoot = getWorkspaceRoot(projectId);

    const savedFiles: string[] = [];

    for (const item of files) {
      if (!(item instanceof File)) continue;

      const rawName = item.name;
      // Normalize slashes
      const cleanRel = path.join(destination, rawName).replace(/\\/g, "/");

      let safePath: string;
      try {
        safePath = safeResolve(workspaceRoot, cleanRel);
      } catch (secErr) {
        return NextResponse.json(
          { error: `Security check failed for path "${cleanRel}": ${String(secErr)}` },
          { status: 403 }
        );
      }

      await fs.mkdir(path.dirname(safePath), { recursive: true });

      const arrayBuffer = await item.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(safePath, buffer);

      savedFiles.push(cleanRel);
    }

    return NextResponse.json({
      success: true,
      count: savedFiles.length,
      files: savedFiles,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
