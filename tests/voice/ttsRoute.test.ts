import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/settingsStore', () => ({ getDecryptedEnv: vi.fn(async () => ({})) }));

import { getDecryptedEnv } from '@/lib/settingsStore';
import { clearVoiceCache, getVoiceCatalog, handleTtsRequest } from '@/lib/voice/voiceServer';
import { OPENAI_TTS_INSTRUCTIONS } from '@/lib/voice/providers';
import { POST } from '@/app/api/voice/tts/route';
import { GET } from '@/app/api/voice/route';

const OPENAI_KEY = 'sk-test-openai-SECRET-1234567890';
const ELEVEN_KEY = 'xi-test-eleven-SECRET-0987654321';

const mockedEnv = vi.mocked(getDecryptedEnv);

function ttsRequest(body: unknown): Request {
  return new Request('http://localhost/api/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function audioResponse(bytes = [1, 2, 3]) {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
}

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

function fetchMock(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (...[input, init]: FetchArgs) => respond(String(input), init));
}

async function errorOf(res: Response): Promise<string> {
  const data = (await res.json()) as { error?: string };
  return data.error ?? '';
}

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('ELEVENLABS_API_KEY', '');
  vi.stubEnv('OPENAI_TTS_MODEL', '');
  vi.stubEnv('OPENAI_TTS_API_KEY', '');
  vi.stubEnv('LLM_BASE_URL', '');
  vi.stubEnv('OPENAI_API_BASE', '');
  vi.stubEnv('OPENAI_BASE_URL', '');
  mockedEnv.mockReset();
  mockedEnv.mockResolvedValue({});
  clearVoiceCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/voice/tts validation', () => {
  it('400 with a clear message when the OpenAI key is missing', async () => {
    const fetchImpl = fetchMock(() => audioResponse());
    const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'Hello' }), { fetchImpl });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Add OPENAI_API_KEY in Settings → API keys to use OpenAI voices.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('400 when the ElevenLabs key is missing', async () => {
    const res = await handleTtsRequest(ttsRequest({ provider: 'elevenlabs', voice: 'abc123', text: 'Hello' }), {
      fetchImpl: fetchMock(() => audioResponse()),
    });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Add ELEVENLABS_API_KEY in Settings → API keys to use ElevenLabs voices.');
  });

  it('400 for an OpenAI voice outside the allowlist', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const fetchImpl = fetchMock(() => audioResponse());
    const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'darth', text: 'Hello' }), { fetchImpl });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain('Unknown OpenAI voice');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('400 for a voice id with illegal characters (not echoed back)', async () => {
    mockedEnv.mockResolvedValue({ ELEVENLABS_API_KEY: ELEVEN_KEY });
    const res = await handleTtsRequest(ttsRequest({ provider: 'elevenlabs', voice: '../../v1/user', text: 'Hi' }), {
      fetchImpl: fetchMock(() => audioResponse()),
    });
    expect(res.status).toBe(400);
    const message = await errorOf(res);
    expect(message).toMatch(/voice must be/);
    expect(message).not.toContain('../');
  });

  it('400 when the text is too long, empty or missing', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const fetchImpl = fetchMock(() => audioResponse());
    const long = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'a'.repeat(4001) }), { fetchImpl });
    expect(long.status).toBe(400);
    expect(await errorOf(long)).toMatch(/too long.*4001.*4000/);
    const empty = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: '   ' }), { fetchImpl });
    expect(empty.status).toBe(400);
    const missing = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin' }), { fetchImpl });
    expect(missing.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts exactly 4000 characters', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'a'.repeat(4000) }), {
      fetchImpl: fetchMock(() => audioResponse()),
    });
    expect(res.status).toBe(200);
  });

  it('400 for an unknown provider, bad speed or a non-JSON body', async () => {
    const fetchImpl = fetchMock(() => audioResponse());
    expect((await handleTtsRequest(ttsRequest({ provider: 'browser', voice: 'x', text: 'Hi' }), { fetchImpl })).status).toBe(400);
    expect((await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'Hi', speed: 9 }), { fetchImpl })).status).toBe(400);
    expect((await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'Hi', speed: '1' }), { fetchImpl })).status).toBe(400);
    expect((await handleTtsRequest(ttsRequest('not json'), { fetchImpl })).status).toBe(400);
    expect((await handleTtsRequest(ttsRequest([1, 2]), { fetchImpl })).status).toBe(400);
  });
});

