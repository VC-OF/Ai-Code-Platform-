import { describe, expect, it } from 'vitest';
import { enqueueSpeech, nextSpeech, MAX_QUEUE, type QueuedSpeech, type SpeechPriority } from '@/lib/voice/speechQueue';
import {
  DEFAULT_VOICE_SETTINGS,
  missingVoiceReason,
  parseVoiceIdInput,
  parseVoiceSettings,
  pickDefaultVoice,
  resolveProviderVoice,
  serverVoicePicker,
  sortBrowserVoices,
} from '@/lib/voice/settings';
import {
  OPENAI_LEGACY_VOICES,
  buildElevenLabsSpeechRequest,
  buildOpenAiSpeechRequest,
  clampOpenAiSpeed,
  isBlockingTtsError,
  parseElevenLabsVoices,
  resolveOpenAiModel,
  upstreamErrorCode,
  upstreamErrorMessage,
  type VoiceProviderInfo,
} from '@/lib/voice/providers';

let nextId = 1;
const item = (priority: SpeechPriority, text: string = priority, at = 0): QueuedSpeech => ({ id: nextId++, text, priority, at });

describe('speech queue', () => {
  it('queues normal items in order without interrupting each other', () => {
    const a = item('normal', 'a');
    const b = item('normal', 'b');
    let r = enqueueSpeech([], a, null);
    r = enqueueSpeech(r.queue, b, a);
    expect(r.interrupt).toBe(false);
    expect(r.queue.map((q) => q.text)).toEqual(['a', 'b']);
  });

  it('high priority interrupts lower speech and jumps ahead of normal items', () => {
    const r = enqueueSpeech([item('normal', 'reply')], item('high', 'question'), { priority: 'normal' });
    expect(r.interrupt).toBe(true);
    expect(r.queue.map((q) => q.text)).toEqual(['question', 'reply']);
  });

  it('high priority does not interrupt another high item', () => {
    const r = enqueueSpeech([item('high', 'q1')], item('high', 'q2'), { priority: 'high' });
    expect(r.interrupt).toBe(false);
    expect(r.queue.map((q) => q.text)).toEqual(['q1', 'q2']);
  });

  it('normal interrupts progress chatter and drops waiting progress', () => {
    const r = enqueueSpeech([item('low', 'old progress')], item('normal', 'reply'), { priority: 'low' });
    expect(r.interrupt).toBe(true);
    expect(r.queue.map((q) => q.text)).toEqual(['reply']);
  });

  it('keeps only the newest progress item and never interrupts', () => {
    let r = enqueueSpeech([], item('low', 'p1'), { priority: 'normal' });
    r = enqueueSpeech(r.queue, item('low', 'p2'), { priority: 'normal' });
    expect(r.interrupt).toBe(false);
    expect(r.queue.map((q) => q.text)).toEqual(['p2']);
  });

  it('drops progress when something more important is waiting', () => {
    const r = enqueueSpeech([item('normal', 'reply')], item('low', 'progress'), null);
    expect(r.queue.map((q) => q.text)).toEqual(['reply']);
  });

  it('caps the queue by dropping the oldest, least important items', () => {
    let queue: QueuedSpeech[] = [];
    for (let i = 0; i < MAX_QUEUE + 3; i++) queue = enqueueSpeech(queue, item('normal', `n${i}`, i), null).queue;
    queue = enqueueSpeech(queue, item('high', 'q', 99), null).queue;
    expect(queue).toHaveLength(MAX_QUEUE);
    expect(queue[0].text).toBe('q');
    expect(queue.map((q) => q.text)).not.toContain('n0');
  });

  it('discards stale progress when dequeuing', () => {
    const stale = item('low', 'stale', 0);
    expect(nextSpeech([stale], 10_000)).toEqual({ item: null, queue: [] });
    const fresh = item('low', 'fresh', 9_000);
    expect(nextSpeech([fresh], 10_000).item?.text).toBe('fresh');
    const r = nextSpeech([item('normal', 'a'), item('normal', 'b')], 0);
    expect(r.item?.text).toBe('a');
    expect(r.queue.map((q) => q.text)).toEqual(['b']);
  });
});

