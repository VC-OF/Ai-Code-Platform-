import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_BROWSER_SPEECH_MESSAGE, SpeechEngine, type SpeechEngineConfig } from '@/components/voice/speechEngine';

class FakeUtterance {
  voice: unknown = null;
  lang = '';
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

/** speechSynthesis stand-in; `autoEnd` finishes each utterance on the next tick. */
function fakeSynth(autoEnd = true) {
  const synth = {
    speaking: false,
    pending: false,
    spoken: [] as FakeUtterance[],
    cancelled: 0,
    getVoices: () => [{ name: 'Google US English', lang: 'en-US', default: false, localService: false }],
    speak(u: FakeUtterance) {
      synth.spoken.push(u);
      synth.speaking = true;
      if (autoEnd) {
        setTimeout(() => {
          synth.speaking = false;
          u.onend?.();
        }, 0);
      }
    },
    cancel() {
      synth.cancelled += 1;
      synth.speaking = false;
      for (const u of synth.spoken) u.onerror?.();
    },
  };
  return synth;
}

class FakeAudio {
  static played: string[] = [];
  static rates: number[] = [];
  playbackRate = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly src: string) {}
  play() {
    FakeAudio.played.push(this.src);
    FakeAudio.rates.push(this.playbackRate);
    setTimeout(() => this.onended?.(), 0);
    return Promise.resolve();
  }
  pause() {}
  removeAttribute() {}
}

const browserConfig: SpeechEngineConfig = { engine: 'browser', voice: '', browserVoice: '', rate: 1, pitch: 1 };
const openaiConfig: SpeechEngineConfig = { engine: 'openai', voice: 'marin', browserVoice: '', rate: 1.1, pitch: 1 };

function setup(config: SpeechEngineConfig, synth = fakeSynth()) {
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  const states: { speaking: boolean; tag: string | null }[] = [];
  const errors: string[] = [];
  const engine = new SpeechEngine(config, {
    onSpeakingChange: (speaking, tag) => states.push({ speaking, tag }),
    onError: (message) => errors.push(message),
  });
  return { engine, synth, states, errors };
}

