import { NextRequest, NextResponse } from "next/server";
// archiver v8 is class-based — the old callable `archiver("zip")` API is gone
import { ZipArchive } from "archiver";
import { getWorkspaceRoot } from "@/lib/workspace";
import { getProject } from "@/lib/projects";
import fs from "fs/promises";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") || "default";

  try {
    const root = getWorkspaceRoot(projectId);

    // Ensure directory exists
    try {
      await fs.access(root);
    } catch {
      return NextResponse.json(
        { error: "Project workspace not found" },
        { status: 404 }
      );
    }

    const project = await getProject(projectId);
    const title = project?.title
      ? project.title.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
      : "project";

    // Set up a TransformStream to pass data from archiver to NextResponse
    const { readable, writable } = new TransformStream();

    // archiver uses Node.js streams. We need to adapt them to web streams.
    const archive = new ZipArchive({ zlib: { level: 9 } });

    // Handle archiver errors
    archive.on("error", (err: Error) => {
      console.error("Archiver error:", err);
      // Can't really change the response status here since it's already streaming,
      // but we can close the stream with an error.
    });

    // Pipe the archive output to our WritableStream
    const writer = writable.getWriter();
    archive.on("data", (chunk: Uint8Array) => {
      writer.write(chunk);
    });
    archive.on("end", () => {
      writer.close();
    });

    // Append the workspace directory, excluding bulky/regenerable dirs
    const EXCLUDED = ["node_modules/", ".next/", ".git/", ".npm-cache/", "dist/"];
    archive.directory(root, false, (entry: { name: string }) => {
      const rel = entry.name.replace(/\\/g, "/");
      return EXCLUDED.some((p) => rel === p.slice(0, -1) || rel.startsWith(p))
        ? false
        : entry;
    });

    // Finalize the archive (this will flush and end the stream)
    archive.finalize();

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${title}-${projectId}.zip"`,
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
