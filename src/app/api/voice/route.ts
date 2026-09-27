import { NextResponse } from 'next/server';
import { getVoiceCatalog } from '@/lib/voice/voiceServer';

export const runtime = 'nodejs';

/** Text-to-speech providers and voices. Reports key presence only, never keys. */
export async function GET() {
  const catalog = await getVoiceCatalog();
  return NextResponse.json(catalog, { headers: { 'Cache-Control': 'no-store' } });
}
