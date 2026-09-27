import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationController,
  USER_TALKING_GRACE_MS,
  narrationLevel,
  type ConversationEnv,
  type HeardUtterance,
  type SteerOutcome,
} from '@/lib/voice/conversation';
import type { SpokenRecord } from '@/lib/voice/echo';
import type { SpeechPriority } from '@/lib/voice/speechQueue';

function fakeSpeech() {
  const speech = {
    said: [] as { text: string; priority?: SpeechPriority }[],
    cancels: 0,
    speaking: false,
    current: null as string | null,
    records: [] as SpokenRecord[],
    speak(text: string, opts?: { priority?: SpeechPriority }) {
      speech.said.push({ text, priority: opts?.priority });
    },
    cancel() {
      speech.cancels += 1;
      speech.speaking = false;
    },
    isSpeaking: () => speech.speaking,
    recentSpoken: () => speech.records,
    currentText: () => speech.current,
  };
  return speech;
}

function setup(initial: Partial<{ running: boolean; bargeIn: boolean; pendingQuestion: ConversationEnv['pendingQuestion'] }> = {}) {
  const speech = fakeSpeech();
  const state = {
    running: false,
    bargeIn: false,
    pendingQuestion: null as ConversationEnv['pendingQuestion'],
    stopResult: true,
    steerResult: 'delivered' as SteerOutcome,
    ...initial,
  };
  const calls = {
    stops: 0,
    answers: [] as string[],
    steers: [] as string[],
    prompts: [] as string[],
    heard: [] as HeardUtterance[],
    problems: [] as (string | null)[],
  };
  const controller = new ConversationController(() => ({
    speech,
    running: state.running,
    pendingQuestion: state.pendingQuestion,
    bargeIn: state.bargeIn,
    onStop: async () => {
      calls.stops += 1;
      return state.stopResult;
    },
    onAnswer: (answer) => calls.answers.push(answer),
    onSteer: async (text) => {
      calls.steers.push(text);
      return state.steerResult;
    },
    onPrompt: (text) => calls.prompts.push(text),
    onHeard: (heard) => calls.heard.push(heard),
    onProblem: (message) => calls.problems.push(message),
  }));
  const said = () => speech.said.map((s) => s.text);
  return { controller, speech, state, calls, said };
}

const advance = (ms: number) => vi.advanceTimersByTime(ms);
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConversationController: echo of the agent itself (barge-in on)', () => {
  it('does not start a new turn from its own "Done."', () => {
    const { controller, speech, calls, said } = setup({ bargeIn: true });
    controller.beginTurn();
    controller.narrate({ type: 'done', reason: 'completed' }, 'everything');
    expect(said()).toEqual(['Done.']);
    // The engine played it for half a second; the open mic hands it back
    speech.records = [{ text: 'Done.', start: Date.now(), end: Date.now() + 500 }];
    advance(700);
    controller.handleInterim('done');
    advance(400);
    controller.handleFinal('done');
    expect(calls.prompts).toEqual([]);
    expect(calls.heard).toEqual([]);
  });

  it('ignores the narrator lines even when the echo window has passed', () => {
    const { controller, calls } = setup({ bargeIn: true });
    controller.narrate({ type: 'done', reason: 'user_cancelled' }, 'everything');
    advance(10_000);
    controller.handleFinal('Stopped.');
    controller.handleFinal('Done.');
    expect(calls.prompts).toEqual([]);
    expect(calls.heard.map((h) => h.kind)).toEqual(['ignore', 'ignore']);
  });

  it('lets the user repeat what the agent said a while ago', () => {
    const { controller, speech, calls } = setup({ bargeIn: true, running: true });
    speech.records = [{ text: 'Now: Add tests for the parser.', start: Date.now(), end: Date.now() + 2_000 }];
    advance(20_000);
    controller.handleInterim('add tests');
    controller.handleFinal('add tests for the parser');
    expect(calls.steers).toEqual(['add tests for the parser']);
  });
});

describe('ConversationController: be quiet and stop', () => {
  /** Narration that arrives while the user is saying something. */
  function heldBack(c: ReturnType<typeof setup>) {
    c.state.running = true;
    c.controller.beginTurn();
    c.controller.handleInterim('be');
    c.controller.narrate({ type: 'plan_update', tasks: [{ title: 'Write tests', status: 'in_progress' }] }, 'everything');
    c.controller.narrate({ type: 'text_done', content: 'Here is what I found.' }, 'everything');
    expect(c.said()).toEqual([]);
  }

  it('control: held-back speech plays once the user stops talking', async () => {
    const c = setup();
    heldBack(c);
    advance(300);
    c.controller.handleFinal('also check the lexer');
    await flush();
    advance(USER_TALKING_GRACE_MS + 100);
    c.controller.tick();
    expect(c.said()).toEqual(expect.arrayContaining(['Here is what I found.']));
  });

  it('"be quiet" drops speech held back while it was being said', () => {
    const c = setup();
    heldBack(c);
    advance(300);
    c.controller.handleFinal('be quiet');
    expect(c.speech.cancels).toBe(1);
    for (let i = 0; i < 40; i++) {
      advance(300);
      c.controller.tick();
    }
    expect(c.said()).toEqual([]);
  });

  it('"stop" drops held-back speech and cancels the run', async () => {
    const c = setup();
    heldBack(c);
    advance(300);
    c.controller.handleFinal('stop');
    await flush();
    expect(c.calls.stops).toBe(1);
    for (let i = 0; i < 40; i++) {
      advance(300);
      c.controller.tick();
    }
    expect(c.said()).toEqual([]);
  });

  it('says so, right away, when the stop request fails', async () => {
    const c = setup({ running: true });
    c.state.stopResult = false;
    c.controller.handleFinal('stop');
    await flush();
    expect(c.speech.said).toEqual([{ text: "I couldn't stop the agent.", priority: 'high' }]);
    expect(c.calls.problems.at(-1)).toMatch(/Could not stop the agent/);
  });
});

