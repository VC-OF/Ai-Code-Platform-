'use client';

import s from './voice.module.css';
import type { HeardUtterance, VoiceConversation, VoicePhase } from './useVoiceConversation';

const PHASE_LABEL: Record<VoicePhase, string> = {
  off: '',
  listening: 'Listening',
  speaking: 'Speaking',
  thinking: 'Thinking',
  unsupported: 'Voice input unavailable',
  error: 'Microphone off',
};

const DOT_CLASS: Record<VoicePhase, string> = {
  off: '',
  listening: s.dotListening,
  speaking: s.dotSpeaking,
  thinking: s.dotThinking,
  unsupported: s.dotUnsupported,
  error: s.dotError,
};

const HEARD_LABEL: Record<Exclude<HeardUtterance['kind'], 'ignore'>, string> = {
  stop: 'Stopping the agent',
  silence: 'Quiet',
  answer: 'Answered',
  steer: 'Sent to the agent',
  prompt: 'New request',
};

function hintFor(voice: VoiceConversation): string {
  switch (voice.phase) {
    case 'speaking':
      return voice.settings.bargeIn ? 'Talk to interrupt.' : 'The mic reopens when I finish.';
    case 'thinking':
      return 'Working. Talk to steer, or say "stop".';
    case 'unsupported':
      return 'Voice input needs Chrome or Edge. Replies are still read aloud.';
    case 'error':
      return voice.listening.error ?? 'The microphone is not available.';
    default:
      return 'Say what to build, or ask a question.';
  }
}

/** Live voice-mode state above the composer: phase, what was heard, errors. */
export default function VoiceStatusBar({ voice }: { voice: VoiceConversation }) {
  if (!voice.active) return null;
  const { phase, heard, speech, listening } = voice;
  const interim = listening.interim;
  const showHeard = !interim && heard && heard.kind !== 'ignore';
  // Recoverable recognizer notices ("Retrying…") while the mic is still open
  const micNotice = phase !== 'error' && listening.error ? listening.error : null;

  return (
    <>
      <div className={s.statusBar} role="group" aria-label="Voice mode">
        <span className={`${s.dot} ${DOT_CLASS[phase]}`} aria-hidden="true" />
        <span className={s.phaseLabel} aria-live="polite">
          {PHASE_LABEL[phase]}
        </span>
        <span className={s.transcript} title={interim || heard?.text || undefined}>
          {interim ? (
            <span className={s.interim}>{interim}</span>
          ) : showHeard ? (
            <>
              <span className={s.heardKind}>{HEARD_LABEL[heard.kind as keyof typeof HEARD_LABEL]}: </span>
              <span>“{heard.text}”</span>
            </>
          ) : (
            <span className={s.hint}>{hintFor(voice)}</span>
          )}
        </span>
        {phase === 'speaking' && (
          <button type="button" className={s.barBtn} onClick={speech.cancel}>
            Stop speaking
          </button>
        )}
      </div>
      {micNotice && (
        <div className={`${s.notice} ${s.noticeWarning}`} role="status">
          <span className={s.noticeText}>{micNotice}</span>
        </div>
      )}
      {voice.problem && (
        <div className={`${s.notice} ${s.noticeError}`} role="alert">
          <span className={s.noticeText}>{voice.problem}</span>
          <button type="button" className={s.dismiss} onClick={voice.clearProblem} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {speech.error && (
        <div className={`${s.notice} ${s.noticeError}`} role="alert">
          <span className={s.noticeText}>{speech.error}</span>
          <button type="button" className={s.dismiss} onClick={speech.clearError} aria-label="Dismiss voice error">
            ×
          </button>
        </div>
      )}
    </>
  );
}
