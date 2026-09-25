import { NextRequest, NextResponse } from "next/server";
import {
  startPreview,
  stopPreview,
  getPreviewStatus,
  runCli,
} from "@/lib/previewManager";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") || "default";
  return NextResponse.json(getPreviewStatus(projectId));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { action, projectId = "default" } = body;
  if (action === "start") {
    const result = await startPreview(projectId);
    return NextResponse.json(result);
  }
  if (action === "run") {
    // CLI projects: run the default command in a sandbox container
    return NextResponse.json(await runCli(projectId));
  }
  if (action === "stop") {
    const result = stopPreview(projectId);
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
