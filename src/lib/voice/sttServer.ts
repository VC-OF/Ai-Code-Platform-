// Server-only speech-to-text: proxy a recorded audio clip to a provider's
// transcription API. Mirrors voiceServer: keys come from the encrypted
// settings store (global scope) with process.env as the fallback, and never
// leave the server. Provider the audio came from is never stored on disk.

import { getDecryptedEnv } from '@/lib/settingsStore';
import {
  OPENAI_BASE_URL_ENVS,
  OPENAI_KEY_ENV,
  OPENAI_TTS_KEY_ENV,
  PROVIDER_LABELS,
  SERVER_TRANSCRIBE_PROVIDERS,
  TRANSCRIBE_MODEL,
  TRANSCRIBE_MAX_UPLOAD_BYTES,
  type ServerSttProviderId,
} from './providers';

export interface SttServerDeps {
  fetchImpl?: typeof fetch;
  getEnv?: () => Promise<Record<string, string>>;
  /** Upstream transcription timeout */
  timeoutMs?: number;
}

const DEFAULT_STT_TIMEOUT_MS = 30_000;

function isOpenAiApiUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

export async function resolveSttConfig(
  getEnv: () => Promise<Record<string, string>> = () => getDecryptedEnv()
): Promise<{ keys: Partial<Record<ServerSttProviderId, string>>; openaiKeyWithheld?: string }> {
  let env: Record<string, string> = {};
  try {
    env = await getEnv();
  } catch {
    // Unreadable settings: fall back to process.env only
  }
  const read = (name: string) => {
    const v = env[name] || process.env[name];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  // OPENAI_API_KEY also authenticates the LLM client, which may point at a
  // gateway: only send it to api.openai.com when that is where it belongs
  const dedicatedKey = read(OPENAI_TTS_KEY_ENV);
  const sharedKey = read(OPENAI_KEY_ENV);
  const customBase = OPENAI_BASE_URL_ENVS.find((name) => {
    const url = read(name);
    return url !== undefined && !isOpenAiApiUrl(url);
  });
  const withheld = !dedicatedKey && sharedKey && customBase ? gatewayKeyMessage(customBase) : undefined;
  return {
    keys: { openai: dedicatedKey ?? (customBase ? undefined : sharedKey) },
    ...(withheld ? { openaiKeyWithheld: withheld } : {}),
  };
}

function gatewayKeyMessage(baseUrlName: string): string {
  const url = process.env[baseUrlName] || '';
  return `OPENAI_API_KEY belongs to a custom endpoint (${url}). Set ${OPENAI_TTS_KEY_ENV} to use OpenAI transcription.`;
}

function missingKeyMessage(provider: 'openai'): string {
  return `${PROVIDER_LABELS[provider]} transcription needs ${OPENAI_TTS_KEY_ENV} or ${OPENAI_KEY_ENV}. Add one in Settings → API keys.`;
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

const jsonError = (status: number, error: string, code?: string) =>
  Response.json(code ? { error, code } : { error }, { status, headers: { 'Cache-Control': 'no-store' } });

/** POST /api/voice/stt: multipart form (audio blob) → { text }. */
export async function handleSttRequest(req: Request, deps: SttServerDeps = {}): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, 'Send the recorded audio as a multipart form field named "audio".');
  }
  const audio = form.get('audio');
  if (!(audio instanceof File)) return jsonError(400, 'Field "audio" is required.');
  if (audio.size === 0) return jsonError(400, 'The recorded audio is empty.');
  if (audio.size > TRANSCRIBE_MAX_UPLOAD_BYTES) {
    return jsonError(400, `The recording is too large (${(audio.size / 1_048_576).toFixed(1)} MB; the limit is 25 MB).`);
  }

  const providerRaw = form.get('provider');
  const provider: ServerSttProviderId = providerRaw === 'elevenlabs' ? 'openai' : 'openai';
  if (!SERVER_TRANSCRIBE_PROVIDERS.includes(provider)) {
    return jsonError(400, 'Server transcription currently supports the OpenAI audio API.');
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_STT_TIMEOUT_MS;
  const config = await resolveSttConfig(deps.getEnv);
  const apiKey = provider === 'openai' ? config.keys.openai : undefined;
  if (!apiKey) {
    return jsonError(400, provider === 'openai' ? (config.openaiKeyWithheld ?? missingKeyMessage('openai')) : missingKeyMessage('openai'), 'auth');
  }

  const upstream = new FormData();
  const name = audio.name || 'audio.webm';
  upstream.append('file', new Blob([audio], { type: audio.type || 'audio/webm' }), name);
  upstream.append('model', TRANSCRIBE_MODEL);
  upstream.append('response_format', 'json');

  let res: Response;
  try {
    res = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (err) {
    return jsonError(502, isTimeout(err) ? 'Transcription did not respond in time.' : 'Could not reach OpenAI transcription.');
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j.error?.message ?? '';
    } catch {
      // non-JSON body; the status code says enough
    }
    console.warn(`[voice] ${provider} transcription failed: HTTP ${res.status}`);
    if (res.status === 401 || res.status === 403) return jsonError(502, 'The transcription API rejected the key.', 'auth');
    if (res.status === 404) return jsonError(502, 'This account or gateway has no transcription model.', 'not_found');
    return jsonError(502, `Transcription failed (HTTP ${res.status}).${detail ? ` ${detail}` : ''}`);
  }

  try {
    const data = (await res.json()) as { text?: string };
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    return Response.json({ text }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return jsonError(502, 'The transcription API returned an unreadable response.');
  }
}
