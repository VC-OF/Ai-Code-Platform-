import { NextRequest, NextResponse } from "next/server";
import { taskDb } from "@/lib/db";
import { delegateTask, TaskBusyError } from "@/lib/tasks";

export const runtime = "nodejs";

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** GET /api/tasks — newest delegated tasks first. */
export async function GET() {
  try {
    return NextResponse.json({ tasks: taskDb.list() });
  } catch (err) {
    return NextResponse.json({ error: errText(err) }, { status: 500 });
  }
}

/** POST /api/tasks { goal, projectId?, model?, deploy? } — hand a goal to the agent. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.goal !== "string" || !body.goal.trim()) {
    return NextResponse.json({ error: "goal is required" }, { status: 400 });
  }
  try {
    const task = await delegateTask(body.goal, {
      projectId: typeof body.projectId === "string" && body.projectId ? body.projectId : undefined,
      model: typeof body.model === "string" && body.model ? body.model : undefined,
      deploy: body.deploy === true,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: errText(err) }, { status: err instanceof TaskBusyError ? 409 : 400 });
  }
}
