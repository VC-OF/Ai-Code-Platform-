// Text-to-speech provider registry. Pure data and request builders — no
// secrets and no Node APIs, so both the API routes and the client can import
// it. Keys are resolved server-side in voiceServer.ts.

export type TtsProviderId = 'browser' | 'openai' | 'elevenlabs';
export type ServerTtsProviderId = Exclude<TtsProviderId, 'browser'>;

export interface VoiceOption {
  id: string;
  label: string;
}

export interface VoiceProviderInfo {
  id: TtsProviderId;
  label: string;
  available: boolean;
  voices: VoiceOption[];
  /** Why voices could not be listed (provider still usable) */
  error?: string;
  /** How to enable the provider when unavailable */
  hint?: string;
}

export const SERVER_PROVIDERS: ServerTtsProviderId[] = ['openai', 'elevenlabs'];

export function isServerProvider(v: unknown): v is ServerTtsProviderId {
  return v === 'openai' || v === 'elevenlabs';
}

export const PROVIDER_LABELS: Record<TtsProviderId, string> = {
  browser: 'Browser voices',
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
};

export const PROVIDER_KEY_ENV: Record<ServerTtsProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
};

/** A key used only for OpenAI voices, for when OPENAI_API_KEY belongs to a custom endpoint. */
export const OPENAI_TTS_KEY_ENV = 'OPENAI_TTS_API_KEY';
/** Settings that point the OpenAI-compatible LLM client (and so OPENAI_API_KEY) at another host. */
export const OPENAI_BASE_URL_ENVS = ['LLM_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_BASE_URL'];

export function missingKeyMessage(provider: ServerTtsProviderId): string {
  return `Add ${PROVIDER_KEY_ENV[provider]} in Settings → API keys to use ${PROVIDER_LABELS[provider]} voices.`;
}

export function gatewayKeyMessage(baseUrlEnv: string): string {
  return (
    `OPENAI_API_KEY is used for your custom endpoint (${baseUrlEnv}), so it is not sent to OpenAI. ` +
    `Add ${OPENAI_TTS_KEY_ENV} in Settings → API keys to use OpenAI voices.`
  );
}

/**
 * Codes /api/voice/tts adds to failures that will repeat on every request
 * until the user changes a key or voice: 'auth' (key rejected) and
 * 'not_found' (unknown voice or model).
 */
export type TtsErrorCode = 'auth' | 'not_found';

export function upstreamErrorCode(status: number): TtsErrorCode | undefined {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  return undefined;
}

/** Client side: stop calling the server voice until settings change. */
export function isBlockingTtsError(status: number, code?: string): boolean {
  return status === 400 || status === 401 || status === 403 || code === 'auth' || code === 'not_found';
}

export const VOICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_TTS_CHARS = 4000;

// ── OpenAI ────────────────────────────────────────────────────────────────
export const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
export const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
export const OPENAI_LEGACY_TTS_MODEL = 'tts-1';
/** Optional override (settings or env), e.g. tts-1-hd */
export const OPENAI_TTS_MODEL_ENV = 'OPENAI_TTS_MODEL';
export const OPENAI_TTS_INSTRUCTIONS =
  'Speak like a friendly, relaxed colleague giving a quick spoken update while pairing on code: ' +
  'natural and conversational, warm but not bubbly, at an easy steady pace. ' +
  'Pronounce file names and technical terms clearly, and do not over-enunciate.';

export const OPENAI_VOICES: VoiceOption[] = [
  'marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
].map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) + (id === 'marin' || id === 'cedar' ? ' (most natural)' : '') }));

export const OPENAI_LEGACY_VOICE_IDS = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];
export const OPENAI_LEGACY_VOICES: VoiceOption[] = OPENAI_VOICES.filter((v) => OPENAI_LEGACY_VOICE_IDS.includes(v.id))
  .map((v) => ({ id: v.id, label: v.label.replace(/ \(.*\)$/, '') }));

