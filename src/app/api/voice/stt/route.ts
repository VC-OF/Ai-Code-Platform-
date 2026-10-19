import { handleSttRequest } from '@/lib/voice/sttServer';

export const runtime = 'nodejs';

/** Transcribe a recorded audio clip with a server provider; returns { text }. */
export async function POST(req: Request) {
  return handleSttRequest(req);
}
