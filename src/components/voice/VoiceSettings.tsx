'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import s from './voice.module.css';
import { NARRATION_LEVELS, isNarrationLevel } from '@/lib/voice/narration';
import { PROVIDER_LABELS, missingKeyMessage, type TtsProviderId } from '@/lib/voice/providers';
import { parseVoiceIdInput, resolveProviderVoice, serverVoicePicker, sortBrowserVoices } from '@/lib/voice/settings';
import type { VoiceConversation } from './useVoiceConversation';

interface VoiceSettingsProps {
  voice: VoiceConversation;
  onClose: () => void;
}

const ENGINES: TtsProviderId[] = ['browser', 'openai', 'elevenlabs'];

/**
 * A provider voice ID typed by hand, for when the provider's voices cannot
 * be listed. Saved as soon as it is a valid ID.
 */
function VoiceIdField({ value, provider, onChange }: { value: string; provider: string; onChange: (id: string) => void }) {
  const [draft, setDraft] = useState(value);
  const inputId = useId();
  const helpId = useId();
  const invalid = parseVoiceIdInput(draft) === null;
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={inputId}>
        Voice ID
      </label>
      <input
        id={inputId}
        className={s.input}
        type="text"
        value={draft}
        placeholder="Paste a voice ID"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={helpId}
        onChange={(e) => {
          setDraft(e.target.value);
          const id = parseVoiceIdInput(e.target.value);
          if (id !== null) onChange(id);
        }}
      />
      <span id={helpId} className={invalid ? s.fieldError : s.fieldHint}>
        {invalid
          ? 'A voice ID has only letters, digits, "-" and "_".'
          : `Could not list your ${provider} voices. Copy a voice ID from your ${provider} voice library.`}
      </span>
    </div>
  );
}

