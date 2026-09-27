// Server-only voice helpers: resolve provider keys, list voices and proxy
// text-to-speech requests. Keys come from the encrypted settings store
// (global scope) with process.env as the fallback, and never leave the server.

import { createHash } from 'crypto';
import { getDecryptedEnv } from '@/lib/settingsStore';
import {
  DEFAULT_OPENAI_LEGACY_VOICE,
  ELEVENLABS_API,
  MAX_TTS_CHARS,
  OPENAI_BASE_URL_ENVS,
  OPENAI_LEGACY_TTS_MODEL,
  OPENAI_LEGACY_VOICE_IDS,
  OPENAI_TTS_KEY_ENV,
  OPENAI_TTS_MODEL_ENV,
  PROVIDER_KEY_ENV,
  PROVIDER_LABELS,
  VOICE_ID_RE,
  buildElevenLabsSpeechRequest,
  buildOpenAiSpeechRequest,
  gatewayKeyMessage,
  isLegacyOpenAiModel,
  isServerProvider,
  missingKeyMessage,
  openAiVoicesFor,
  parseElevenLabsVoices,
  resolveOpenAiModel,
  upstreamErrorCode,
  upstreamErrorMessage,
  type ServerTtsProviderId,
  type VoiceOption,
  type VoiceProviderInfo,
} from './providers';

export interface VoiceServerDeps {
  fetchImpl?: typeof fetch;
  /** Decrypted global settings; defaults to getDecryptedEnv() */
  getEnv?: () => Promise<Record<string, string>>;
  /** Upstream TTS timeout */
  timeoutMs?: number;
  /** Voice-list timeout */
  listTimeoutMs?: number;
  now?: () => number;
}

export interface VoiceConfig {
  keys: Partial<Record<ServerTtsProviderId, string>>;
  openaiModel: string;
  /** Why OPENAI_API_KEY is not used for voices (it belongs to a custom endpoint) */
  openaiKeyWithheld?: string;
}

const VOICE_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_TTS_TIMEOUT_MS = 30_000;
const DEFAULT_LIST_TIMEOUT_MS = 4_000;

let elevenLabsCache: { keyHash: string; at: number; voices: VoiceOption[] } | null = null;

/** Tests: forget cached ElevenLabs voices. */
export function clearVoiceCache(): void {
  elevenLabsCache = null;
}

export async function resolveVoiceConfig(getEnv: () => Promise<Record<string, string>> = () => getDecryptedEnv()): Promise<VoiceConfig> {
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
  // gateway; only send it to api.openai.com when that is where it belongs
  const dedicatedKey = read(OPENAI_TTS_KEY_ENV);
  const sharedKey = read(PROVIDER_KEY_ENV.openai);
  const customBase = OPENAI_BASE_URL_ENVS.find((name) => {
    const url = read(name);
    return url !== undefined && !isOpenAiApiUrl(url);
  });
  const withheld = !dedicatedKey && sharedKey && customBase ? gatewayKeyMessage(customBase) : undefined;
  return {
    keys: { openai: dedicatedKey ?? (customBase ? undefined : sharedKey), elevenlabs: read(PROVIDER_KEY_ENV.elevenlabs) },
    openaiModel: resolveOpenAiModel(read(OPENAI_TTS_MODEL_ENV)),
    ...(withheld ? { openaiKeyWithheld: withheld } : {}),
  };
}

function isOpenAiApiUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // already consumed or not a stream
  }
}

async function listElevenLabsVoices(
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  now: number
): Promise<{ voices: VoiceOption[]; error?: string }> {
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  if (elevenLabsCache && elevenLabsCache.keyHash === keyHash && now - elevenLabsCache.at < VOICE_CACHE_TTL_MS) {
    return { voices: elevenLabsCache.voices };
  }
  try {
    const res = await fetchImpl(`${ELEVENLABS_API}/voices`, {
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) {
      await discardBody(res);
      return { voices: [], error: `Could not list voices. ${upstreamErrorMessage('elevenlabs', res.status)}` };
    }
    const voices = parseElevenLabsVoices(await res.json());
    elevenLabsCache = { keyHash, at: now, voices };
    return { voices };
  } catch (err) {
    return {
      voices: [],
      error: isTimeout(err) ? 'ElevenLabs did not respond in time, so its voices could not be listed.' : 'Could not reach ElevenLabs to list its voices.',
    };
  }
}

/** GET /api/voice: which providers can speak, and with which voices. */
export async function getVoiceCatalog(deps: VoiceServerDeps = {}): Promise<{ providers: VoiceProviderInfo[] }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? Date.now)();
  const config = await resolveVoiceConfig(deps.getEnv);

  const openai: VoiceProviderInfo = {
    id: 'openai',
    label: PROVIDER_LABELS.openai,
    available: !!config.keys.openai,
    voices: openAiVoicesFor(config.openaiModel),
  };
  if (!openai.available) openai.hint = config.openaiKeyWithheld ?? missingKeyMessage('openai');

  const elevenlabs: VoiceProviderInfo = {
    id: 'elevenlabs',
    label: PROVIDER_LABELS.elevenlabs,
    available: !!config.keys.elevenlabs,
    voices: [],
  };
  if (config.keys.elevenlabs) {
    const listed = await listElevenLabsVoices(config.keys.elevenlabs, fetchImpl, deps.listTimeoutMs ?? DEFAULT_LIST_TIMEOUT_MS, now);
    elevenlabs.voices = listed.voices;
    if (listed.error) elevenlabs.error = listed.error;
  } else {
    elevenlabs.hint = missingKeyMessage('elevenlabs');
  }

  return {
    providers: [
      { id: 'browser', label: PROVIDER_LABELS.browser, available: true, voices: [] },
      openai,
      elevenlabs,
    ],
  };
}

