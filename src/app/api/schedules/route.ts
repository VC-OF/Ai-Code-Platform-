import { NextRequest, NextResponse } from "next/server";
import { scheduleDb } from "@/lib/db";
import { createSchedule, ensureSchedulerStarted, setScheduleEnabled } from "@/lib/scheduler";

export const runtime = "nodejs";

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** GET /api/schedules[?projectId=] — list schedules. */
export async function GET(req: NextRequest) {
  ensureSchedulerStarted();
  try {
    const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
    return NextResponse.json({ schedules: scheduleDb.list(projectId) });
  } catch (err) {
    return NextResponse.json({ error: errText(err) }, { status: 500 });
  }
}

/** POST /api/schedules { projectId, cron, prompt, model? } */
export async function POST(req: NextRequest) {
  ensureSchedulerStarted();
  const body = await req.json().catch(() => ({}));
  if (typeof body.projectId !== "string" || typeof body.cron !== "string" || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "projectId, cron and prompt are required" }, { status: 400 });
  }
  try {
    const schedule = await createSchedule({
      projectId: body.projectId,
      cron: body.cron,
      prompt: body.prompt,
      model: typeof body.model === "string" ? body.model : null,
    });
    return NextResponse.json({ schedule });
  } catch (err) {
    return NextResponse.json({ error: errText(err) }, { status: 400 });
  }
}

/** PATCH /api/schedules { id, enabled } — pause / resume. */
export async function PATCH(req: NextRequest) {
  ensureSchedulerStarted();
  const body = await req.json().catch(() => ({}));
  if (typeof body.id !== "string" || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "id and enabled (boolean) are required" }, { status: 400 });
  }
  try {
    const ok = await setScheduleEnabled(body.id, body.enabled);
    if (!ok) return NextResponse.json({ error: `Schedule '${body.id}' not found` }, { status: 404 });
    return NextResponse.json({ schedule: scheduleDb.get(body.id) });
  } catch (err) {
    return NextResponse.json({ error: errText(err) }, { status: 500 });
  }
}

/** DELETE /api/schedules?id=<id> */
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    if (!scheduleDb.delete(id)) return NextResponse.json({ error: `Schedule '${id}' not found` }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: errText(err) }, { status: 500 });
  }
}