/** Popover with engine, voice, speed, narration level and listening options. */
export default function VoiceSettings({ voice, onClose }: VoiceSettingsProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { settings, updateSettings, providers, providersError, speech } = voice;
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Mount only: focus the panel once, close on Escape or an outside click, and
  // hand focus back to whatever opened it (normally the settings button)
  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement;
    const returnTo =
      opener instanceof HTMLElement && opener !== document.body
        ? opener
        : document.querySelector<HTMLElement>('button[aria-label="Voice settings"]');
    panel?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!panelRef.current || !target || panelRef.current.contains(target)) return;
      // The settings button toggles the panel itself
      if (target.closest('[aria-label="Voice settings"]')) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      // Unless the user already moved focus elsewhere (an outside click)
      const focused = document.activeElement;
      const lost = !focused || focused === document.body || !focused.isConnected || !!panel?.contains(focused);
      if (lost && returnTo?.isConnected) returnTo.focus();
    };
  }, []);

  const lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
  const provider = providers?.find((p) => p.id === settings.engine);
  const engineAvailable = settings.engine === 'browser' || provider?.available !== false;
  const browserVoices = sortBrowserVoices(speech.browserVoices, lang);
  const primaryLang = lang.split('-')[0].toLowerCase();
  const localVoices = browserVoices.filter((v) => v.lang.toLowerCase().startsWith(primaryLang));
  const otherVoices = browserVoices.filter((v) => !v.lang.toLowerCase().startsWith(primaryLang));
  const picker = serverVoicePicker(settings, providers, providersError);
  const serverVoice = resolveProviderVoice(settings, providers);

  const engineLabel = (id: TtsProviderId) => {
    if (id === 'browser') return 'Browser (free, on this device)';
    const info = providers?.find((p) => p.id === id);
    return info && !info.available ? `${PROVIDER_LABELS[id]} (add API key)` : PROVIDER_LABELS[id];
  };

  const setServerVoice = (id: string) => {
    if (settings.engine === 'openai') updateSettings({ openaiVoice: id });
    else if (settings.engine === 'elevenlabs') updateSettings({ elevenlabsVoice: id });
  };

  return (
    <div ref={panelRef} className={s.panel} role="dialog" aria-label="Voice settings" tabIndex={-1}>
      <div className={s.panelHeader}>
        <h3 className={s.panelTitle}>Voice</h3>
        <button type="button" className={s.dismiss} onClick={onClose} aria-label="Close voice settings">
          ×
        </button>
      </div>

      <div className={s.grid}>
        <label className={s.field}>
          <span className={s.label}>Voice engine</span>
          <select
            className={s.select}
            value={settings.engine}
            onChange={(e) => updateSettings({ engine: e.target.value as TtsProviderId })}
          >
            {ENGINES.map((id) => (
              <option key={id} value={id}>
                {engineLabel(id)}
              </option>
            ))}
          </select>
        </label>

        {settings.engine !== 'browser' && picker.kind === 'manual' ? (
          <VoiceIdField
            key={settings.engine}
            value={serverVoice}
            provider={PROVIDER_LABELS[settings.engine]}
            onChange={setServerVoice}
          />
        ) : (
          <label className={s.field}>
            <span className={s.label}>Voice</span>
            {settings.engine === 'browser' ? (
              <select
                className={s.select}
                value={settings.browserVoice}
                onChange={(e) => updateSettings({ browserVoice: e.target.value })}
                disabled={!speech.browserSupported}
              >
                <option value="">Automatic (most natural)</option>
                {localVoices.length > 0 && (
                  <optgroup label="Your language">
                    {localVoices.map((v) => (
                      <option key={`${v.name}-${v.lang}`} value={v.name}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherVoices.length > 0 && (
                  <optgroup label="Other languages">
                    {otherVoices.map((v) => (
                      <option key={`${v.name}-${v.lang}`} value={v.name}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            ) : picker.kind === 'list' ? (
              <select className={s.select} value={serverVoice} onChange={(e) => setServerVoice(e.target.value)}>
                {picker.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            ) : (
              <select className={s.select} value="" disabled>
                <option value="">{picker.kind === 'loading' ? 'Loading voices…' : 'Add an API key first'}</option>
              </select>
            )}
          </label>
        )}

        <div className={s.field}>
          <label className={s.label} htmlFor="voice-rate">
            Speed
          </label>
          <div className={s.rangeRow}>
            <input
              id="voice-rate"
              className={s.range}
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={settings.rate}
              onChange={(e) => updateSettings({ rate: Number(e.target.value) })}
            />
            <span className={s.rangeValue}>{settings.rate.toFixed(2)}×</span>
          </div>
        </div>

        {settings.engine === 'browser' && (
          <div className={s.field}>
            <label className={s.label} htmlFor="voice-pitch">
              Pitch
            </label>
            <div className={s.rangeRow}>
              <input
                id="voice-pitch"
                className={s.range}
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={settings.pitch}
                onChange={(e) => updateSettings({ pitch: Number(e.target.value) })}
              />
              <span className={s.rangeValue}>{settings.pitch.toFixed(2)}</span>
            </div>
          </div>
        )}

        <label className={s.field}>
          <span className={s.label}>In voice mode, speak</span>
          <select
            className={s.select}
            value={settings.level}
            onChange={(e) => {
              if (isNarrationLevel(e.target.value)) updateSettings({ level: e.target.value });
            }}
          >
            {NARRATION_LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {settings.engine !== 'browser' && !engineAvailable && (
        <div className={s.fieldHint}>{provider?.hint ?? missingKeyMessage(settings.engine)}</div>
      )}
      {settings.engine !== 'browser' && provider?.error && <div className={s.fieldError}>{provider.error}</div>}
      {providersError && settings.engine !== 'browser' && <div className={s.fieldError}>{providersError}</div>}
      {settings.engine === 'browser' && !speech.browserSupported && (
        <div className={s.fieldError}>This browser cannot speak. Pick a server voice or use Chrome, Edge or Safari.</div>
      )}

      <label className={s.check}>
        <input
          type="checkbox"
          checked={settings.bargeIn}
          onChange={(e) => updateSettings({ bargeIn: e.target.checked })}
        />
        <span>Let me interrupt while it speaks (use headphones)</span>
      </label>
      <label className={s.check}>
        <input
          type="checkbox"
          checked={settings.readReplies}
          onChange={(e) => updateSettings({ readReplies: e.target.checked })}
        />
        <span>Read replies and questions aloud when voice mode is off</span>
      </label>

      {speech.error && <div className={s.fieldError}>{speech.error}</div>}

      <div className={s.panelActions}>
        <button type="button" className={s.primaryBtn} onClick={voice.testVoice}>
          Test voice
        </button>
        {speech.speaking && (
          <button type="button" className={s.secondaryBtn} onClick={speech.cancel}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
