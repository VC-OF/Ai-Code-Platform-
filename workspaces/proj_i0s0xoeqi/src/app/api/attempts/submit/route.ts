import { NextRequest, NextResponse } from "next/server";
import { finalizeAttempt, getAttempt, setStatus } from "@/lib/store-impl";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await getCurrentSession();
  if (!s)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { attemptId, autoSubmit, terminated } = await req
    .json()
    .catch(() => ({}));
  if (!attemptId)
    return NextResponse.json({ error: "attemptId required" }, { status: 400 });
  const a = getAttempt(attemptId);
  if (!a)
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  if (s.role === "candidate" && a.candidateId !== s.sub) {
    return NextResponse.json({ error: "Not your attempt" }, { status: 403 });
  }
  setStatus(attemptId, terminated ? "terminated" : "completed");
  const updated = finalizeAttempt(attemptId, {
    autoSubmit: !!autoSubmit,
    terminated: !!terminated,
  });
  return NextResponse.json({ ok: true, attempt: updated });
}