describe('POST /api/voice/tts upstream calls', () => {
  it('sends the OpenAI request with the key from settings and streams audio back', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const fetchImpl = fetchMock(() => audioResponse([9, 8, 7]));
    const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: '  Hello there.  ', speed: 1.25 }), { fetchImpl });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([9, 8, 7]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/audio/speech');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gpt-4o-mini-tts',
      voice: 'marin',
      input: 'Hello there.',
      instructions: OPENAI_TTS_INSTRUCTIONS,
      response_format: 'mp3',
      speed: 1.25,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('falls back to process.env when the settings store has no key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-from-env');
    const fetchImpl = fetchMock(() => audioResponse());
    const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'coral', text: 'Hi' }), { fetchImpl });
    expect(res.status).toBe(200);
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer sk-from-env');
  });

  it('prefers the settings key over process.env', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-from-env');
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const fetchImpl = fetchMock(() => audioResponse());
    await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'coral', text: 'Hi' }), { fetchImpl });
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it('maps an upstream 401 to 502 without leaking the key', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = fetchMock(() =>
      Response.json(
        { error: { message: `Incorrect API key provided: ${OPENAI_KEY}. You can find your API key at …` } },
        { status: 401 }
      )
    );
    const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'Hi' }), { fetchImpl });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(OPENAI_KEY);
    expect(text).not.toContain('SECRET');
    expect(JSON.parse(text).error).toMatch(/OpenAI rejected the API key \(HTTP 401\)/);
    // Tells the client that retrying cannot help
    expect(JSON.parse(text).code).toBe('auth');
    for (const call of warn.mock.calls) expect(call.join(' ')).not.toContain(OPENAI_KEY);
    warn.mockRestore();
  });

  it('maps network failures to 502', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const fetchImpl = fetchMock(() => {
      throw new TypeError('fetch failed');
    });
    const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'Hi' }), { fetchImpl });
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe('Could not reach OpenAI.');
  });

  it('retries once with tts-1 when gpt-4o-mini-tts is rejected', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const fetchImpl = fetchMock((_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.model === 'gpt-4o-mini-tts' ? Response.json({ error: 'model_not_found' }, { status: 404 }) : audioResponse();
    });
    const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'Hi' }), { fetchImpl });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retry = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    // marin is not a tts-1 voice, so a close legacy voice is used, without instructions
    expect(retry).toEqual({ model: 'tts-1', voice: 'coral', input: 'Hi', response_format: 'mp3', speed: 1 });
  });

  it('uses the tts-1 voice list when OPENAI_TTS_MODEL selects it', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY, OPENAI_TTS_MODEL: 'tts-1' });
    const fetchImpl = fetchMock(() => audioResponse());
    const bad = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'Hi' }), { fetchImpl });
    expect(bad.status).toBe(400);
    const ok = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'nova', text: 'Hi' }), { fetchImpl });
    expect(ok.status).toBe(200);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).model).toBe('tts-1');
  });

  it('sends the ElevenLabs request with xi-api-key and the turbo model', async () => {
    mockedEnv.mockResolvedValue({ ELEVENLABS_API_KEY: ELEVEN_KEY });
    const fetchImpl = fetchMock(() => audioResponse());
    const res = await handleTtsRequest(ttsRequest({ provider: 'elevenlabs', voice: 'EXAVITQu4vr4xnSDxMaL', text: 'Hello' }), { fetchImpl });
    expect(res.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_128');
    expect((init?.headers as Record<string, string>)['xi-api-key']).toBe(ELEVEN_KEY);
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'Hello', model_id: 'eleven_turbo_v2_5' });
  });

  it('ignores speed for ElevenLabs and flags an unknown voice', async () => {
    mockedEnv.mockResolvedValue({ ELEVENLABS_API_KEY: ELEVEN_KEY });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = fetchMock(() => new Response('voice_not_found', { status: 404 }));
    const res = await handleTtsRequest(ttsRequest({ provider: 'elevenlabs', voice: 'gone', text: 'Hi', speed: 1.5 }), { fetchImpl });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ text: 'Hi', model_id: 'eleven_turbo_v2_5' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'ElevenLabs could not find that voice or model (HTTP 404).', code: 'not_found' });
    warn.mockRestore();
  });

  it('maps ElevenLabs 429 to 502 with a short message', async () => {
    mockedEnv.mockResolvedValue({ ELEVENLABS_API_KEY: ELEVEN_KEY });
    const res = await handleTtsRequest(ttsRequest({ provider: 'elevenlabs', voice: 'abc', text: 'Hello' }), {
      fetchImpl: fetchMock(() => new Response(`quota exceeded for ${ELEVEN_KEY}`, { status: 429 })),
    });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(ELEVEN_KEY);
    expect(JSON.parse(text).error).toContain('HTTP 429');
    expect(JSON.parse(text)).not.toHaveProperty('code');
  });

  it('the route module wires the handler to the settings store and global fetch', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const fetchSpy = fetchMock(() => audioResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(ttsRequest({ provider: 'openai', voice: 'alloy', text: 'Wired' }));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockedEnv).toHaveBeenCalled();
  });
});