describe('voice settings', () => {
  it('returns defaults for garbage', () => {
    expect(parseVoiceSettings(null)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(parseVoiceSettings('nope')).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it('keeps valid fields and repairs invalid ones', () => {
    const s = parseVoiceSettings({
      engine: 'openai',
      openaiVoice: 'bad voice!',
      elevenlabsVoice: 'abc_123',
      rate: 9,
      pitch: 0.1,
      level: 'replies',
      bargeIn: true,
      readReplies: 'yes',
      browserVoice: 'Microsoft Aria Online (Natural) - English (United States)',
    });
    expect(s).toEqual({
      ...DEFAULT_VOICE_SETTINGS,
      engine: 'openai',
      elevenlabsVoice: 'abc_123',
      rate: 2,
      pitch: 0.5,
      level: 'replies',
      bargeIn: true,
      browserVoice: 'Microsoft Aria Online (Natural) - English (United States)',
    });
    expect(parseVoiceSettings({ engine: 'robot', level: 'loud' }).engine).toBe('browser');
  });

  it('picks the most natural browser voice for the language', () => {
    const voices = [
      { name: 'Microsoft David - English (United States)', lang: 'en-US', default: true },
      { name: 'Google UK English Female', lang: 'en-GB' },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' },
      { name: 'Google Deutsch', lang: 'de-DE' },
    ];
    expect(pickDefaultVoice(voices, 'en-US')?.name).toBe('Microsoft Aria Online (Natural) - English (United States)');
    expect(pickDefaultVoice(voices, 'de-DE')?.name).toBe('Google Deutsch');
    expect(pickDefaultVoice(voices, 'ja-JP')?.name).toBe('Microsoft David - English (United States)');
    expect(pickDefaultVoice([], 'en-US')).toBeNull();
  });

  it('avoids novelty voices', () => {
    const voices = [
      { name: 'Bad News', lang: 'en-US' },
      { name: 'Samantha', lang: 'en-US' },
    ];
    expect(pickDefaultVoice(voices, 'en-US')?.name).toBe('Samantha');
  });

  it('sorts the picker with the language and natural voices first', () => {
    const sorted = sortBrowserVoices(
      [
        { name: 'Zed', lang: 'fr-FR' },
        { name: 'Basic', lang: 'en-US' },
        { name: 'Neural Jenny', lang: 'en-US' },
      ],
      'en-US'
    );
    expect(sorted.map((v) => v.name)).toEqual(['Neural Jenny', 'Basic', 'Zed']);
  });

  it('resolves the provider voice to request', () => {
    const providers: VoiceProviderInfo[] = [
      { id: 'openai', label: 'OpenAI', available: true, voices: OPENAI_LEGACY_VOICES },
      { id: 'elevenlabs', label: 'ElevenLabs', available: true, voices: [{ id: 'v1', label: 'One' }, { id: 'v2', label: 'Two' }] },
    ];
    const base = { ...DEFAULT_VOICE_SETTINGS };
    expect(resolveProviderVoice({ ...base, engine: 'browser' }, providers)).toBe('');
    // marin is not offered by tts-1, so the first listed voice is used
    expect(resolveProviderVoice({ ...base, engine: 'openai', openaiVoice: 'marin' }, providers)).toBe('alloy');
    expect(resolveProviderVoice({ ...base, engine: 'openai', openaiVoice: 'nova' }, providers)).toBe('nova');
    expect(resolveProviderVoice({ ...base, engine: 'openai', openaiVoice: 'marin' }, null)).toBe('marin');
    expect(resolveProviderVoice({ ...base, engine: 'elevenlabs', elevenlabsVoice: '' }, providers)).toBe('v1');
    expect(resolveProviderVoice({ ...base, engine: 'elevenlabs', elevenlabsVoice: 'v2' }, providers)).toBe('v2');
    expect(resolveProviderVoice({ ...base, engine: 'elevenlabs', elevenlabsVoice: 'gone' }, providers)).toBe('v1');
    expect(resolveProviderVoice({ ...base, engine: 'elevenlabs', elevenlabsVoice: '' }, null)).toBe('');
  });

  describe('server voice picker', () => {
    const base = { ...DEFAULT_VOICE_SETTINGS, engine: 'elevenlabs' as const };
    const withElevenLabs = (info: Partial<VoiceProviderInfo>): VoiceProviderInfo[] => [
      { id: 'elevenlabs', label: 'ElevenLabs', available: true, voices: [], ...info },
    ];
    const listError = 'Could not list voices. ElevenLabs rejected the API key (HTTP 401).';

    it('lists voices when there are some, and falls back to typing a voice ID when there are none', () => {
      expect(serverVoicePicker(base, withElevenLabs({ voices: [{ id: 'v1', label: 'One' }] }), null)).toEqual({
        kind: 'list',
        voices: [{ id: 'v1', label: 'One' }],
      });
      expect(serverVoicePicker(base, withElevenLabs({ error: listError }), null)).toEqual({ kind: 'manual' });
      expect(serverVoicePicker(base, withElevenLabs({}), null)).toEqual({ kind: 'manual' });
      expect(serverVoicePicker(base, null, 'Could not list voices (HTTP 500).')).toEqual({ kind: 'manual' });
      expect(serverVoicePicker(base, null, null)).toEqual({ kind: 'loading' });
      expect(serverVoicePicker(base, withElevenLabs({ available: false }), null)).toEqual({ kind: 'no-key' });
      // OpenAI's voices are known without asking
      expect(serverVoicePicker({ ...base, engine: 'openai' }, null, 'Could not list voices (HTTP 500).').kind).toBe('list');
    });

    it('accepts only valid typed voice IDs', () => {
      expect(parseVoiceIdInput('  21m00Tcm4TlvDq8ikWAM ')).toBe('21m00Tcm4TlvDq8ikWAM');
      expect(parseVoiceIdInput('')).toBe('');
      expect(parseVoiceIdInput('not a voice/id')).toBeNull();
    });

    it('explains a missing voice by its cause, not with "pick a voice"', () => {
      const hint = 'Add ELEVENLABS_API_KEY in Settings → API keys to use ElevenLabs voices.';
      expect(missingVoiceReason(base, withElevenLabs({ available: false, hint }), null)).toBe(hint);
      expect(missingVoiceReason(base, withElevenLabs({ error: listError }), null)).toBe(
        `${listError} To use ElevenLabs anyway, enter a voice ID in voice settings.`
      );
      expect(missingVoiceReason(base, null, 'Could not list voices (HTTP 500).')).toBe(
        'Could not list voices (HTTP 500). To use ElevenLabs anyway, enter a voice ID in voice settings.'
      );
      expect(missingVoiceReason(base, withElevenLabs({}), null)).toContain('ElevenLabs did not list any voices.');
      expect(missingVoiceReason(base, null, null)).toBe('ElevenLabs voices are still loading.');
      // A voice to use: nothing to explain
      expect(missingVoiceReason({ ...base, elevenlabsVoice: 'typed_id' }, withElevenLabs({ error: listError }), null)).toBeNull();
      expect(missingVoiceReason(base, withElevenLabs({ voices: [{ id: 'v1', label: 'One' }] }), null)).toBeNull();
      expect(missingVoiceReason({ ...base, engine: 'browser' }, null, null)).toBeNull();
    });
  });
});

describe('provider helpers', () => {
  it('only accepts known OpenAI models', () => {
    expect(resolveOpenAiModel(undefined)).toBe('gpt-4o-mini-tts');
    expect(resolveOpenAiModel('tts-1-hd')).toBe('tts-1-hd');
    expect(resolveOpenAiModel('gpt-evil')).toBe('gpt-4o-mini-tts');
  });

  it('clamps OpenAI speed', () => {
    expect(clampOpenAiSpeed(undefined)).toBe(1);
    expect(clampOpenAiSpeed(10)).toBe(4);
    expect(clampOpenAiSpeed(0.1)).toBe(0.25);
  });

  it('omits instructions for tts-1', () => {
    const { init } = buildOpenAiSpeechRequest({ apiKey: 'k', model: 'tts-1', voice: 'alloy', text: 'x' });
    expect(JSON.parse(String(init.body))).not.toHaveProperty('instructions');
  });

  it('sends ElevenLabs exactly {text, model_id}', () => {
    const { url, init } = buildElevenLabsSpeechRequest({ apiKey: 'k', voiceId: 'v', text: 'x' });
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/v?output_format=mp3_44100_128');
    expect(JSON.parse(String(init.body))).toEqual({ text: 'x', model_id: 'eleven_turbo_v2_5' });
  });

  it('marks failures that retrying cannot fix', () => {
    expect(upstreamErrorCode(401)).toBe('auth');
    expect(upstreamErrorCode(403)).toBe('auth');
    expect(upstreamErrorCode(404)).toBe('not_found');
    expect(upstreamErrorCode(429)).toBeUndefined();
    expect(upstreamErrorCode(503)).toBeUndefined();
    expect(isBlockingTtsError(502, 'auth')).toBe(true);
    expect(isBlockingTtsError(502, 'not_found')).toBe(true);
    expect(isBlockingTtsError(400)).toBe(true);
    expect(isBlockingTtsError(502)).toBe(false);
    expect(isBlockingTtsError(429)).toBe(false);
  });

  it('parses ElevenLabs voices defensively', () => {
    expect(parseElevenLabsVoices(null)).toEqual([]);
    expect(parseElevenLabsVoices({ voices: 'x' })).toEqual([]);
    expect(parseElevenLabsVoices({ voices: [{ voice_id: 'ok', name: '' }, { name: 'no id' }] })).toEqual([{ id: 'ok', label: 'ok' }]);
  });

  it('explains upstream failures without details from the provider', () => {
    expect(upstreamErrorMessage('openai', 401)).toContain('rejected the API key');
    expect(upstreamErrorMessage('elevenlabs', 503)).toBe('ElevenLabs is unavailable right now (HTTP 503).');
    expect(upstreamErrorMessage('openai', 422)).toBe('OpenAI rejected the speech request (HTTP 422).');
  });
});
