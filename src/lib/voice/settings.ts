// Voice preferences persisted per browser (localStorage), plus the choice of
// a natural-sounding default browser voice. Pure except the two storage helpers.

import { isNarrationLevel, type NarrationLevel } from './narration';
import {
  DEFAULT_OPENAI_VOICE,
  OPENAI_VOICES,
  PROVIDER_LABELS,
  VOICE_ID_RE,
  isServerProvider,
  missingKeyMessage,
  type TtsProviderId,
  type VoiceOption,
  type VoiceProviderInfo,
} from './providers';

export interface VoiceSettings {
  engine: TtsProviderId;
  /** Browser voice name; '' picks the most natural one for the user's language */
  browserVoice: string;
  openaiVoice: string;
  /** '' uses the first voice the account lists */
  elevenlabsVoice: string;
  /** 0.5–2 */
  rate: number;
  /** 0.5–2, browser voices only */
  pitch: number;
  level: NarrationLevel;
  /** Keep listening while the agent speaks and cut it off when the user talks */
  bargeIn: boolean;
  /** Read replies (and the agent's questions) aloud even when voice mode is off */
  readReplies: boolean;
}

export const VOICE_SETTINGS_KEY = 'oc-voice-settings';

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  engine: 'browser',
  browserVoice: '',
  openaiVoice: DEFAULT_OPENAI_VOICE,
  elevenlabsVoice: '',
  rate: 1,
  pitch: 1,
  level: 'everything',
  bargeIn: false,
  readReplies: false,
};

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Accept whatever was stored, keeping only valid fields. */
export function parseVoiceSettings(raw: unknown): VoiceSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_VOICE_SETTINGS;
  return {
    engine: r.engine === 'browser' || r.engine === 'openai' || r.engine === 'elevenlabs' ? r.engine : d.engine,
    browserVoice: typeof r.browserVoice === 'string' ? r.browserVoice.slice(0, 200) : d.browserVoice,
    openaiVoice: typeof r.openaiVoice === 'string' && VOICE_ID_RE.test(r.openaiVoice) ? r.openaiVoice : d.openaiVoice,
    elevenlabsVoice:
      typeof r.elevenlabsVoice === 'string' && (r.elevenlabsVoice === '' || VOICE_ID_RE.test(r.elevenlabsVoice))
        ? r.elevenlabsVoice
        : d.elevenlabsVoice,
    rate: clamp(r.rate, 0.5, 2, d.rate),
    pitch: clamp(r.pitch, 0.5, 2, d.pitch),
    level: isNarrationLevel(r.level) ? r.level : d.level,
    bargeIn: typeof r.bargeIn === 'boolean' ? r.bargeIn : d.bargeIn,
    readReplies: typeof r.readReplies === 'boolean' ? r.readReplies : d.readReplies,
  };
}

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(VOICE_SETTINGS_KEY);
    return parseVoiceSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  try {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or storage disabled: settings last for this session only
  }
}

/** The fields of SpeechSynthesisVoice we rank on. */
export interface BrowserVoiceLike {
  name: string;
  lang: string;
  default?: boolean;
  localService?: boolean;
}

/** Higher is more natural-sounding for `lang` (e.g. "en-US"). */
export function scoreBrowserVoice(voice: BrowserVoiceLike, lang: string): number {
  const want = lang.toLowerCase().replace('_', '-');
  const have = (voice.lang || '').toLowerCase().replace('_', '-');
  let score = 0;
  if (have === want) score += 6;
  else if (have.split('-')[0] === want.split('-')[0]) score += 4;
  else return -10;
  const name = voice.name.toLowerCase();
  if (name.includes('natural')) score += 5;
  if (name.includes('neural')) score += 5;
  if (name.includes('google')) score += 3;
  if (name.includes('online')) score += 1;
  if (name.includes('premium') || name.includes('enhanced')) score += 3;
  // Novelty/robotic voices bundled with some systems
  if (/\b(compact|espeak|robot|whisper|zarvox|bad news|bells|boing|bubbles|cellos|jester|organ|trinoids)\b/.test(name)) score -= 8;
  if (voice.default) score += 0.5;
  return score;
}

