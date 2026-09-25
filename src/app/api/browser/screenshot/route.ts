import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { safeResolve } from "@/lib/workspace";

/**
 * Serves browser_screenshot PNGs for timeline thumbnails. Confined to
 * <workspace>/.open-code/screenshots/*.png via safeResolve.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") || "";
  const rel = (searchParams.get("path") || "").replace(/\\/g, "/");
  if (!/^\.open-code\/screenshots\/[\w.-]+\.png$/.test(rel)) {
    return NextResponse.json({ error: "Invalid screenshot path" }, { status: 400 });
  }
  try {
    const full = safeResolve(rel, projectId);
    const buf = await fs.readFile(full);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
