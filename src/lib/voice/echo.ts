// Without headphones the microphone hears the agent's own voice. These
// helpers recognise a transcript that is just the TTS output coming back.

import { isCommandOrReply, normalizeUtterance } from './intents';

const words = (text: string) => normalizeUtterance(text).split(' ').filter(Boolean);

/** Something the agent said: when it started and stopped (null while playing). */
export interface SpokenRecord {
  text: string;
  start: number;
  end: number | null;
}

/** How long after the voice stops the recognizer may still hand its words back. */
export const ECHO_TAIL_MS = 2_500;
// Loose word overlap only counts for speech that began while the voice played
// (plus recognizer latency); later speech that merely reuses its words is the user's
const OVERLAP_SLACK_MS = 1_000;

export interface HeardTiming {
  /** When the user's speech segment began (its first partial transcript) */
  heardStart: number;
  now: number;
}

/**
 * True when `transcript` looks like a re-hearing of something the agent said
 * during, or just before, the user's speech segment: its words appear in
 * order inside a spoken text (whatever its length, so "Done." cannot start a
 * new turn), or, for speech that overlapped playback, nearly all of them
 * occur in it. Commands and bare replies ("stop", "yes", "do that") are
 * never treated as echo.
 */
export function isLikelyEcho(transcript: string, spoken: readonly SpokenRecord[], timing: HeardTiming): boolean {
  const heard = words(transcript);
  if (!heard.length || isCommandOrReply(transcript)) return false;
  const phrase = ` ${heard.join(' ')} `;
  for (const record of spoken) {
    const end = record.end ?? timing.now;
    if (record.start > timing.now || timing.heardStart > end + ECHO_TAIL_MS) continue;
    const said = words(record.text);
    if (!said.length) continue;
    if (` ${said.join(' ')} `.includes(phrase)) return true;
    if (heard.length >= 3 && timing.heardStart <= end + OVERLAP_SLACK_MS) {
      const vocab = new Set(said);
      const overlap = heard.filter((w) => vocab.has(w)).length;
      if (overlap / heard.length >= 0.8) return true;
    }
  }
  return false;
}

/**
 * While the agent is talking, decide whether the user's interim speech is a
 * real interruption (barge-in) rather than the speakers bleeding into the mic.
 */
export function isBargeIn(interim: string, speakingText: string | null): boolean {
  const heard = words(interim);
  if (!heard.length) return false;
  if (!speakingText) return true;
  const vocab = new Set(words(speakingText));
  const novel = heard.filter((w) => !vocab.has(w)).length;
  // One unfamiliar word can be a mishearing; two or more is the user talking
  return novel >= 2 || (heard.length <= 2 && novel >= 1);
}
