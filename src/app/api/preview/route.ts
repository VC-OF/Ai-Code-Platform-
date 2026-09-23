import { NextRequest, NextResponse } from "next/server";
import {
  startPreview,
  stopPreview,
  getPreviewStatus,
} from "@/lib/previewManager";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") || "default";
  return NextResponse.json(getPreviewStatus(projectId));
}

export async function POST(req: NextRequest) {
  const { action, projectId = "default" } = await req.json();
  if (action === "start") {
    const result = await startPreview(projectId);
    return NextResponse.json(result);
  }
  if (action === "stop") {
    const result = stopPreview(projectId);
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
