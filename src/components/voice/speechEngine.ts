// Plays queued utterances with the browser's speechSynthesis or a server
// voice (/api/voice/tts → audio blob). Framework-free so the React hook stays
// thin; priority rules live in src/lib/voice/speechQueue.ts.

import { enqueueSpeech, nextSpeech, type QueuedSpeech, type SpeechPriority } from '@/lib/voice/speechQueue';
import { splitForSpeech } from '@/lib/voice/speechText';
import { pickDefaultVoice } from '@/lib/voice/settings';
import { PROVIDER_LABELS, isBlockingTtsError, isServerProvider, type TtsProviderId } from '@/lib/voice/providers';
import { ECHO_TAIL_MS, type SpokenRecord } from '@/lib/voice/echo';

export interface SpeechEngineConfig {
  engine: TtsProviderId;
  /** Provider voice id for server engines */
  voice: string;
  /** Browser voice name ('' = most natural for the language) */
  browserVoice: string;
  rate: number;
  pitch: number;
  /** Why a server engine has no `voice` (missing key, voice list failed); see missingVoiceReason */
  missingVoice?: string | null;
}

export const NO_BROWSER_SPEECH_MESSAGE =
  'This browser cannot read text aloud. Pick a server voice in voice settings, or use Chrome, Edge or Safari.';

export interface SpeechEngineEvents {
  onSpeakingChange: (speaking: boolean, tag: string | null) => void;
  onError: (message: string) => void;
}

interface Playback {
  stop: () => void;
  done: Promise<void>;
}

class TtsRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | undefined) {
    super(message);
  }
}

// Finished utterances are kept a little longer than the echo window needs
const RECENT_KEEP_MS = ECHO_TAIL_MS * 4;
const IDLE_TAIL_MS = 300;

export function browserSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

const NOTHING_PLAYED = 'This browser cannot read text aloud itself, so nothing was played.';

/** What happens instead of the server voice: the browser voice, or nothing at all. */
function fallbackNote(usingBrowser: string): string {
  return browserSpeechSupported() ? usingBrowser : NOTHING_PLAYED;
}

export class SpeechEngine {
  private config: SpeechEngineConfig;
  private queue: QueuedSpeech[] = [];
  private current: { item: QueuedSpeech; playback: Playback; record: SpokenRecord } | null = null;
  private nextId = 1;
  private recent: SpokenRecord[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private reportedSpeaking = false;
  /** `${engine}:${voice}` that failed with a config error, and why; skipped until settings change */
  private blockedServer: { key: string; message: string } | null = null;
  private disposed = false;

  constructor(config: SpeechEngineConfig, private events: SpeechEngineEvents) {
    this.config = config;
  }

  setConfig(config: SpeechEngineConfig): void {
    if (config.engine !== this.config.engine || config.voice !== this.config.voice) this.unblock();
    this.config = config;
  }

  /**
   * Try the server voice again after a failure that blocked it (the user may
   * have added the missing key): call when providers are refetched or on "Test voice".
   */
  unblock(): void {
    this.blockedServer = null;
  }

  speak(text: string, opts: { priority?: SpeechPriority; tag?: string } = {}): void {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || this.disposed) return;
    const item: QueuedSpeech = { id: this.nextId++, text: clean, priority: opts.priority ?? 'normal', at: Date.now(), tag: opts.tag };
    const { queue, interrupt } = enqueueSpeech(this.queue, item, this.current?.item ?? null);
    this.queue = queue;
    if (interrupt) this.stopCurrent();
    this.pump();
  }

  cancel(): void {
    this.queue = [];
    this.stopCurrent();
    this.report(false, null, 0);
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }

  currentText(): string | null {
    return this.current?.item.text ?? null;
  }

  /** What is being said and what was said just now (to recognise the agent's own voice in the mic). */
  recentSpoken(now = Date.now()): SpokenRecord[] {
    this.recent = this.recent.filter((r) => r.end === null || now - r.end <= RECENT_KEEP_MS);
    return this.recent.map((r) => ({ ...r }));
  }

