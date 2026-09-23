import { NextRequest, NextResponse } from "next/server";
import { saveAnswers, getAttempt } from "@/lib/store-impl";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await getCurrentSession();
  if (!s)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { attemptId, answers } = body as {
    attemptId: string;
    answers: Record<string, string | string[]>;
  };
  if (!attemptId || !answers) {
    return NextResponse.json(
      { error: "attemptId and answers required" },
      { status: 400 }
    );
  }
  const a = getAttempt(attemptId);
  if (!a)
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  if (s.role === "candidate" && a.candidateId !== s.sub) {
    return NextResponse.json({ error: "Not your attempt" }, { status: 403 });
  }
  const updated = saveAnswers(attemptId, answers);
  return NextResponse.json({ ok: true, autoSavedAt: updated?.autoSavedAt });
}
