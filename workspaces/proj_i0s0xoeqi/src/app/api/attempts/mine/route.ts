import { NextResponse } from "next/server";
import { listAllAttempts } from "@/lib/store-impl";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getCurrentSession();
  if (!s)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (s.role !== "candidate") {
    return NextResponse.json({ error: "Candidate only" }, { status: 403 });
  }
  const mine = listAllAttempts().filter((a) => a.candidateId === s.sub);
  return NextResponse.json({ attempts: mine });
}