const jsonError = (status: number, error: string, code?: string) =>
  Response.json(code ? { error, code } : { error }, { status, headers: { 'Cache-Control': 'no-store' } });

type UpstreamResult = { ok: true; res: Response } | { ok: false; error: string };

async function callUpstream(
  provider: ServerTtsProviderId,
  request: { url: string; init: RequestInit },
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<UpstreamResult> {
  try {
    const res = await fetchImpl(request.url, { ...request.init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    return { ok: true, res };
  } catch (err) {
    const name = PROVIDER_LABELS[provider];
    return { ok: false, error: isTimeout(err) ? `${name} did not respond in time.` : `Could not reach ${name}.` };
  }
}

async function relayAudio(provider: ServerTtsProviderId, result: UpstreamResult): Promise<Response> {
  if (!result.ok) return jsonError(502, result.error);
  const { res } = result;
  if (!res.ok) {
    await discardBody(res);
    console.warn(`[voice] ${provider} speech request failed: HTTP ${res.status}`);
    return jsonError(502, upstreamErrorMessage(provider, res.status), upstreamErrorCode(res.status));
  }
  const upstreamType = res.headers.get('content-type') ?? '';
  return new Response(res.body ?? (await res.arrayBuffer()), {
    status: 200,
    headers: {
      'Content-Type': upstreamType.startsWith('audio/') ? upstreamType : 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * POST /api/voice/tts {provider, voice, text, speed?} → audio/mpeg stream.
 * 400 for bad input or a missing key, 502 when the provider fails (with
 * code 'auth' or 'not_found' when retrying cannot help).
 */
export async function handleTtsRequest(req: Request, deps: VoiceServerDeps = {}): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Send a JSON body: { provider, voice, text }.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError(400, 'Send a JSON body: { provider, voice, text }.');
  }
  const { provider, voice, text, speed } = body as Record<string, unknown>;

  if (!isServerProvider(provider)) return jsonError(400, 'provider must be "openai" or "elevenlabs".');
  if (typeof text !== 'string' || !text.trim()) return jsonError(400, 'text is required.');
  if (text.length > MAX_TTS_CHARS) {
    return jsonError(400, `text is too long (${text.length} characters; the limit is ${MAX_TTS_CHARS}).`);
  }
  if (speed !== undefined && (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.25 || speed > 4)) {
    return jsonError(400, 'speed must be a number between 0.25 and 4.');
  }
  if (typeof voice !== 'string' || !VOICE_ID_RE.test(voice)) {
    return jsonError(400, 'voice must be 1–64 letters, digits, "-" or "_".');
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TTS_TIMEOUT_MS;
  const config = await resolveVoiceConfig(deps.getEnv);
  const input = text.trim();

  if (provider === 'openai') {
    const model = config.openaiModel;
    if (!openAiVoicesFor(model).some((v) => v.id === voice)) {
      return jsonError(400, `Unknown OpenAI voice "${voice}".`);
    }
    const apiKey = config.keys.openai;
    if (!apiKey) return jsonError(400, config.openaiKeyWithheld ?? missingKeyMessage('openai'));

    let result = await callUpstream('openai', buildOpenAiSpeechRequest({ apiKey, model, voice, text: input, speed }), fetchImpl, timeoutMs);
    // Accounts or gateways without gpt-4o-mini-tts (or one of its newer
    // voices) still have tts-1: retry once with a voice it supports
    if (result.ok && (result.res.status === 400 || result.res.status === 404) && !isLegacyOpenAiModel(model)) {
      await discardBody(result.res);
      const legacyVoice = OPENAI_LEGACY_VOICE_IDS.includes(voice) ? voice : DEFAULT_OPENAI_LEGACY_VOICE;
      result = await callUpstream(
        'openai',
        buildOpenAiSpeechRequest({ apiKey, model: OPENAI_LEGACY_TTS_MODEL, voice: legacyVoice, text: input, speed }),
        fetchImpl,
        timeoutMs
      );
    }
    return relayAudio('openai', result);
  }

  const apiKey = config.keys.elevenlabs;
  if (!apiKey) return jsonError(400, missingKeyMessage('elevenlabs'));
  const result = await callUpstream('elevenlabs', buildElevenLabsSpeechRequest({ apiKey, voiceId: voice, text: input }), fetchImpl, timeoutMs);
  return relayAudio('elevenlabs', result);
}