/** Most natural voice for the language, or the first voice when none match. */
export function pickDefaultVoice<T extends BrowserVoiceLike>(voices: readonly T[], lang: string): T | null {
  if (!voices.length) return null;
  let best: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const v of voices) {
    const s = scoreBrowserVoice(v, lang || 'en-US');
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  if (bestScore < 0) return voices.find((v) => v.default) ?? voices[0];
  return best;
}

/** Voices for the picker: the user's language first, most natural first. */
export function sortBrowserVoices<T extends BrowserVoiceLike>(voices: readonly T[], lang: string): T[] {
  return [...voices].sort((a, b) => scoreBrowserVoice(b, lang) - scoreBrowserVoice(a, lang) || a.name.localeCompare(b.name));
}

/**
 * The provider voice to request: the saved one when the provider still
 * offers it, otherwise its first voice ('' when none is known yet).
 */
export function resolveProviderVoice(settings: VoiceSettings, providers: readonly VoiceProviderInfo[] | null): string {
  if (settings.engine === 'openai') {
    const list = providers?.find((p) => p.id === 'openai')?.voices ?? [];
    if (!list.length || list.some((v) => v.id === settings.openaiVoice)) return settings.openaiVoice;
    return list[0].id;
  }
  if (settings.engine === 'elevenlabs') {
    const list = providers?.find((p) => p.id === 'elevenlabs')?.voices ?? [];
    if (settings.elevenlabsVoice && (!list.length || list.some((v) => v.id === settings.elevenlabsVoice))) {
      return settings.elevenlabsVoice;
    }
    return list[0]?.id ?? '';
  }
  return '';
}

/** A typed provider voice ID: trimmed, '' to clear it, null when it is not a valid ID. */
export function parseVoiceIdInput(text: string): string | null {
  const id = text.trim();
  return id === '' || VOICE_ID_RE.test(id) ? id : null;
}

/** How the settings panel offers a server engine's voices. */
export type ServerVoicePicker =
  /** Choose from the provider's voices */
  | { kind: 'list'; voices: VoiceOption[] }
  /** The key is there (or unknown) but no voices were listed: type a voice ID */
  | { kind: 'manual' }
  /** The voice list is still being fetched */
  | { kind: 'loading' }
  /** No API key: there is nothing to pick until one is added */
  | { kind: 'no-key' };

/**
 * OpenAI's voices are known in advance. ElevenLabs lists the account's
 * voices; when that list could not be fetched, or is empty, the user can
 * still enter a voice ID (a key may be allowed to speak but not to list).
 */
export function serverVoicePicker(
  settings: VoiceSettings,
  providers: readonly VoiceProviderInfo[] | null,
  providersError: string | null
): ServerVoicePicker {
  const provider = providers?.find((p) => p.id === settings.engine);
  const listed = provider?.voices ?? [];
  if (settings.engine === 'openai') return { kind: 'list', voices: listed.length ? listed : OPENAI_VOICES };
  if (settings.engine !== 'elevenlabs') return { kind: 'list', voices: [] };
  if (listed.length) return { kind: 'list', voices: listed };
  if (provider && !provider.available) return { kind: 'no-key' };
  if (!providers && !providersError) return { kind: 'loading' };
  return { kind: 'manual' };
}

/**
 * Why a server engine has no voice to request (resolveProviderVoice gave
 * ''), in words the user can act on: the missing key, the voice list that
 * could not be fetched, or voices that are still loading. Null when there
 * is a voice.
 */
export function missingVoiceReason(
  settings: VoiceSettings,
  providers: readonly VoiceProviderInfo[] | null,
  providersError: string | null
): string | null {
  const engine = settings.engine;
  if (!isServerProvider(engine) || resolveProviderVoice(settings, providers)) return null;
  const label = PROVIDER_LABELS[engine];
  const provider = providers?.find((p) => p.id === engine);
  const picker = serverVoicePicker(settings, providers, providersError);
  switch (picker.kind) {
    case 'no-key':
      return provider?.hint ?? missingKeyMessage(engine);
    case 'loading':
      return `${label} voices are still loading.`;
    case 'manual': {
      const why = provider?.error ?? providersError ?? `${label} did not list any voices.`;
      return `${why} To use ${label} anyway, enter a voice ID in voice settings.`;
    }
    case 'list':
      return `Pick a voice for ${label} in voice settings.`;
  }
}
