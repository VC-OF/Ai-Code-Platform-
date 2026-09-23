import { NextRequest, NextResponse } from "next/server";
import { createExam } from "@/lib/store-impl";
import { getCurrentSession } from "@/lib/session";
import type { ExamLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await getCurrentSession();
  if (!s || s.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body.title || !body.level) {
    return NextResponse.json(
      { error: "title and level required" },
      { status: 400 }
    );
  }
  const exam = createExam({
    title: body.title,
    titleJa: body.titleJa,
    level: body.level as ExamLevel,
    description: body.description ?? "",
    durationMinutes: Number(body.durationMinutes ?? 60),
    passingScore: Number(body.passingScore ?? 0),
    totalPoints: Number(body.totalPoints ?? 0),
    startWindowStart: body.startWindowStart,
    startWindowEnd: body.startWindowEnd,
    questionIds: body.questionIds ?? [],
    assignedCandidateIds: body.assignedCandidateIds ?? [],
    antiCheating: body.antiCheating,
    status: body.status ?? "scheduled",
  });
  return NextResponse.json({ exam });
}