describe('OpenAI key scope', () => {
  const GATEWAY = 'https://gateway.example.com/v1';

  it.each(['LLM_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_BASE_URL'])(
    'never sends OPENAI_API_KEY to OpenAI when %s points at another host',
    async (envName) => {
      mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
      vi.stubEnv(envName, GATEWAY);
      const fetchImpl = fetchMock(() => audioResponse());

      const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'Hi' }), { fetchImpl });
      expect(res.status).toBe(400);
      const error = await errorOf(res);
      expect(error).toContain(envName);
      expect(error).toContain('OPENAI_TTS_API_KEY');
      expect(error).not.toContain(OPENAI_KEY);
      expect(fetchImpl).not.toHaveBeenCalled();

      const { providers } = await getVoiceCatalog({ fetchImpl });
      const openai = providers.find((p) => p.id === 'openai');
      expect(openai?.available).toBe(false);
      expect(openai?.hint).toBe(error);
    }
  );

  it('reads the base URL from the settings store too', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY, LLM_BASE_URL: GATEWAY });
    const { providers } = await getVoiceCatalog({ fetchImpl: fetchMock(() => audioResponse()) });
    expect(providers.find((p) => p.id === 'openai')?.available).toBe(false);
  });

  it('still uses OPENAI_API_KEY when the base URL is OpenAI itself', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY, OPENAI_API_BASE: 'https://api.openai.com/v1' });
    const fetchImpl = fetchMock(() => audioResponse());
    const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'Hi' }), { fetchImpl });
    expect(res.status).toBe(200);
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it('uses the dedicated OPENAI_TTS_API_KEY, even next to a gateway', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: 'gateway-key', OPENAI_TTS_API_KEY: 'sk-voice-only', LLM_BASE_URL: GATEWAY });
    const fetchImpl = fetchMock(() => audioResponse());
    const res = await handleTtsRequest(ttsRequest({ provider: 'openai', voice: 'marin', text: 'Hi' }), { fetchImpl });
    expect(res.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/audio/speech');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-voice-only');
    const { providers } = await getVoiceCatalog({ fetchImpl });
    expect(providers.find((p) => p.id === 'openai')?.available).toBe(true);
  });
});

describe('GET /api/voice', () => {
  it('reports availability without exposing keys', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const { providers } = await getVoiceCatalog({ fetchImpl: fetchMock(() => audioResponse()) });
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
    expect(byId.browser.available).toBe(true);
    expect(byId.openai.available).toBe(true);
    expect(byId.openai.voices.map((v) => v.id)).toContain('marin');
    expect(byId.openai.voices).toHaveLength(13);
    expect(byId.elevenlabs.available).toBe(false);
    expect(byId.elevenlabs.hint).toContain('ELEVENLABS_API_KEY');
    expect(JSON.stringify(providers)).not.toContain(OPENAI_KEY);
  });

  it('lists ElevenLabs voices server-side and caches them for 10 minutes', async () => {
    mockedEnv.mockResolvedValue({ ELEVENLABS_API_KEY: ELEVEN_KEY });
    const fetchImpl = fetchMock(() =>
      Response.json({
        voices: [
          { voice_id: 'voice_1', name: 'Rachel', labels: { accent: 'american', gender: 'female' } },
          { voice_id: 'bad/id', name: 'Broken' },
          { voice_id: 'voice_2', name: 'Adam' },
        ],
      })
    );
    let now = 1_000_000;
    const first = await getVoiceCatalog({ fetchImpl, now: () => now });
    const eleven = first.providers.find((p) => p.id === 'elevenlabs');
    expect(eleven?.available).toBe(true);
    expect(eleven?.voices).toEqual([
      { id: 'voice_1', label: 'Rachel (american, female)' },
      { id: 'voice_2', label: 'Adam' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.elevenlabs.io/v1/voices');
    expect((init?.headers as Record<string, string>)['xi-api-key']).toBe(ELEVEN_KEY);

    now += 9 * 60_000;
    await getVoiceCatalog({ fetchImpl, now: () => now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 2 * 60_000;
    await getVoiceCatalog({ fetchImpl, now: () => now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps ElevenLabs available with an error when listing fails', async () => {
    mockedEnv.mockResolvedValue({ ELEVENLABS_API_KEY: ELEVEN_KEY });
    const failing = await getVoiceCatalog({ fetchImpl: fetchMock(() => new Response('nope', { status: 401 })) });
    const eleven = failing.providers.find((p) => p.id === 'elevenlabs');
    expect(eleven?.available).toBe(true);
    expect(eleven?.voices).toEqual([]);
    expect(eleven?.error).toContain('HTTP 401');

    const timedOut = await getVoiceCatalog({
      fetchImpl: fetchMock(() => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      }),
    });
    expect(timedOut.providers.find((p) => p.id === 'elevenlabs')?.error).toMatch(/did not respond in time/);
  });

  it('the GET route returns the catalog as JSON', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { providers: { id: string }[] };
    expect(data.providers.map((p) => p.id)).toEqual(['browser', 'openai', 'elevenlabs']);
  });

  it('treats an unreadable settings store as empty', async () => {
    mockedEnv.mockRejectedValue(new Error('decrypt failed'));
    const { providers } = await getVoiceCatalog({ fetchImpl: fetchMock(() => audioResponse()) });
    expect(providers.find((p) => p.id === 'openai')?.available).toBe(false);
  });
});
