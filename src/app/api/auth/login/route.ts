import { NextRequest, NextResponse } from 'next/server';
import { loginUser, buildAuthCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { user, token } = await loginUser({
      email: body.email,
      password: body.password,
    });

    const response = NextResponse.json({ success: true, user });
    response.headers.set('Set-Cookie', buildAuthCookie(token));
    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}
