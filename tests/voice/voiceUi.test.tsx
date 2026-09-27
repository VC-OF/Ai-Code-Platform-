import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VoiceStatusBar from '@/components/voice/VoiceStatusBar';
import VoiceControls from '@/components/voice/VoiceControls';
import SpeakButton from '@/components/voice/SpeakButton';
import MessageInput from '@/components/chat/MessageInput';
import type { VoiceConversation, VoicePhase } from '@/components/voice/useVoiceConversation';
import { DEFAULT_VOICE_SETTINGS } from '@/lib/voice/settings';

function fakeVoice(overrides: {
  active?: boolean;
  phase?: VoicePhase;
  interim?: string;
  heard?: VoiceConversation['heard'];
  speechError?: string | null;
  listeningError?: string | null;
  problem?: string | null;
} = {}): VoiceConversation {
  const noop = () => {};
  return {
    active: overrides.active ?? true,
    phase: overrides.phase ?? 'listening',
    toggle: noop,
    setVoiceMode: noop,
    settings: { ...DEFAULT_VOICE_SETTINGS },
    updateSettings: noop,
    providers: null,
    providersError: null,
    refreshProviders: noop,
    speech: {
      speak: noop,
      cancel: noop,
      speaking: overrides.phase === 'speaking',
      currentTag: null,
      error: overrides.speechError ?? null,
      clearError: noop,
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

  it('explains missing speech recognition', () => {
    const html = renderToStaticMarkup(<VoiceStatusBar voice={fakeVoice({ phase: 'unsupported' })} />);
    expect(html).toContain('Voice input needs Chrome or Edge');
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

  it('renders without voice support wired in', () => {
    const html = renderToStaticMarkup(<MessageInput {...props} isStreaming={false} />);
    expect(html).not.toContain('aria-label="Voice mode"');
    expect(html).toContain('aria-label="Start voice input"');
  });
});
