import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Simulated OTP: any 6-digit code ending in "42" succeeds; others reject.
const VALID_SUFFIX = "42";

export async function POST(req: NextRequest) {
  const s = await getCurrentSession();
  if (!s)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { code, attemptId } = await req.json().catch(() => ({}));
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid code format" }, { status: 400 });
  }
  if (!code.endsWith(VALID_SUFFIX)) {
    return NextResponse.json(
      { error: "Incorrect verification code" },
      { status: 401 }
    );
  }
  return NextResponse.json({ ok: true, attemptId });
}
