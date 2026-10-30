import { NextRequest, NextResponse } from "next/server";
import { taskDb } from "@/lib/db";
import { answerTask, cancelTask } from "@/lib/tasks";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/tasks/:id — one task with its timeline. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const task = taskDb.get((await params).id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ task });
}

/** POST /api/tasks/:id { answer } — answer the question the task is blocked on. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.answer !== "string" || !body.answer.trim()) {
    return NextResponse.json({ error: "answer is required" }, { status: 400 });
  }
  const ok = answerTask((await params).id, body.answer.trim());
  return ok
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "Task is not waiting for an answer" }, { status: 409 });
}

/** DELETE /api/tasks/:id — cancel a running task. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const ok = cancelTask((await params).id);
  return ok
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "Task is not running" }, { status: 409 });
}
