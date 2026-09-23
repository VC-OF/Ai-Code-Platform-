import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceRoot, ensureWorkspace } from "@/lib/workspace";
import { deployToVercel, resolveVercelToken } from "@/lib/deploy";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") || "default";
  const token = await resolveVercelToken(projectId);
  return NextResponse.json({ configured: !!token });
}

export async function POST(req: NextRequest) {
  try {
    const { projectId = "default" } = await req.json();
    await ensureWorkspace(projectId);
    const root = getWorkspaceRoot(projectId);

    const result = await deployToVercel(projectId, root);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("No VERCEL_TOKEN") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
