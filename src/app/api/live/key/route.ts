import { NextRequest, NextResponse } from 'next/server';
import { getDecryptedEnv, setEnvVar } from '@/lib/settingsStore';

export async function GET() {
  try {
    // Settings-store keys overlay .env vars (same precedence as resolveProvider),
    // so a key saved from the UI wins over a stale one in .env.local.
    const envVars = await getDecryptedEnv();
    const key = envVars.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';

    if (key) {
      return NextResponse.json({ hasKey: true, apiKey: key });
    }
    return NextResponse.json({ hasKey: false });
  } catch (err) {
    return NextResponse.json(
      { hasKey: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey } = await req.json().catch(() => ({}));
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
    }
    const trimmed = apiKey.trim();
    if (trimmed.length < 20 || trimmed.length > 256 || /\s/.test(trimmed)) {
      return NextResponse.json({ error: 'apiKey does not look like a valid Gemini API key' }, { status: 400 });
    }
    await setEnvVar('GEMINI_API_KEY', trimmed);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
