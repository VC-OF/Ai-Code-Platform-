import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VoiceStatusBar from '@/components/voice/VoiceStatusBar';
import VoiceControls from '@/components/voice/VoiceControls';
import VoiceSettings from '@/components/voice/VoiceSettings';
import SpeakButton from '@/components/voice/SpeakButton';
import MessageInput from '@/components/chat/MessageInput';
import type { VoiceConversation, VoicePhase } from '@/components/voice/useVoiceConversation';
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings as VoiceSettingsValue } from '@/lib/voice/settings';
import type { VoiceProviderInfo } from '@/lib/voice/providers';

function fakeVoice(overrides: {
  active?: boolean;
  phase?: VoicePhase;
  interim?: string;
  heard?: VoiceConversation['heard'];
  speechError?: string | null;
  listeningError?: string | null;
  problem?: string | null;
  settings?: Partial<VoiceSettingsValue>;
  providers?: VoiceProviderInfo[] | null;
  providersError?: string | null;
} = {}): VoiceConversation {
  const noop = () => {};
  return {
    active: overrides.active ?? true,
    phase: overrides.phase ?? 'listening',
    toggle: noop,
    setVoiceMode: noop,
    settings: { ...DEFAULT_VOICE_SETTINGS, ...overrides.settings },
    updateSettings: noop,
    providers: overrides.providers ?? null,
    providersError: overrides.providersError ?? null,
    refreshProviders: noop,
    speech: {
      speak: noop,
      cancel: noop,
      speaking: overrides.phase === 'speaking',
      currentTag: null,
      error: overrides.speechError ?? null,
      clearError: noop,
      unblockServer: noop,
      browserSupported: true,
      browserVoices: [],
      recentSpoken: () => [],
      currentText: () => null,
    },
    listening: {
      supported: overrides.phase !== 'unsupported',
      listening: overrides.phase === 'listening' || overrides.phase === 'thinking',
      interim: overrides.interim ?? '',
      error: overrides.listeningError ?? null,
      pause: noop,
      resume: noop,
      paused: false,
    },
    heard: overrides.heard ?? null,
    problem: overrides.problem ?? null,
    clearProblem: noop,
    narrate: noop,
    beginTurn: noop,
    readAloud: noop,
    testVoice: noop,
  };
}

