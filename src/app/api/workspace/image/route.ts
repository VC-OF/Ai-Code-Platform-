import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { safeResolve } from "@/lib/workspace";

/**
 * Serves raster images from a project workspace for the chat UI: figures
 * produced by execute_code, images the agent inspected with view_image, and
 * `![…](results/plot.png)` references in replies. Confined to the workspace
 * by safeResolve (which also refuses .env/.git/key files); SVG is excluded
 * because it can carry scripts.
 */
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const MAX_BYTES = 20 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") || "";
  const rel = (searchParams.get("path") || "").replace(/\\/g, "/");
  const ext = rel.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const type = CONTENT_TYPES[ext];
  if (!projectId || !rel || !type) {
    return NextResponse.json({ error: "Invalid image path" }, { status: 400 });
  }
  try {
    const full = safeResolve(rel, projectId);
    const stat = await fs.stat(full);
    if (!stat.isFile() || stat.size > MAX_BYTES) {
      return NextResponse.json({ error: "Not an image file" }, { status: 400 });
    }
    // Figures are regenerated under the same name — validate freshness by mtime
    const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }
    const buf = await fs.readFile(full);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, no-cache",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
