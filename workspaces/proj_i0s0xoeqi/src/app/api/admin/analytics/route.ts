import { NextResponse } from "next/server";
import { listAllAttempts, listExams, getCandidates } from "@/lib/store-impl";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getCurrentSession();
  if (!s)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (s.role === "candidate")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const exams = listExams();
  const attempts = listAllAttempts();
  const candidates = getCandidates();
  // Aggregate metrics
  const totals = {
    candidates: candidates.length,
    attempts: attempts.length,
    completed: attempts.filter((a) => a.status === "completed").length,
    inProgress: attempts.filter((a) => a.status === "in_progress").length,
    suspicious: attempts.filter((a) => a.status === "suspicious").length,
    terminated: attempts.filter((a) => a.status === "terminated").length,
    disconnected: attempts.filter((a) => a.status === "disconnected").length,
    averageScore:
      attempts.length === 0
        ? 0
        : Math.round(
            attempts.reduce((s, a) => s + (a.percentage ?? 0), 0) /
              attempts.length
          ),
    averageViolations:
      attempts.length === 0
        ? 0
        : Math.round(
            (attempts.reduce((s, a) => s + a.violations, 0) / attempts.length) *
              10
          ) / 10,
  };
  return NextResponse.json({ exams, attempts, totals });
}
