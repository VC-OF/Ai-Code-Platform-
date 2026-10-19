import { NextRequest, NextResponse } from 'next/server';
import { extractAuthToken, logoutUser, buildClearAuthCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const token = extractAuthToken(req);
    if (token) {
      logoutUser(token);
    }
    const response = NextResponse.json({ success: true });
    response.headers.set('Set-Cookie', buildClearAuthCookie());
    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
