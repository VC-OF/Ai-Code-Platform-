import { describe, expect, it } from 'vitest';
import {
  classifyUtterance,
  cleanSpokenText,
  isSilenceCommand,
  isStopCommand,
  matchOption,
  normalizeUtterance,
  type IntentContext,
} from '@/lib/voice/intents';
import { isBargeIn, isLikelyEcho, type SpokenRecord } from '@/lib/voice/echo';

const running: IntentContext = { running: true };
const idle: IntentContext = { running: false };

describe('normalizeUtterance', () => {
  it('lowercases, drops punctuation and apostrophes, collapses spaces', () => {
    expect(normalizeUtterance("  Don't   STOP, please!! ")).toBe('dont stop please');
  });

  it('keeps non-Latin letters and digits', () => {
    expect(normalizeUtterance('Añade un botón 2')).toBe('añade un botón 2');
    expect(normalizeUtterance('添加测试')).toBe('添加测试');
  });
});

describe('classifyUtterance: stop', () => {
  it.each(['stop', 'Stop.', 'STOP!', 'stop it', 'stop that', 'cancel', 'cancel that', 'abort', 'halt', 'stop stop stop'])(
    '"%s" stops a running agent',
    (text) => {
      expect(classifyUtterance(text, running)).toEqual({ kind: 'stop' });
    }
  );

  it.each(['please stop', 'stop please', 'okay stop it now', 'wait, stop', 'no no stop', 'can you stop', 'stop right now', 'stop the agent'])(
    'tolerates politeness around a stop: "%s"',
    (text) => {
      expect(classifyUtterance(text, running)).toEqual({ kind: 'stop' });
    }
  );

  it('is conservative: sentences that start with "stop" steer the agent', () => {
    expect(classifyUtterance('stop using lodash', running)).toEqual({ kind: 'steer', text: 'stop using lodash' });
    expect(classifyUtterance("don't stop", running)).toEqual({ kind: 'steer', text: "don't stop" });
    expect(classifyUtterance('cancel the subscription feature and use a toggle', running).kind).toBe('steer');
    expect(classifyUtterance('stop adding comments everywhere', running).kind).toBe('steer');
  });

  it('means "stop talking" when nothing is running', () => {
    expect(classifyUtterance('stop', idle)).toEqual({ kind: 'silence' });
  });

  it('still stops while a question is pending', () => {
    expect(classifyUtterance('cancel', { running: true, pendingQuestion: 'Which one?', options: ['A', 'B'] })).toEqual({ kind: 'stop' });
  });

  it('isStopCommand mirrors the classifier', () => {
    expect(isStopCommand('Abort it!')).toBe(true);
    expect(isStopCommand('stop using lodash')).toBe(false);
  });
});

describe('classifyUtterance: silence', () => {
  it.each(['be quiet', 'Stop talking', 'shut up', 'mute', 'Quiet please', 'okay be quiet', 'stop speaking', 'shh', 'hush'])(
    '"%s" silences the voice',
    (text) => {
      expect(classifyUtterance(text, running)).toEqual({ kind: 'silence' });
      expect(classifyUtterance(text, idle)).toEqual({ kind: 'silence' });
    }
  );

  it('does not treat longer requests as silence', () => {
    expect(classifyUtterance('stop talking about tests and fix the bug', running).kind).toBe('steer');
    expect(isSilenceCommand('mute the video player by default')).toBe(false);
  });
});

