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

const UNSUPPORTED_MESSAGE = 'Voice input needs Chrome or Edge. Replies are still read aloud.';
const MIC_UNAVAILABLE_MESSAGE = 'The microphone is not available.';

function hintFor(voice: VoiceConversation): string {
  switch (voice.phase) {
    case 'speaking':
      return voice.settings.bargeIn ? 'Talk to interrupt.' : 'The mic reopens when I finish.';
    case 'thinking':
      return 'Working. Talk to steer, or say "stop".';
    default:
      return 'Say what to build, or ask a question.';
  }
}

/** A failed read-aloud or narration: shown with or without voice mode. */
function SpeechError({ speech }: { speech: VoiceConversation['speech'] }) {
  if (!speech.error) return null;
  return (
    <div className={`${s.notice} ${s.noticeError}`} role="alert">
      <span className={s.noticeText}>{speech.error}</span>
      <button type="button" className={s.dismiss} onClick={speech.clearError} aria-label="Dismiss voice error">
        ×
      </button>
    </div>
  );
}

/**
 * Live voice-mode state above the composer: phase, what was heard, errors.
 * With voice mode off it still reports read-aloud errors ("Listen", "read
 * replies"), which would otherwise fail silently.
 */
export default function VoiceStatusBar({ voice }: { voice: VoiceConversation }) {
  const { phase, heard, speech, listening } = voice;
  if (!voice.active) return <SpeechError speech={speech} />;
  const interim = listening.interim;
  // Why the microphone is not listening gets its own wrapping, announced row
  const micDown = phase === 'error' || phase === 'unsupported';
  const showHeard = !micDown && !interim && heard && heard.kind !== 'ignore';
  // Recoverable recognizer notices ("Retrying…") while the mic is still open
  const micNotice = !micDown && listening.error ? listening.error : null;

  return (
    <>
      <div className={s.statusBar} role="group" aria-label="Voice mode">
        <span className={`${s.dot} ${DOT_CLASS[phase]}`} aria-hidden="true" />
        <span className={s.phaseLabel} aria-live="polite">
          {PHASE_LABEL[phase]}
        </span>
        <span className={s.transcript} title={interim || (showHeard ? heard.text : undefined)}>
          {micDown ? null : interim ? (
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
      {phase === 'error' && (
        <div className={`${s.notice} ${s.noticeError}`} role="alert">
          <span className={s.noticeText}>{listening.error ?? MIC_UNAVAILABLE_MESSAGE}</span>
        </div>
      )}
      {phase === 'unsupported' && (
        <div className={`${s.notice} ${s.noticeWarning}`} role="status">
          <span className={s.noticeText}>{UNSUPPORTED_MESSAGE}</span>
        </div>
      )}
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
      <SpeechError speech={speech} />
    </>
  );
}