describe('ConversationController: steering', () => {
  it('acknowledges only after the user has finished talking', async () => {
    const c = setup({ running: true });
    c.controller.handleInterim('also add tests');
    c.controller.handleFinal('also add tests');
    await flush();
    expect(c.calls.steers).toEqual(['also add tests']);
    // Speaking now would close the mic on the rest of the instruction
    expect(c.said()).toEqual([]);
    advance(800);
    c.controller.handleInterim('and update the');
    c.controller.tick();
    expect(c.said()).toEqual([]);
    advance(400);
    c.controller.handleFinal('and update the readme');
    await flush();
    expect(c.calls.steers).toEqual(['also add tests', 'and update the readme']);
    advance(USER_TALKING_GRACE_MS + 100);
    c.controller.tick();
    expect(c.said()).toEqual(['Got it.']);
  });

  it('turns a steer the run did not take into the next request', async () => {
    const c = setup({ running: true });
    c.state.steerResult = 'no-run';
    c.controller.handleFinal('add a footer');
    await flush();
    expect(c.calls.prompts).toEqual(['add a footer']);
    advance(5_000);
    c.controller.tick();
    expect(c.said()).toEqual([]);
  });

  it('reports a steer that could not be sent instead of queueing it', async () => {
    const c = setup({ running: true });
    c.state.steerResult = 'failed';
    c.controller.handleFinal('use vitest');
    await flush();
    expect(c.calls.prompts).toEqual([]);
    expect(c.calls.problems.at(-1)).toContain('Could not send "use vitest" to the agent');
    advance(USER_TALKING_GRACE_MS + 100);
    c.controller.tick();
    expect(c.said()).toEqual(["I couldn't send that to the agent."]);
  });

  it('clears an old problem when the next command is heard', async () => {
    const c = setup({ running: true });
    c.state.steerResult = 'failed';
    c.controller.handleFinal('use vitest');
    await flush();
    c.state.steerResult = 'delivered';
    c.controller.handleFinal('use vitest please');
    expect(c.calls.problems.at(-1)).toBeNull();
  });
});

describe('ConversationController: questions and turns', () => {
  it('does not answer a pending question with "thanks"', () => {
    const c = setup({ running: true, pendingQuestion: { question: 'Which runner?', options: ['Jest', 'Vitest'] } });
    c.controller.handleFinal('thanks');
    expect(c.calls.answers).toEqual([]);
    c.controller.handleFinal('the second one');
    expect(c.calls.answers).toEqual(['Vitest']);
  });

  it('treats speech after the done event as a new request, even when not narrating', () => {
    const c = setup({ running: true });
    c.controller.narrate({ type: 'done', reason: 'completed' }, null);
    expect(c.said()).toEqual([]);
    c.controller.handleFinal('add a footer');
    expect(c.calls.prompts).toEqual(['add a footer']);
    expect(c.calls.steers).toEqual([]);
  });

  it('reads questions in read-aloud mode, and nothing when both modes are off', () => {
    expect(narrationLevel(true, { level: 'replies', readReplies: true })).toBe('replies');
    expect(narrationLevel(true, { level: 'everything', readReplies: false })).toBe('everything');
    expect(narrationLevel(false, { level: 'everything', readReplies: true })).toBe('replies+questions');
    expect(narrationLevel(false, { level: 'everything', readReplies: false })).toBeNull();

    const c = setup({ running: true });
    c.controller.narrate({ type: 'user_input_request', question: 'Which port?' }, narrationLevel(false, { level: 'replies', readReplies: true }));
    expect(c.speech.said).toEqual([{ text: 'Which port?', priority: 'high' }]);
  });

  it('keeps only the newest progress line when releasing held speech', () => {
    const c = setup({ running: true });
    c.controller.handleInterim('hmm');
    c.controller.narrate({ type: 'plan_update', tasks: [{ title: 'One', status: 'in_progress' }] }, 'everything');
    c.controller.narrate({ type: 'plan_update', tasks: [{ title: 'Two', status: 'in_progress' }] }, 'everything');
    advance(USER_TALKING_GRACE_MS + 100);
    c.controller.tick();
    expect(c.said()).toEqual(['Now: Two.']);
  });
});