// styled-jsx is compiled by Next, not here; React warns about the raw `jsx` attribute
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe('VoiceStatusBar', () => {
  it('renders nothing when voice mode is off', () => {
    expect(renderToStaticMarkup(<VoiceStatusBar voice={fakeVoice({ active: false, phase: 'off' })} />)).toBe('');
  });

  it('still reports a failed read-aloud when voice mode is off', () => {
    const html = renderToStaticMarkup(
      <VoiceStatusBar voice={fakeVoice({ active: false, phase: 'off', speechError: 'This browser cannot read text aloud.' })} />
    );
    expect(html).toContain('This browser cannot read text aloud.');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="Dismiss voice error"');
    // Only the error: no voice-mode status
    expect(html).not.toContain('aria-label="Voice mode"');
  });

  it('shows the phase and a hint while listening', () => {
    const html = renderToStaticMarkup(<VoiceStatusBar voice={fakeVoice()} />);
    expect(html).toContain('Listening');
    expect(html).toContain('Say what to build, or ask a question.');
  });

  it('shows the live transcript', () => {
    const html = renderToStaticMarkup(<VoiceStatusBar voice={fakeVoice({ phase: 'thinking', interim: 'also add tests' })} />);
    expect(html).toContain('Thinking');
    expect(html).toContain('also add tests');
  });

  it('shows how the last utterance was routed', () => {
    const html = renderToStaticMarkup(
      <VoiceStatusBar voice={fakeVoice({ phase: 'thinking', heard: { text: 'use vitest', kind: 'steer' } })} />
    );
    expect(html).toContain('Sent to the agent');
    expect(html).toContain('use vitest');
  });

  it('offers to stop speaking and surfaces voice errors', () => {
    const html = renderToStaticMarkup(
      <VoiceStatusBar voice={fakeVoice({ phase: 'speaking', speechError: 'OpenAI rejected the API key.' })} />
    );
    expect(html).toContain('Stop speaking');
    expect(html).toContain('OpenAI rejected the API key.');
    expect(html).toContain('role="alert"');
  });

  it('reports a spoken command that could not be carried out', () => {
    const html = renderToStaticMarkup(
      <VoiceStatusBar voice={fakeVoice({ phase: 'thinking', heard: { text: 'stop', kind: 'stop' }, problem: 'Could not stop the agent.' })} />
    );
    expect(html).toContain('Could not stop the agent.');
    expect(html).toContain('role="alert"');
    expect(renderToStaticMarkup(<VoiceStatusBar voice={fakeVoice()} />)).not.toContain('role="alert"');
  });

  it('explains missing speech recognition in its own status row', () => {
    const html = renderToStaticMarkup(<VoiceStatusBar voice={fakeVoice({ phase: 'unsupported' })} />);
    expect(html).toMatch(/role="status"[^>]*><span[^>]*>Voice input needs Chrome or Edge/);
  });

  it('announces why the microphone stopped, in full, instead of the last thing heard', () => {
    const message = 'Microphone access is blocked. Allow the microphone for this site (the icon in the address bar), then turn voice mode off and on.';
    const html = renderToStaticMarkup(
      <VoiceStatusBar voice={fakeVoice({ phase: 'error', listeningError: message, heard: { text: 'use vitest', kind: 'steer' } })} />
    );
    expect(html).toContain('Microphone off');
    // In the wrapping alert row, not the one-line transcript
    expect(html.slice(html.indexOf('role="alert"'))).toContain(`>${message}</span>`);
    expect(html).not.toMatch(/_transcript_[^"]*"[^>]*>[^<]*Microphone access/);
    expect(html).not.toContain('use vitest');
    expect(html).not.toContain('Sent to the agent');
  });
});

describe('VoiceSettings voice picker', () => {
  const elevenlabs = (info: Partial<VoiceProviderInfo>): VoiceProviderInfo[] => [
    { id: 'browser', label: 'Browser voices', available: true, voices: [] },
    { id: 'elevenlabs', label: 'ElevenLabs', available: true, voices: [], ...info },
  ];
  const render = (overrides: Parameters<typeof fakeVoice>[0]) =>
    renderToStaticMarkup(<VoiceSettings voice={fakeVoice(overrides)} onClose={() => {}} />);

  it('lets the user type an ElevenLabs voice ID when the voices cannot be listed, keeping the saved one', () => {
    const html = render({
      settings: { engine: 'elevenlabs', elevenlabsVoice: 'saved_voice_1' },
      providers: elevenlabs({ error: 'Could not list voices. ElevenLabs rejected the API key (HTTP 401).' }),
    });
    expect(html).toContain('>Voice ID</label>');
    expect(html).toMatch(/<input[^>]*type="text"[^>]*value="saved_voice_1"/);
    expect(html).toContain('Could not list your ElevenLabs voices');
    expect(html).toContain('Could not list voices. ElevenLabs rejected the API key (HTTP 401).');
    expect(html).not.toContain('No voices loaded');
  });

  it('also accepts a voice ID when the voice catalog could not be fetched at all', () => {
    const html = render({ settings: { engine: 'elevenlabs' }, providersError: 'Could not list voices (HTTP 500).' });
    expect(html).toMatch(/<input[^>]*type="text"[^>]*value=""/);
    expect(html).toContain('Could not list voices (HTTP 500).');
  });

  it('offers the listed voices in a select', () => {
    const html = render({
      settings: { engine: 'elevenlabs' },
      providers: elevenlabs({ voices: [{ id: 'v1', label: 'Rachel' }] }),
    });
    expect(html).toContain('>Rachel</option>');
    expect(html).not.toContain('type="text"');
  });

  it('asks for a key instead of a voice when ElevenLabs has none', () => {
    const html = render({
      settings: { engine: 'elevenlabs' },
      providers: elevenlabs({ available: false, hint: 'Add ELEVENLABS_API_KEY in Settings → API keys to use ElevenLabs voices.' }),
    });
    expect(html).toContain('Add an API key first');
    expect(html).toContain('Add ELEVENLABS_API_KEY in Settings → API keys to use ElevenLabs voices.');
    expect(html).not.toContain('type="text"');
  });
});

describe('VoiceControls and SpeakButton', () => {
  it('labels the toggle and reflects its state', () => {
    const on = renderToStaticMarkup(<VoiceControls voice={fakeVoice()} settingsOpen={false} onToggleSettings={() => {}} />);
    expect(on).toContain('aria-label="Voice mode"');
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('>Voice<');
    expect(on).toContain('aria-label="Voice settings"');
    const off = renderToStaticMarkup(
      <VoiceControls voice={fakeVoice({ active: false, phase: 'off' })} settingsOpen={false} onToggleSettings={() => {}} />
    );
    expect(off).toContain('aria-pressed="false"');
  });

  it('names the read-aloud button after its visible label', () => {
    const idle = renderToStaticMarkup(<SpeakButton active={false} onClick={() => {}} />);
    expect(idle).toContain('aria-label="Listen to this reply"');
    expect(idle).toContain('>Listen<');
    const reading = renderToStaticMarkup(<SpeakButton active onClick={() => {}} />);
    expect(reading).toContain('aria-label="Stop reading aloud"');
    expect(reading).toContain('>Stop<');
    // The name already says what a click does, so it is not also a toggle
    expect(idle + reading).not.toContain('aria-pressed');
  });
});

describe('MessageInput with voice', () => {
  const props = {
    value: '',
    onChange: () => {},
    onSend: () => {},
    onCancel: () => {},
  };

  it('keeps voice mode and dictation available while the agent is running', () => {
    const html = renderToStaticMarkup(<MessageInput {...props} isStreaming voice={fakeVoice({ active: false, phase: 'off' })} />);
    expect(html).toContain('aria-label="Voice mode"');
    expect(html).toContain('aria-label="Start voice input"');
    // Attach buttons still hide while streaming
    expect(html).not.toContain('aria-label="Attach files or images"');
  });

  it('shows the status bar and a voice placeholder when voice mode is on', () => {
    const html = renderToStaticMarkup(<MessageInput {...props} isStreaming={false} voice={fakeVoice()} />);
    expect(html).toContain('Listening');
    expect(html).toContain('Voice mode is on: talk, or type here…');
  });

  it('shows a read-aloud error above the composer when voice mode is off', () => {
    const html = renderToStaticMarkup(
      <MessageInput {...props} isStreaming={false} voice={fakeVoice({ active: false, phase: 'off', speechError: 'The voice service failed.' })} />
    );
    expect(html).toContain('The voice service failed.');
    expect(html).toContain('role="alert"');
  });

  it('renders without voice support wired in', () => {
    const html = renderToStaticMarkup(<MessageInput {...props} isStreaming={false} />);
    expect(html).not.toContain('aria-label="Voice mode"');
    expect(html).toContain('aria-label="Start voice input"');
  });
});
