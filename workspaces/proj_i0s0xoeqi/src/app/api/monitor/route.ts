import { NextResponse } from "next/server";
import { liveDashboard } from "@/lib/store-impl";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getCurrentSession();
  if (!s)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (s.role === "candidate")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const d = liveDashboard();
  return NextResponse.json({ dashboard: d });
}
