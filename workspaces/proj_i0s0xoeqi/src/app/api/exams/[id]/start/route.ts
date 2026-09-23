import { NextRequest, NextResponse } from "next/server";
import {
  getExam,
  getOrCreateAttempt,
  startAttempt,
  listQuestionsForExam,
} from "@/lib/store-impl";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const s = await getCurrentSession();
  if (!s)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const exam = getExam(params.id);
  if (!exam)
    return NextResponse.json({ error: "Exam not found" }, { status: 404 });
  if (s.role === "candidate" && !exam.assignedCandidateIds.includes(s.sub)) {
    return NextResponse.json(
      { error: "Not assigned to this exam" },
      { status: 403 }
    );
  }
  const attempt = getOrCreateAttempt(exam.id, s.sub);
  if (!attempt.startedAt) startAttempt(attempt.id);
  // Return the attempt id and the questions (without correct answers).
  const questions = listQuestionsForExam(exam.id).map((q) => ({
    id: q.id,
    type: q.type,
    section: q.section,
    level: q.level,
    prompt: q.prompt,
    promptJa: q.promptJa,
    readingPassage: q.readingPassage,
    audioUrl: q.audioUrl,
    imageUrl: q.imageUrl,
    choices: q.choices,
    points: q.points,
  }));
  return NextResponse.json({
    attempt: {
      id: attempt.id,
      startedAt: attempt.startedAt,
      status: attempt.status,
    },
    exam: {
      id: exam.id,
      title: exam.title,
      titleJa: exam.titleJa,
      level: exam.level,
      durationMinutes: exam.durationMinutes,
      totalPoints: exam.totalPoints,
      passingScore: exam.passingScore,
      antiCheating: exam.antiCheating,
    },
    questions,
  });
}
