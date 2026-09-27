'use client';

import s from './voice.module.css';

interface SpeakButtonProps {
  /** This message is being read right now */
  active: boolean;
  onClick: () => void;
}

/**
 * Small "read aloud" button shown under assistant messages. Its name changes
 * with its action (so no aria-pressed) and always starts with the visible
 * label, so "click Listen" / "click Stop" work with voice control.
 */
export default function SpeakButton({ active, onClick }: SpeakButtonProps) {
  const label = active ? 'Stop reading aloud' : 'Listen to this reply';
  return (
    <button
      type="button"
      className={`${s.speakBtn} ${active ? s.speakBtnOn : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {active ? (
        <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13} aria-hidden="true">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" />
        </svg>
      )}
      <span>{active ? 'Stop' : 'Listen'}</span>
    </button>
  );
}
