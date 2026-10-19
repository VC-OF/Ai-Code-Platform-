import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/settingsStore', () => ({ getDecryptedEnv: vi.fn(async () => ({})) }));

import { getDecryptedEnv } from '@/lib/settingsStore';
import { handleSttRequest } from '@/lib/voice/sttServer';
import { POST } from '@/app/api/voice/stt/route';

const OPENAI_KEY = 'sk-test-openai-SECRET-1234567890';
const mockedEnv = vi.mocked(getDecryptedEnv);

function sttRequest(provider = 'openai'): Request {
  const form = new FormData();
  form.append('provider', provider);
  form.append('audio', new File([new Uint8Array([1, 2, 3, 4])], 'utterance.webm', { type: 'audio/webm' }));
  return new Request('http://localhost/api/voice/stt', { method: 'POST', body: form });
}

async function errorOf(res: Response): Promise<string> {
  const data = (await res.json()) as { error?: string };
  return data.error ?? '';
}

type FetchArgs = [input: string | URL | Request, init?: RequestInit];
function fetchMock(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (...[input, init]: FetchArgs) => respond(String(input), init));
}

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('OPENAI_TTS_API_KEY', '');
  vi.stubEnv('LLM_BASE_URL', '');
  vi.stubEnv('OPENAI_API_BASE', '');
  vi.stubEnv('OPENAI_BASE_URL', '');
  mockedEnv.mockReset();
  mockedEnv.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/voice/stt', () => {
  it('400 when the audio field is missing', async () => {
    const form = new FormData();
    form.append('provider', 'openai');
    const res = await handleSttRequest(new Request('http://localhost/api/voice/stt', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/audio/i);
  });

  it('400 when the audio clip is empty', async () => {
    const form = new FormData();
    form.append('provider', 'openai');
    form.append('audio', new File([], 'empty.webm', { type: 'audio/webm' }));
    const res = await handleSttRequest(new Request('http://localhost/api/voice/stt', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/empty/i);
  });

  it('400 with an actionable message when no key is set', async () => {
    const fetchImpl = fetchMock(() => Response.json({ text: 'hi' }));
    const res = await handleSttRequest(sttRequest(), { fetchImpl });
    expect(res.status).toBe(400);
    const message = await errorOf(res);
    expect(message).toMatch(/OPENAI_API_KEY|OPENAI_TTS_API_KEY/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('transcribes through the OpenAI audio API with the decrypted key', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const fetchImpl = fetchMock(() => Response.json({ text: '  hello world  ' }));
    const res = await handleSttRequest(sttRequest(), { fetchImpl });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'hello world' });

    const [url, init] = fetchImpl.mock.calls[0] as FetchArgs;
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENAI_KEY}`);
    const body = init?.body as FormData;
    expect(body.get('model')).toBe('whisper-1');
    expect(body.get('file')).toBeInstanceOf(File);
  });

  it('falls back to process.env when the settings store has no key', async () => {
    vi.stubEnv('OPENAI_API_KEY', OPENAI_KEY);
    const fetchImpl = fetchMock(() => Response.json({ text: 'from env' }));
    const res = await handleSttRequest(sttRequest(), { fetchImpl });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'from env' });
  });

  it('maps upstream auth failures to code auth', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    const fetchImpl = fetchMock(() => Response.json({ error: { message: 'bad key' } }, { status: 401 }));
    const res = await handleSttRequest(sttRequest(), { fetchImpl });
    expect(res.status).toBe(502);
    const data = (await res.json()) as { code?: string };
    expect(data.code).toBe('auth');
  });

  it('withholds a gateway key from the transcription endpoint', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://gateway.example.com/v1');
    vi.stubEnv('OPENAI_API_KEY', 'sk-gateway');
    const fetchImpl = fetchMock(() => Response.json({ text: 'x' }));
    const res = await handleSttRequest(sttRequest(), { fetchImpl });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/custom endpoint/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('route handler delegates to handleSttRequest', async () => {
    mockedEnv.mockResolvedValue({ OPENAI_API_KEY: OPENAI_KEY });
    vi.stubGlobal('fetch', fetchMock(() => Response.json({ text: 'routed' })) as unknown as typeof fetch);
    const res = await POST(sttRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'routed' });
  });
});