describe('classifyUtterance: answers', () => {
  const question = (options?: string[]): IntentContext => ({ running: true, pendingQuestion: 'Which test runner?', options });

  it('passes free text through when there are no options', () => {
    expect(classifyUtterance('Use port 4000 instead', question())).toEqual({ kind: 'answer', answer: 'Use port 4000 instead' });
  });

  it('maps ordinals and option numbers to the option text', () => {
    const q = question(['Jest', 'Vitest', 'Mocha']);
    expect(classifyUtterance('the first one', q)).toEqual({ kind: 'answer', answer: 'Jest' });
    expect(classifyUtterance('second', q)).toEqual({ kind: 'answer', answer: 'Vitest' });
    expect(classifyUtterance('option two', q)).toEqual({ kind: 'answer', answer: 'Vitest' });
    expect(classifyUtterance('Option 3', q)).toEqual({ kind: 'answer', answer: 'Mocha' });
    expect(classifyUtterance("let's go with the third", q)).toEqual({ kind: 'answer', answer: 'Mocha' });
    expect(classifyUtterance('number one please', q)).toEqual({ kind: 'answer', answer: 'Jest' });
    expect(classifyUtterance('the last one', q)).toEqual({ kind: 'answer', answer: 'Mocha' });
    expect(classifyUtterance('two', q)).toEqual({ kind: 'answer', answer: 'Vitest' });
  });

  it('accepts common mishearings of numbers after "option"', () => {
    expect(classifyUtterance('option to', question(['Jest', 'Vitest']))).toEqual({ kind: 'answer', answer: 'Vitest' });
  });

  it('ignores out-of-range numbers', () => {
    expect(classifyUtterance('option five', question(['Jest', 'Vitest']))).toEqual({ kind: 'answer', answer: 'option five' });
  });

  it('maps yes/no to the matching option', () => {
    const q = question(['Yes, apply the fix', 'No, show me the diff first']);
    expect(classifyUtterance('yes', q)).toEqual({ kind: 'answer', answer: 'Yes, apply the fix' });
    expect(classifyUtterance('yes do that', q)).toEqual({ kind: 'answer', answer: 'Yes, apply the fix' });
    expect(classifyUtterance('go ahead', q)).toEqual({ kind: 'answer', answer: 'Yes, apply the fix' });
    expect(classifyUtterance('nope', q)).toEqual({ kind: 'answer', answer: 'No, show me the diff first' });
  });

  it('maps yes to the non-negative option of a pair', () => {
    const q = question(['Apply the migration', 'Cancel']);
    expect(classifyUtterance('yeah', q)).toEqual({ kind: 'answer', answer: 'Apply the migration' });
    expect(classifyUtterance('no', q)).toEqual({ kind: 'answer', answer: 'Cancel' });
  });

  it('keeps a bare yes when no option clearly means yes', () => {
    expect(classifyUtterance('yes', question(['Jest', 'Vitest']))).toEqual({ kind: 'answer', answer: 'yes' });
  });

  it('matches an option by name', () => {
    const q = question(['Use Jest', 'Use Vitest']);
    expect(classifyUtterance('vitest', q)).toEqual({ kind: 'answer', answer: 'Use Vitest' });
    expect(classifyUtterance('Use Jest please', q)).toEqual({ kind: 'answer', answer: 'Use Jest' });
  });

  it('keeps the spoken answer when the match is ambiguous', () => {
    const q = question(['Use Jest', 'Use Vitest']);
    expect(classifyUtterance('use whatever is faster', q)).toEqual({ kind: 'answer', answer: 'use whatever is faster' });
  });

  it('strips leading hesitation from answers', () => {
    expect(classifyUtterance('um, port 4000', question())).toEqual({ kind: 'answer', answer: 'port 4000' });
  });

  it('does not send thanks or "hang on" as the answer', () => {
    for (const text of ['thanks', 'Okay, thanks!', 'thank you', 'got it', 'hang on', 'let me think', 'never mind']) {
      expect(classifyUtterance(text, question())).toEqual({ kind: 'ignore' });
      expect(classifyUtterance(text, question(['Jest', 'Vitest']))).toEqual({ kind: 'ignore' });
    }
    // Approval words still answer, and an option named like a pleasantry wins
    expect(classifyUtterance('perfect', question())).toEqual({ kind: 'answer', answer: 'perfect' });
    expect(classifyUtterance('thanks', question(['Thanks', 'No thanks']))).toEqual({ kind: 'answer', answer: 'Thanks' });
    expect(classifyUtterance('done', question())).toEqual({ kind: 'answer', answer: 'done' });
  });
});

describe('classifyUtterance: steer, prompt and ignore', () => {
  it('steers a running agent', () => {
    expect(classifyUtterance('also add tests', running)).toEqual({ kind: 'steer', text: 'also add tests' });
    expect(classifyUtterance('yes do that', running)).toEqual({ kind: 'steer', text: 'yes do that' });
  });

  it('starts a new turn when idle', () => {
    expect(classifyUtterance('Add a dark mode toggle to the header', idle)).toEqual({
      kind: 'prompt',
      text: 'Add a dark mode toggle to the header',
    });
  });

  it('ignores empty input and filler', () => {
    for (const text of ['', '   ', 'um', 'uh...', 'Hmm', 'um uh', '...']) {
      expect(classifyUtterance(text, running)).toEqual({ kind: 'ignore' });
      expect(classifyUtterance(text, idle)).toEqual({ kind: 'ignore' });
    }
  });

  it('ignores acknowledgements unless the agent just asked something', () => {
    for (const text of ['okay', 'thanks', 'thank you', 'cool', 'got it', 'yes', 'no thanks']) {
      expect(classifyUtterance(text, running)).toEqual({ kind: 'ignore' });
      expect(classifyUtterance(text, idle)).toEqual({ kind: 'ignore' });
    }
    expect(classifyUtterance('yes', { running: false, expectsReply: true })).toEqual({ kind: 'prompt', text: 'yes' });
    expect(classifyUtterance('no thanks', { running: false, expectsReply: true })).toEqual({ kind: 'prompt', text: 'no thanks' });
    expect(classifyUtterance('thank you', { running: false, expectsReply: true })).toEqual({ kind: 'ignore' });
  });

  it("ignores the narrator's own fixed lines, so they cannot start a turn", () => {
    for (const text of ['Done.', 'done', 'Stopped.', 'Tests passed.', 'Got it.', 'Lint is clean.']) {
      expect(classifyUtterance(text, idle)).toEqual({ kind: 'ignore' });
      expect(classifyUtterance(text, { running: false, expectsReply: true })).toEqual({ kind: 'ignore' });
      expect(classifyUtterance(text, running)).toEqual({ kind: 'ignore' });
    }
    expect(classifyUtterance("I'm done, add a footer", idle).kind).toBe('prompt');
  });

  it('removes leading hesitation from steering and prompts', () => {
    expect(classifyUtterance('um, uh, add a README', idle)).toEqual({ kind: 'prompt', text: 'add a README' });
    expect(cleanSpokenText('Uhm... so fix it')).toBe('so fix it');
  });
});

