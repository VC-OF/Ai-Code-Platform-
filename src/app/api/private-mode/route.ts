import { NextResponse } from 'next/server';
import { isPrivateModeEnabled, setPrivateMode, getPrivateTools } from '@/lib/privateMode';

export async function GET() {
  return NextResponse.json({
    enabled: isPrivateModeEnabled(),
    privateTools: getPrivateTools(),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const enabled = Boolean(body.enabled);
    setPrivateMode(enabled);
    return NextResponse.json({
      success: true,
      enabled: isPrivateModeEnabled(),
      privateTools: getPrivateTools(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