  private report(speaking: boolean, tag: string | null, delayMs: number): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const emit = () => {
      this.reportedSpeaking = speaking;
      this.events.onSpeakingChange(speaking, tag);
    };
    // "Done speaking" waits a moment so the room echo fades before the mic reopens
    if (!speaking && delayMs > 0 && this.reportedSpeaking) this.idleTimer = setTimeout(emit, delayMs);
    else emit();
  }

  private stopCurrent(): void {
    const current = this.current;
    this.current = null;
    if (!current) return;
    current.record.end ??= Date.now();
    current.playback.stop();
  }

  private pump(): void {
    if (this.current || this.disposed) return;
    const { item, queue } = nextSpeech(this.queue, Date.now());
    this.queue = queue;
    if (!item) {
      this.report(false, null, IDLE_TAIL_MS);
      return;
    }
    this.report(true, item.tag ?? null, 0);
    const record: SpokenRecord = { text: item.text, start: Date.now(), end: null };
    this.recent.push(record);
    const playback = this.play(item.text);
    this.current = { item, playback, record };
    void playback.done.then(() => {
      record.end ??= Date.now();
      if (this.current?.playback !== playback) return;
      this.current = null;
      this.pump();
    });
  }

  private play(text: string): Playback {
    const { engine, voice, missingVoice } = this.config;
    if (!isServerProvider(engine)) return this.playBrowser(text);
    if (!voice) {
      const reason = missingVoice || `Pick a voice for ${PROVIDER_LABELS[engine]} in voice settings.`;
      this.events.onError(`${reason} ${fallbackNote('Using the browser voice for now.')}`);
      return this.playBrowser(text, true);
    }
    const blocked = this.blockedServer;
    if (blocked?.key !== `${engine}:${voice}`) return this.playServer(text, engine, voice);
    // Reported when it failed; repeated only when there is no browser voice either, as nothing will play
    if (!browserSpeechSupported()) this.events.onError(`${blocked.message} ${NOTHING_PLAYED}`);
    return this.playBrowser(text, true);
  }

  /** `reported`: the caller already explained why the browser voice is used. */
  private playBrowser(text: string, reported = false): Playback {
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    if (!browserSpeechSupported()) {
      // Otherwise "Listen" and read-aloud would do nothing, silently
      if (!reported) this.events.onError(NO_BROWSER_SPEECH_MESSAGE);
      resolveDone();
      return { stop: () => {}, done };
    }
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
    const voice = (this.config.browserVoice && voices.find((v) => v.name === this.config.browserVoice)) || pickDefaultVoice(voices, lang);
    const chunks = splitForSpeech(text, 200);
    let remaining = chunks.length;
    let finished = false;
    let idleChecks = 0;
    // Some engines never fire onend (or stall after ~15 s); poll as a backstop
    const watchdog = setInterval(() => {
      idleChecks = synth.speaking || synth.pending ? 0 : idleChecks + 1;
      if (idleChecks >= 2) finish();
    }, 750);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(watchdog);
      resolveDone();
    };
    for (const chunk of chunks) {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = lang;
      }
      u.rate = this.config.rate;
      u.pitch = this.config.pitch;
      u.onend = u.onerror = () => {
        remaining -= 1;
        if (remaining <= 0) finish();
      };
      synth.speak(u);
    }
    return {
      stop: () => {
        if (finished) return;
        synth.cancel();
        finish();
      },
      done,
    };
  }

  private playServer(text: string, provider: 'openai' | 'elevenlabs', voice: string): Playback {
    const abort = new AbortController();
    const urls: string[] = [];
    let audio: HTMLAudioElement | null = null;
    let settlePlay: (() => void) | null = null;
    let stopped = false;
    let fallback: Playback | null = null;
    const chunks = splitForSpeech(text, 300);
    const { rate } = this.config;

    const fetchChunk = async (chunk: string): Promise<string> => {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // OpenAI renders the speed; ElevenLabs audio is sped up on playback
        body: JSON.stringify(provider === 'openai' ? { provider, voice, text: chunk, speed: rate } : { provider, voice, text: chunk }),
        signal: abort.signal,
      });
      if (!res.ok) {
        let message = `The voice service failed (HTTP ${res.status}).`;
        let code: string | undefined;
        try {
          const data = (await res.json()) as { error?: unknown; code?: unknown };
          if (typeof data.error === 'string' && data.error) message = data.error;
          if (typeof data.code === 'string') code = data.code;
        } catch {
          // not JSON
        }
        throw new TtsRequestError(message, res.status, code);
      }
      const url = URL.createObjectURL(await res.blob());
      urls.push(url);
      return url;
    };

    const playUrl = (url: string) =>
      new Promise<void>((resolve, reject) => {
        const el = new Audio(url);
        if (provider === 'elevenlabs') el.playbackRate = rate;
        audio = el;
        settlePlay = resolve;
        el.onended = () => resolve();
        el.onerror = () => reject(new Error('The browser could not play the voice audio.'));
        el.play().catch((err: unknown) => {
          reject(
            err instanceof Error && err.name === 'NotAllowedError'
              ? new Error('The browser blocked audio playback. Click anywhere on the page, then try again.')
              : new Error('The browser could not play the voice audio.')
          );
        });
      });

    const run = async () => {
      let index = 0;
      try {
        let next = fetchChunk(chunks[0]);
        for (index = 0; index < chunks.length; index++) {
          const url = await next;
          if (index + 1 < chunks.length) {
            next = fetchChunk(chunks[index + 1]);
            next.catch(() => {}); // surfaced when awaited
          }
          if (stopped) return;
          await playUrl(url);
          URL.revokeObjectURL(url);
          if (stopped) return;
        }
      } catch (err) {
        if (stopped) return;
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof TtsRequestError && isBlockingTtsError(err.status, err.code)) {
          this.blockedServer = { key: `${provider}:${voice}`, message };
        }
        this.events.onError(`${message} ${fallbackNote('Using the browser voice instead.')}`);
        const rest = chunks.slice(index).join(' ');
        if (rest) {
          fallback = this.playBrowser(rest, true);
          await fallback.done;
        }
      } finally {
        for (const url of urls) URL.revokeObjectURL(url);
      }
    };

    const done = run();
    return {
      stop: () => {
        stopped = true;
        abort.abort();
        const el = audio as HTMLAudioElement | null;
        if (el) {
          el.onerror = null;
          el.pause();
          el.removeAttribute('src');
        }
        (settlePlay as (() => void) | null)?.();
        (fallback as Playback | null)?.stop();
      },
      done,
    };
  }
}
