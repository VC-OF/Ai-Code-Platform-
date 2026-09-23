import { NextResponse } from "next/server";
import { listExams } from "@/lib/store-impl";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getCurrentSession();
  if (!s)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const exams = listExams();
  // Candidates only see exams they're assigned to.
  const visible =
    s.role === "admin" || s.role === "invigilator"
      ? exams
      : exams.filter((e) => e.assignedCandidateIds.includes(s.sub));
  return NextResponse.json({ exams: visible });
}
