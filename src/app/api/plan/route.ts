import { NextRequest, NextResponse } from "next/server";
import { planDb } from "@/lib/db";

export const runtime = "nodejs";

/** The agent's persisted task plan for a project (read-only for the UI;
 *  the agent writes it via the update_plan tool). */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }
  return NextResponse.json({ tasks: planDb.get(projectId) });
}

export async function DELETE(req: NextRequest) {
  const { projectId } = await req.json();
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }
  planDb.clear(projectId);
  return NextResponse.json({ success: true });
}
