// Voice-mode turn taking: routes what the user says (stop, be quiet, answer,
// steer, new request) and paces what the agent says so narration does not
// talk over the user. Framework-free: useVoiceConversation wires it to React
// state, the speech engine and ChatPanel's actions.

import { Narrator, type NarrationEvent, type NarrationLevel, type Utterance } from './narration';
import { classifyUtterance, type UtteranceIntent } from './intents';
import { isBargeIn, isLikelyEcho, type SpokenRecord } from './echo';
import type { SpeechPriority } from './speechQueue';

/** What became of a steering message: the run took it, no run was there to take it, or the request failed. */
export type SteerOutcome = 'delivered' | 'no-run' | 'failed';

export interface HeardUtterance {
  text: string;
  kind: UtteranceIntent['kind'];
}

export interface ConversationSpeech {
  speak(text: string, opts?: { priority?: SpeechPriority }): void;
  cancel(): void;
  isSpeaking(): boolean;
  recentSpoken(): SpokenRecord[];
  currentText(): string | null;
}

/** Read on every call, so it reflects the latest render. */
export interface ConversationEnv {
  speech: ConversationSpeech;
  /** An agent turn is streaming */
  running: boolean;
  pendingQuestion: { question: string; options?: string[] } | null;
  /** The mic stays open while the agent speaks */
  bargeIn: boolean;
  /** Cancel the running turn; resolve false when the request failed */
  onStop: () => Promise<boolean | void> | boolean | void;
  onAnswer: (answer: string) => void;
  onSteer: (text: string) => Promise<SteerOutcome> | SteerOutcome;
  onPrompt: (text: string) => void;
  onHeard: (heard: HeardUtterance) => void;
  /** A spoken command could not be carried out (null clears the last one) */
  onProblem: (message: string | null) => void;
}

/**
 * What to narrate: the chosen level in voice mode; replies and questions in
 * read-aloud mode (the run waits on a question, so it is never skipped);
 * otherwise nothing.
 */
export function narrationLevel(voiceMode: boolean, settings: { level: NarrationLevel; readReplies: boolean }): NarrationLevel | null {
  if (voiceMode) return settings.level;
  return settings.readReplies ? 'replies+questions' : null;
}

/** After the last partial transcript (or a final one), how long the user counts as still talking. */
export const USER_TALKING_GRACE_MS = 1_200;
// Deferred progress older than this is no longer worth saying
const DEFERRED_PROGRESS_MAX_AGE_MS = 6_000;
// Partial transcripts further apart than this belong to different speech segments
const SEGMENT_GAP_MS = 3_000;

