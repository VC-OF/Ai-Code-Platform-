import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { getUserById } from "@/lib/store-impl";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getCurrentSession();
  if (!s) return NextResponse.json({ user: null });
  const u = getUserById(s.sub);
  if (!u) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      fullNameJa: u.fullNameJa,
      registrationNumber: u.registrationNumber,
      role: u.role,
    },
  });
}
