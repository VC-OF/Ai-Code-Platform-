import { NextResponse } from "next/server";
import { buildReport } from "@/lib/store-impl";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const s = await getCurrentSession();
  if (!s)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const r = buildReport(params.id);
  if (!r)
    return NextResponse.json(
      { error: "Report not available" },
      { status: 404 }
    );
  // Candidates can only see their own report.
  if (s.role === "candidate") {
    const { getAttempt } = await import("@/lib/store-impl");
    const a = getAttempt(params.id);
    if (!a || a.candidateId !== s.sub) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  return NextResponse.json({ report: r });
}