describe('matchOption', () => {
  it('returns null without options or input', () => {
    expect(matchOption('first', [])).toBeNull();
    expect(matchOption('', ['A'])).toBeNull();
  });

  it('prefers an exact (normalized) match', () => {
    expect(matchOption('Tabs.', ['Tabs', 'Spaces'])).toBe('Tabs');
  });

  it('prefers the longest contained option', () => {
    expect(matchOption('use 2 spaces', ['Tabs', '2 spaces', '4 spaces'])).toBe('2 spaces');
  });
});

describe('echo detection', () => {
  const NOW = 100_000;
  /** Spoken `endedAgo` ms before NOW (null: still playing). */
  const said = (text: string, endedAgo: number | null = null): SpokenRecord => ({
    text,
    start: NOW - 5_000,
    end: endedAgo === null ? null : NOW - endedAgo,
  });
  /** The user's speech segment began `ago` ms before NOW. */
  const heard = (ago = 0) => ({ heardStart: NOW - ago, now: NOW });
  const playing = [said('Now: adding tests for the parser.'), said('Running npm test')];

  it('recognises the agent hearing itself', () => {
    expect(isLikelyEcho('adding tests for the parser', playing, heard(1_000))).toBe(true);
    expect(isLikelyEcho('now adding tests for parser', playing, heard(1_000))).toBe(true);
  });

  it('lets real speech through', () => {
    expect(isLikelyEcho('also add tests for the lexer please', playing, heard())).toBe(false);
    expect(isLikelyEcho('stop', playing, heard())).toBe(false);
    expect(isLikelyEcho('what is happening', [], heard())).toBe(false);
  });

  it('never treats commands and short replies as echo, even when they repeat the agent', () => {
    expect(isLikelyEcho('do that', [said('Want me to do that?')], heard())).toBe(false);
    expect(isLikelyEcho('yes', [said('yes')], heard())).toBe(false);
    expect(isLikelyEcho('stop', [said('Stop.', 200)], heard())).toBe(false);
    expect(isLikelyEcho('be quiet', [said('Be quiet.')], heard())).toBe(false);
  });

  it("catches the narrator's one-word lines coming back, whatever their length", () => {
    expect(isLikelyEcho('done', [said('Done.', 400)], heard(300))).toBe(true);
    expect(isLikelyEcho('Stopped', [said('Stopped.', 800)], heard(700))).toBe(true);
    expect(isLikelyEcho('tests passed', [said('Tests passed.')], heard(100))).toBe(true);
    expect(isLikelyEcho('changed', [said('Done. I changed App.tsx.', 500)], heard(200))).toBe(true);
  });

  it('only looks at speech that overlaps playback or its short tail', () => {
    const planStep = [said('Now: Add tests for the parser.', 20_000)];
    // The user repeating the plan step 20 s later is a real instruction
    expect(isLikelyEcho('add tests for the parser', planStep, heard())).toBe(false);
    expect(isLikelyEcho('yes add tests for the parser', planStep, heard())).toBe(false);
    // …while the same words right after the voice stopped are its echo
    expect(isLikelyEcho('add tests for the parser', [said('Now: Add tests for the parser.', 1_500)], heard(1_200))).toBe(true);
    expect(isLikelyEcho('done', [said('Done.', 4_000)], heard(500))).toBe(false);
  });

  it('uses loose word overlap only for speech that began during playback', () => {
    const justEnded = [said('Now: adding tests for the parser.', 3_000)];
    // Began 2.5 s after the voice stopped: reordered words are the user's
    expect(isLikelyEcho('the parser needs tests now', justEnded, heard(500))).toBe(false);
    // Began while the voice was still playing
    expect(isLikelyEcho('the parser needs tests now', justEnded, heard(3_200))).toBe(true);
  });

  it('barges in only on words the voice is not saying', () => {
    expect(isBargeIn('stop', 'Running the tests now')).toBe(true);
    expect(isBargeIn('running the', 'Running the tests now')).toBe(false);
    expect(isBargeIn('wait use vitest', 'Running the tests now')).toBe(true);
    expect(isBargeIn('', 'Anything')).toBe(false);
    expect(isBargeIn('hello', null)).toBe(true);
  });
});
