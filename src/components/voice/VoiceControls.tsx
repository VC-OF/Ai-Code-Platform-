'use client';

import s from './voice.module.css';
import type { VoiceConversation } from './useVoiceConversation';

interface VoiceControlsProps {
  voice: VoiceConversation;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  disabled?: boolean;
}

/** Composer toolbar: the voice-mode toggle and the voice settings button. */
export default function VoiceControls({ voice, settingsOpen, onToggleSettings, disabled }: VoiceControlsProps) {
  const on = voice.active;
  return (
    <span className={s.controls}>
      <button
        type="button"
        onClick={voice.toggle}
        className={`${s.modeBtn} ${on ? s.modeBtnOn : ''}`}
        aria-pressed={on}
        aria-label="Voice mode"
        title={on ? 'Turn voice mode off' : 'Voice mode: talk with the agent hands-free, even while it works'}
        disabled={disabled}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14} aria-hidden="true">
          <path d="M3 14v-2a9 9 0 0118 0v2" />
          <path d="M21 15a2 2 0 01-2 2h-1v-6h1a2 2 0 012 2zM3 15a2 2 0 002 2h1v-6H5a2 2 0 00-2 2z" />
        </svg>
        <span className={s.modeLabel}>Voice</span>
      </button>
      <button
        type="button"
        onClick={onToggleSettings}
        className={`${s.iconBtn} ${settingsOpen ? s.iconBtnOn : ''}`}
        aria-label="Voice settings"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        title="Voice settings"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13} aria-hidden="true">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
      </button>
    </span>
  );
}
