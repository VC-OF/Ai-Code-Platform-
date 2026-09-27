import { handleTtsRequest } from '@/lib/voice/voiceServer';

export const runtime = 'nodejs';

/** Speak text with a server voice provider; streams audio/mpeg back. */
export async function POST(req: Request) {
  return handleTtsRequest(req);
}