beforeEach(() => {
  FakeAudio.played = [];
  FakeAudio.rates = [];
  vi.stubGlobal('Audio', FakeAudio);
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${++n}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SpeechEngine', () => {
  it('speaks with the browser voice and reports speaking state with the tag', async () => {
    const { engine, synth, states } = setup(browserConfig);
    engine.speak('Hello there.', { tag: 'msg-1' });
    expect(states[0]).toEqual({ speaking: true, tag: 'msg-1' });
    expect(synth.spoken.map((u) => u.text)).toEqual(['Hello there.']);
    expect(synth.spoken[0].rate).toBe(1);
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ speaking: false, tag: null }));
    const [record] = engine.recentSpoken();
    expect(record.text).toBe('Hello there.');
    expect(record.end).toBeGreaterThanOrEqual(record.start);
  });

  it('records when each utterance started and stopped, for echo detection', () => {
    vi.useFakeTimers({ now: 1_000 });
    try {
      const { engine } = setup(browserConfig, fakeSynth(false));
      engine.speak('Still talking.');
      expect(engine.recentSpoken()).toEqual([{ text: 'Still talking.', start: 1_000, end: null }]);
      vi.setSystemTime(3_000);
      engine.cancel();
      expect(engine.recentSpoken(3_000)).toEqual([{ text: 'Still talking.', start: 1_000, end: 3_000 }]);
      // Finished speech is forgotten once it is far too old to come back as echo
      expect(engine.recentSpoken(60_000)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a high-priority item interrupts the current one', () => {
    const { engine, synth } = setup(browserConfig, fakeSynth(false));
    engine.speak('A long progress update.', { priority: 'low' });
    engine.speak('Which option?', { priority: 'high' });
    expect(synth.cancelled).toBe(1);
    expect(synth.spoken.map((u) => u.text)).toEqual(['A long progress update.', 'Which option?']);
    expect(engine.currentText()).toBe('Which option?');
  });

  it('cancel stops speech and clears the queue', () => {
    const { engine, synth, states } = setup(browserConfig, fakeSynth(false));
    engine.speak('First.');
    engine.speak('Second.');
    engine.cancel();
    expect(synth.cancelled).toBe(1);
    expect(states.at(-1)).toEqual({ speaking: false, tag: null });
    expect(engine.currentText()).toBeNull();
    expect(synth.spoken.map((u) => u.text)).toEqual(['First.']);
  });

  it('plays server audio fetched from /api/voice/tts', async () => {
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const { engine, synth, errors, states } = setup(openaiConfig);
    engine.speak('Server voice test.');
    await vi.waitFor(() => expect(states.at(-1)?.speaking).toBe(false));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/voice/tts');
    expect(JSON.parse(String(init.body))).toEqual({ provider: 'openai', voice: 'marin', text: 'Server voice test.', speed: 1.1 });
    expect(FakeAudio.played).toEqual(['blob:fake/1']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake/1');
    expect(synth.spoken).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it('falls back to the browser voice once, surfaces the error, and skips the server until settings change', async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({ error: 'Add OPENAI_API_KEY in Settings → API keys to use OpenAI voices.' }, { status: 400 })
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { engine, synth, errors, states } = setup(openaiConfig);

    engine.speak('First reply.');
    await vi.waitFor(() => expect(synth.spoken.map((u) => u.text)).toEqual(['First reply.']));
    expect(errors).toEqual(['Add OPENAI_API_KEY in Settings → API keys to use OpenAI voices. Using the browser voice instead.']);
    await vi.waitFor(() => expect(states.at(-1)?.speaking).toBe(false));

    engine.speak('Second reply.');
    await vi.waitFor(() => expect(synth.spoken.map((u) => u.text)).toEqual(['First reply.', 'Second reply.']));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);

    // A different voice is worth trying again
    engine.setConfig({ ...openaiConfig, voice: 'cedar' });
    engine.speak('Third reply.');
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('stops calling the server when the provider rejected the key', async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({ error: 'OpenAI rejected the API key (HTTP 401).', code: 'auth' }, { status: 502 })
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { engine, synth, errors, states } = setup(openaiConfig);
    engine.speak('One.');
    await vi.waitFor(() => expect(synth.spoken).toHaveLength(1));
    await vi.waitFor(() => expect(states.at(-1)?.speaking).toBe(false));
    engine.speak('Two.');
    await vi.waitFor(() => expect(synth.spoken.map((u) => u.text)).toEqual(['One.', 'Two.']));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(errors).toEqual(['OpenAI rejected the API key (HTTP 401). Using the browser voice instead.']);
  });

  it('applies the speed setting to ElevenLabs audio on playback', async () => {
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const { engine, states } = setup({ ...openaiConfig, engine: 'elevenlabs', voice: 'voice_1', rate: 1.5 });
    engine.speak('Faster, please.');
    await vi.waitFor(() => expect(states.at(-1)?.speaking).toBe(false));
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ provider: 'elevenlabs', voice: 'voice_1', text: 'Faster, please.' });
    expect(FakeAudio.rates).toEqual([1.5]);
  });

  it('retries the server on the next utterance after a transient failure', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ error: 'OpenAI is unavailable right now (HTTP 503).' }, { status: 502 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { engine, synth, states } = setup(openaiConfig);
    engine.speak('One.');
    await vi.waitFor(() => expect(synth.spoken).toHaveLength(1));
    await vi.waitFor(() => expect(states.at(-1)?.speaking).toBe(false));
    engine.speak('Two.');
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('asks for a voice when a server engine has none selected', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { engine, synth, errors } = setup({ ...openaiConfig, engine: 'elevenlabs', voice: '' });
    engine.speak('Hello.');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(synth.spoken.map((u) => u.text)).toEqual(['Hello.']);
    expect(errors).toEqual(['Pick a voice for ElevenLabs in voice settings. Using the browser voice for now.']);
  });

  it('says why there is no server voice instead of asking to pick one', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const missingVoice = 'Add ELEVENLABS_API_KEY in Settings → API keys to use ElevenLabs voices.';
    const { engine, errors } = setup({ ...openaiConfig, engine: 'elevenlabs', voice: '', missingVoice });
    engine.speak('Hello.');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errors).toEqual([`${missingVoice} Using the browser voice for now.`]);
  });

  it('tries a blocked server voice again once unblocked (a key was added)', async () => {
    let status = 400;
    const fetchSpy = vi.fn(async () =>
      status === 200
        ? new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
        : Response.json({ error: 'Add OPENAI_API_KEY in Settings → API keys to use OpenAI voices.' }, { status })
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { engine, synth, states } = setup(openaiConfig);
    engine.speak('One.');
    await vi.waitFor(() => expect(synth.spoken).toHaveLength(1));
    await vi.waitFor(() => expect(states.at(-1)?.speaking).toBe(false));
    engine.speak('Two.');
    await vi.waitFor(() => expect(synth.spoken).toHaveLength(2));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(states.at(-1)?.speaking).toBe(false));

    status = 200;
    engine.unblock();
    engine.speak('Three.');
    await vi.waitFor(() => expect(FakeAudio.played).toHaveLength(1));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(synth.spoken).toHaveLength(2);
  });

  it('reports that the browser cannot speak instead of doing nothing', () => {
    vi.stubGlobal('window', {});
    const errors: string[] = [];
    const engine = new SpeechEngine(browserConfig, { onSpeakingChange: () => {}, onError: (message) => errors.push(message) });
    engine.speak('Read this reply.', { tag: 'msg-1' });
    expect(errors).toEqual([NO_BROWSER_SPEECH_MESSAGE]);
  });

  it('does not promise the browser voice as a fallback when there is none', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'OpenAI rejected the API key (HTTP 401).', code: 'auth' }, { status: 502 })));
    const errors: string[] = [];
    const engine = new SpeechEngine(openaiConfig, { onSpeakingChange: () => {}, onError: (message) => errors.push(message) });
    engine.speak('One.');
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBe('OpenAI rejected the API key (HTTP 401). This browser cannot read text aloud itself, so nothing was played.');
    // Blocked now: every later utterance would be silent, so it says so again
    await vi.waitFor(() => expect(engine.currentText()).toBeNull());
    engine.speak('Two.');
    expect(errors).toHaveLength(2);
    expect(errors[1]).toBe(errors[0]);
  });
});
