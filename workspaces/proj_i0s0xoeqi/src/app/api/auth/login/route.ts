import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/store-impl";
import { signSession, setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email, password, registrationNumber } = body as {
    email?: string;
    password?: string;
    registrationNumber?: string;
  };
  if (!password) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }
  let user = null;
  if (email) {
    user = authenticate(email, password);
  } else if (registrationNumber) {
    const { findUserByRegistration, authenticate: auth } =
      await import("@/lib/store-impl");
    const u = findUserByRegistration(registrationNumber);
    if (u) user = auth(u.email, password);
  }
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const token = await signSession({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.fullName,
  });
  await setSessionCookie(token);
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      fullNameJa: user.fullNameJa,
      registrationNumber: user.registrationNumber,
      role: user.role,
    },
  });
}