export class ConversationController {
  private narrator = new Narrator();
  // The stream reported `done` (the request may still be closing)
  private turnDone = false;
  // The last reply ended with a question, so a bare "yes" is an answer
  private expectsReply = false;
  // Narration waits while the user is mid-sentence (speaking would close the mic)
  private userTalkingUntil = 0;
  private deferred: (Utterance & { at: number })[] = [];
  private segmentStart: number | null = null;
  private lastInterimAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly env: () => ConversationEnv) {}

  /** Feed every processed stream event; `level` null tracks state without speaking. */
  narrate(event: NarrationEvent, level: NarrationLevel | null, now = Date.now()): void {
    if (event.type === 'done') this.turnDone = true;
    if (event.type === 'text_done') this.expectsReply = /\?\s*$/.test(String(event.content ?? '').trim());
    if (!level) return;
    this.narrator.setLevel(level);
    this.say(this.narrator.handle(event, now), now);
  }

  /** A stream starts; `replay` skips the history a reconnect replays. */
  beginTurn(opts: { replay?: boolean } = {}, now = Date.now()): void {
    this.turnDone = false;
    this.narrator.reset();
    this.narrator.setIgnoreBefore(opts.replay ? now - 2_000 : 0);
  }

  /** Voice mode turned off: forget held speech and the user's talking state. */
  reset(): void {
    this.narrator.reset();
    this.deferred = [];
    this.userTalkingUntil = 0;
    this.segmentStart = null;
  }

  /** Call every few hundred ms: releases held speech once the user is quiet. */
  tick(now = Date.now()): void {
    if (this.deferred.length && now >= this.userTalkingUntil) {
      // Like the speech queue: only the newest, still-fresh progress line is worth saying
      const progress = this.deferred.filter((u) => u.priority === 'low' && now - u.at <= DEFERRED_PROGRESS_MAX_AGE_MS).pop();
      const ready = this.deferred.filter((u) => u.priority !== 'low' || u === progress);
      this.deferred = [];
      this.say(ready, now);
    }
    this.say(this.narrator.tick(now), now);
  }

  handleInterim(interim: string, now = Date.now()): void {
    if (this.segmentStart === null || now - this.lastInterimAt > SEGMENT_GAP_MS) this.segmentStart = now;
    this.lastInterimAt = now;
    const { speech, bargeIn } = this.env();
    if (speech.isSpeaking()) {
      // With headphones the user can cut the agent off; otherwise this is our own echo
      if (bargeIn && isBargeIn(interim, speech.currentText())) {
        speech.cancel();
        this.userTalkingUntil = now + USER_TALKING_GRACE_MS;
      }
      return;
    }
    this.userTalkingUntil = now + USER_TALKING_GRACE_MS;
  }

  handleFinal(text: string, now = Date.now()): void {
    const heardStart = this.segmentStart !== null && now - this.lastInterimAt <= SEGMENT_GAP_MS ? this.segmentStart : now;
    this.segmentStart = null;
    const env = this.env();
    // Only an open mic during speech (barge-in) can pick up the agent's own voice
    if (env.bargeIn && isLikelyEcho(text, env.speech.recentSpoken(), { heardStart, now })) {
      this.userTalkingUntil = 0;
      return;
    }
    // Recognizers finalize at short pauses: the user may go on ("…and update the readme")
    this.userTalkingUntil = now + USER_TALKING_GRACE_MS;

    const pending = env.pendingQuestion;
    const intent = classifyUtterance(text, {
      running: env.running && !this.turnDone,
      pendingQuestion: pending ? pending.question || true : null,
      options: pending?.options,
      expectsReply: this.expectsReply,
    });
    env.onHeard({ text, kind: intent.kind });
    if (intent.kind === 'ignore') return;
    env.onProblem(null);

    switch (intent.kind) {
      case 'silence':
        this.hush();
        return;
      case 'stop':
        this.hush();
        void Promise.resolve(env.onStop()).then((stopped) => {
          if (stopped === false) {
            this.fail('Could not stop the agent. Say "stop" again, or use the stop button.', "I couldn't stop the agent.", 'high');
          }
        });
        return;
      case 'answer':
        this.hush();
        env.onAnswer(intent.answer);
        return;
      case 'steer':
        void Promise.resolve(env.onSteer(intent.text)).then((outcome) => {
          if (outcome === 'delivered') {
            // Held back like narration, so it cannot cut off the user's next sentence
            this.say([{ text: 'Got it.', priority: 'low', kind: 'progress' }]);
          } else if (outcome === 'no-run') {
            // The run finished while the user was talking: make it the next request
            this.env().onPrompt(intent.text);
          } else {
            this.fail(`Could not send "${intent.text}" to the agent. Say it again, or type it.`, "I couldn't send that to the agent.", 'normal');
          }
        });
        return;
      case 'prompt':
        this.expectsReply = false;
        this.hush();
        env.onPrompt(intent.text);
        return;
    }
  }

  /** Stop talking now and drop whatever was held back to say later. */
  private hush(): void {
    this.env().speech.cancel();
    this.deferred = [];
    this.narrator.dropPending();
  }

  private fail(message: string, spoken: string, priority: SpeechPriority): void {
    this.env().onProblem(message);
    this.say([{ text: spoken, priority, kind: 'error' }]);
  }

  private say(utterances: Utterance[], now = Date.now()): void {
    for (const u of utterances) {
      if (u.priority !== 'high' && now < this.userTalkingUntil) this.deferred.push({ ...u, at: now });
      else this.env().speech.speak(u.text, { priority: u.priority });
    }
  }
}