export const DEFAULT_OPENAI_VOICE = 'marin';
/** Used when falling back to tts-1 with a voice it does not have */
export const DEFAULT_OPENAI_LEGACY_VOICE = 'coral';

export function isLegacyOpenAiModel(model: string): boolean {
  return model === 'tts-1' || model === 'tts-1-hd';
}

/** Model from settings/env if it is one we know; the natural-sounding default otherwise. */
export function resolveOpenAiModel(configured: string | undefined): string {
  const m = (configured ?? '').trim();
  return m === OPENAI_TTS_MODEL || isLegacyOpenAiModel(m) ? m : OPENAI_TTS_MODEL;
}

export function openAiVoicesFor(model: string): VoiceOption[] {
  return isLegacyOpenAiModel(model) ? OPENAI_LEGACY_VOICES : OPENAI_VOICES;
}

export function clampOpenAiSpeed(speed: number | undefined): number {
  if (speed === undefined || !Number.isFinite(speed)) return 1;
  return Math.min(4, Math.max(0.25, Math.round(speed * 100) / 100));
}

export function buildOpenAiSpeechRequest(opts: {
  apiKey: string;
  model: string;
  voice: string;
  text: string;
  speed?: number;
}): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = {
    model: opts.model,
    voice: opts.voice,
    input: opts.text,
    response_format: 'mp3',
    speed: clampOpenAiSpeed(opts.speed),
  };
  // The tts-1 family ignores (and some gateways reject) style instructions
  if (!isLegacyOpenAiModel(opts.model)) body.instructions = OPENAI_TTS_INSTRUCTIONS;
  return {
    url: OPENAI_SPEECH_URL,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    },
  };
}

// ── ElevenLabs ────────────────────────────────────────────────────────────
export const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
export const ELEVENLABS_MODEL = 'eleven_turbo_v2_5';

/**
 * The body is exactly {text, model_id}: voice_settings would override the
 * voice's stored settings, so the speed setting is applied on playback instead.
 */
export function buildElevenLabsSpeechRequest(opts: {
  apiKey: string;
  voiceId: string;
  text: string;
}): { url: string; init: RequestInit } {
  const body = { text: opts.text, model_id: ELEVENLABS_MODEL };
  return {
    url: `${ELEVENLABS_API}/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`,
    init: {
      method: 'POST',
      headers: {
        'xi-api-key': opts.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    },
  };
}

interface ElevenLabsVoiceRaw {
  voice_id?: unknown;
  name?: unknown;
  labels?: Record<string, unknown> | null;
}

/** Validate and label the voices from GET /v1/voices. */
export function parseElevenLabsVoices(data: unknown, limit = 100): VoiceOption[] {
  const list = (data as { voices?: unknown })?.voices;
  if (!Array.isArray(list)) return [];
  const out: VoiceOption[] = [];
  for (const raw of list as ElevenLabsVoiceRaw[]) {
    const id = typeof raw?.voice_id === 'string' ? raw.voice_id : '';
    if (!VOICE_ID_RE.test(id)) continue;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : id;
    const labels = raw.labels ?? {};
    const detail = [labels.accent, labels.gender]
      .filter((v): v is string => typeof v === 'string' && !!v.trim())
      .map((v) => v.trim())
      .join(', ');
    out.push({ id, label: detail ? `${name} (${detail})` : name });
    if (out.length >= limit) break;
  }
  return out;
}

/** Short, key-free explanation for a failed upstream call. */
export function upstreamErrorMessage(provider: ServerTtsProviderId, status: number): string {
  const name = PROVIDER_LABELS[provider];
  if (status === 401 || status === 403) return `${name} rejected the API key (HTTP ${status}). Check ${PROVIDER_KEY_ENV[provider]} in Settings → API keys.`;
  if (status === 429) return `${name} is rate limiting requests or the account is out of credit (HTTP 429).`;
  if (status === 404) return `${name} could not find that voice or model (HTTP 404).`;
  if (status >= 500) return `${name} is unavailable right now (HTTP ${status}).`;
  return `${name} rejected the speech request (HTTP ${status}).`;
}
