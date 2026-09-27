// Classify what the user just said to a voice-mode chat: stop the run, stop
// talking, answer the agent's question, steer the running agent, or start a
// new turn. Deliberately conservative: only whole-utterance commands count,
// so "stop using lodash" steers the agent instead of cancelling it.

export type UtteranceIntent =
  | { kind: 'stop' }
  | { kind: 'silence' }
  | { kind: 'answer'; answer: string }
  | { kind: 'steer'; text: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'ignore' };

export interface IntentContext {
  /** An agent turn is running */
  running: boolean;
  /** The agent is waiting on ask_user (the question text, or just true) */
  pendingQuestion?: string | boolean | null;
  /** The question's suggested answers */
  options?: string[];
  /** The agent's last reply ended with a question, so "yes"/"okay" mean something */
  expectsReply?: boolean;
}

// Built at runtime: \p{…} needs an ES2018 regex target
const NON_WORD = new RegExp('[^\\p{L}\\p{N}\\s]+', 'gu');

/** Lowercase, drop apostrophes and punctuation, collapse whitespace. */
export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(NON_WORD, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FILLERS = new Set([
  'um', 'umm', 'ummm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'ahh', 'hmm', 'hm', 'hmmm',
  'mm', 'mmm', 'mhm', 'oh', 'eh', 'like', 'so', 'well', 'hey', 'huh',
]);

/** Pleasantries: never worth a new turn or a steer. */
const PLEASANTRIES = new Set([
  'thanks', 'thank you', 'thanks a lot', 'thank you very much', 'cool', 'great', 'nice',
  'awesome', 'perfect', 'got it', 'i see', 'okay thanks', 'ok thanks', 'okay thank you',
  'ok thank you', 'very good', 'good', 'wow', 'uh huh',
]);

/** Acknowledgements and "hang on"s: never the answer to a pending question. */
const NON_ANSWERS = new Set([
  'thanks', 'thank you', 'thanks a lot', 'thank you very much', 'okay thanks', 'ok thanks',
  'okay thank you', 'ok thank you', 'got it', 'i see', 'wow', 'never mind', 'nevermind',
  'hold on', 'hang on', 'wait', 'wait a second', 'wait a minute', 'one second', 'one sec',
  'one moment', 'just a second', 'just a sec', 'just a moment', 'give me a second',
  'give me a sec', 'give me a moment', 'let me think', 'let me see', 'let me check',
  'let me think about it',
]);

/**
 * The narrator's own fixed lines. With the mic open they can come back as a
 * transcript, and must never start a turn ("Done." → new turn → "Done." …).
 */
const NARRATOR_PHRASES = new Set([
  'done', 'stopped', 'got it', 'tests passed', 'some tests failed', 'lint is clean',
]);

/** Bare yes/no/okay: meaningful only when the agent just asked something. */
const BARE_REPLIES = new Set([
  'ok', 'okay', 'k', 'alright', 'all right', 'yes', 'yeah', 'yep', 'yup', 'sure', 'no', 'nope',
  'right', 'sounds good', 'fine',
]);

const LEADING_NOISE = new Set([
  'please', 'hey', 'ok', 'okay', 'oh', 'um', 'uh', 'so', 'just', 'now', 'no', 'wait', 'hold',
  'on', 'alright', 'right', 'well', 'can', 'you', 'could', 'would', 'will', 'agent',
]);
const TRAILING_NOISE = new Set(['please', 'now', 'thanks', 'thank', 'you', 'already', 'immediately', 'right']);

const STOP_PHRASES = new Set([
  'stop', 'stop it', 'stop that', 'stop this', 'stop everything', 'stop working', 'stop running',
  'stop the agent', 'stop the run', 'stop the task', 'cancel', 'cancel it', 'cancel that',
  'cancel this', 'cancel the run', 'cancel the task', 'cancel everything', 'abort', 'abort it',
  'abort that', 'abort the run', 'halt', 'emergency stop', 'kill it',
]);

const SILENCE_PHRASES = new Set([
  'be quiet', 'quiet', 'stop talking', 'stop speaking', 'stop reading', 'stop narrating',
  'shut up', 'shut it', 'mute', 'mute yourself', 'mute it', 'silence', 'hush', 'shh', 'shhh',
  'shush', 'enough talking', 'no more talking', 'dont talk', 'be silent', 'pipe down',
  'stop the voice', 'quiet down', 'stop reading that', 'stop reading this', 'stop your voice',
]);

const AFFIRMATIVE = new Set([
  'yes', 'yeah', 'yep', 'yup', 'ya', 'sure', 'ok', 'okay', 'alright', 'all right', 'correct',
  'right', 'affirmative', 'go ahead', 'go for it', 'do it', 'do that', 'yes do that', 'yes do it',
  'yes please', 'please do', 'sounds good', 'that works', 'lets do it', 'lets do that', 'proceed',
  'continue', 'approve', 'approved', 'fine', 'of course', 'absolutely', 'definitely', 'yes go ahead',
  'sure thing', 'why not', 'yeah do that', 'yeah go ahead', 'yes proceed', 'ok do it', 'okay do it',
  'ok go ahead', 'okay go ahead', 'yes thats right', 'thats right', 'exactly',
]);

const NEGATIVE = new Set([
  'no', 'nope', 'nah', 'no thanks', 'no thank you', 'dont', 'do not', 'dont do that', 'dont do it',
  'negative', 'no way', 'not now', 'skip', 'skip it', 'skip that', 'no dont', 'please dont',
  'definitely not', 'not really',
]);

const AFFIRMATIVE_OPTION = /^(yes|yeah|yep|sure|ok|okay|proceed|continue|go ahead|approve|accept|confirm|allow|do it|apply)\b/;
const NEGATIVE_OPTION = /^(no|nope|dont|do not|cancel|skip|stop|reject|deny|decline|abort|not now|leave it)\b/;

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5,
};
const CARDINALS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
// Recognizer mishearings of numbers, only trusted right after "option"/"number"
const SOUNDALIKES: Record<string, number> = { won: 1, to: 2, too: 2, tree: 3, for: 4, fore: 4 };

/** Words that frame a choice ("let's go with the second one") without naming it. */
const CHOICE_CARRIERS = new Set([
  'the', 'a', 'option', 'choice', 'number', 'item', 'lets', 'let', 'us', 'go', 'with', 'i', 'id',
  'choose', 'pick', 'take', 'want', 'select', 'use', 'do', 'like', 'please', 'prefer', 'ill',
  'will', 'we', 'should', 'answer', 'is', 'its', 'it', 'that', 'one', 'say', 'how', 'about',
  'for', 'my', 'would', 'be', 'yes', 'ok', 'okay',
]);

/** Words too generic to identify an option by overlap. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'with', 'use', 'using', 'go', 'i', 'we', 'it', 'its',
  'is', 'be', 'please', 'lets', 'let', 'do', 'that', 'this', 'one', 'for', 'in', 'on', 'want',
  'just', 'yes', 'no', 'ok', 'okay', 'option',
]);

const tokensOf = (n: string) => (n ? n.split(' ') : []);

function collapseRepeats(tokens: string[]): string[] {
  return tokens.filter((t, i) => i === 0 || t !== tokens[i - 1]);
}

/** Drop politeness and hesitation around a short command ("okay, stop it now please"). */
function coreCommand(normalized: string): string {
  let tokens = collapseRepeats(tokensOf(normalized));
  while (tokens.length > 1 && (LEADING_NOISE.has(tokens[0]) || FILLERS.has(tokens[0]))) tokens = tokens.slice(1);
  while (tokens.length > 1 && TRAILING_NOISE.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  return collapseRepeats(tokens).join(' ');
}

/** Remove leading hesitation sounds from what will be sent to the agent. */
export function cleanSpokenText(text: string): string {
  return text
    .replace(/^(?:\s*(?:u+m+|u+h+m*|e+r+m*|a+h+|h+m+|m+h*m+|oh|eh)\b[\s,.…-]*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberWord(token: string, allowSoundalike: boolean): number | null {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  if (token in ORDINALS) return ORDINALS[token];
  if (token in CARDINALS) return CARDINALS[token];
  if (allowSoundalike && token in SOUNDALIKES) return SOUNDALIKES[token];
  return null;
}

function optionIndexFromSpeech(normalized: string, count: number): number | null {
  const tokens = tokensOf(normalized);
  // "option two", "number 3", "choice one"
  for (let i = 0; i < tokens.length - 1; i++) {
    if (['option', 'number', 'choice', 'item'].includes(tokens[i])) {
      const n = numberWord(tokens[i + 1], true);
      if (n !== null) return n >= 1 && n <= count ? n - 1 : null;
    }
  }
  // "the second one", "first", "2", "the last one", "let's go with the third"
  const rest = tokens.filter((t, i) => {
    if (t === 'one' && i > 0 && (tokens[i - 1] in ORDINALS || tokens[i - 1] === 'last')) return false;
    return !CHOICE_CARRIERS.has(t) || (t === 'one' && tokens.length === 1);
  });
  if (rest.length !== 1) return null;
  if (rest[0] === 'last') return count > 0 ? count - 1 : null;
  const n = numberWord(rest[0], false);
  return n !== null && n >= 1 && n <= count ? n - 1 : null;
}

/**
 * Map a spoken answer onto one of the question's options: by position
 * ("the second one", "option two"), by yes/no when one option clearly is
 * the yes/no choice, or by naming it ("vitest"). Null when unsure.
 */
export function matchOption(text: string, options: string[]): string | null {
  const opts = options.filter((o) => typeof o === 'string' && o.trim());
  if (!opts.length) return null;
  const n = normalizeUtterance(text);
  if (!n) return null;
  const core = coreCommand(n);
  const normOpts = opts.map(normalizeUtterance);

  const exact = normOpts.findIndex((o) => o === n || o === core);
  if (exact !== -1) return opts[exact];

  const idx = optionIndexFromSpeech(n, opts.length);
  if (idx !== null) return opts[idx];

  const tokens = tokensOf(n);
  if (tokens.length <= 5) {
    const isYes = AFFIRMATIVE.has(n) || AFFIRMATIVE.has(core);
    const isNo = !isYes && (NEGATIVE.has(n) || NEGATIVE.has(core));
    if (isYes || isNo) {
      const pattern = isYes ? AFFIRMATIVE_OPTION : NEGATIVE_OPTION;
      const other = isYes ? NEGATIVE_OPTION : AFFIRMATIVE_OPTION;
      const direct = normOpts.filter((o) => pattern.test(o));
      if (direct.length === 1) return opts[normOpts.indexOf(direct[0])];
      if (opts.length === 2) {
        const opposite = normOpts.findIndex((o) => other.test(o));
        if (opposite !== -1 && !pattern.test(normOpts[1 - opposite])) return opts[1 - opposite];
      }
      return null;
    }
  }

  // Naming an option: the utterance contains it, or its distinctive words
  const containing = normOpts
    .map((o, i) => ({ i, o }))
    .filter(({ o }) => o.length >= 2 && ` ${n} `.includes(` ${o} `));
  if (containing.length === 1) return opts[containing[0].i];
  if (containing.length > 1) {
    containing.sort((a, b) => b.o.length - a.o.length);
    if (containing[0].o.length > containing[1].o.length) return opts[containing[0].i];
  }
  const significant = tokens.filter((t) => !STOPWORDS.has(t) && !FILLERS.has(t));
  if (!significant.length) return null;
  const scores = normOpts.map((o) => {
    const words = new Set(tokensOf(o));
    return significant.filter((t) => words.has(t)).length;
  });
  const best = Math.max(...scores);
  if (best === 0 || scores.filter((s) => s === best).length > 1) return null;
  if (best * 2 < significant.length) return null;
  return opts[scores.indexOf(best)];
}

export function isStopCommand(text: string): boolean {
  return STOP_PHRASES.has(coreCommand(normalizeUtterance(text)));
}

export function isSilenceCommand(text: string): boolean {
  const n = normalizeUtterance(text);
  return SILENCE_PHRASES.has(n) || SILENCE_PHRASES.has(coreCommand(n));
}

/**
 * "Stop" or "be quiet": obeying one by mistake only cuts the agent short, so
 * it is never discarded as the agent's own echo.
 */
export function isFailSafeCommand(text: string): boolean {
  const n = normalizeUtterance(text);
  if (!n) return false;
  const core = coreCommand(n);
  return [n, core].some((t) => STOP_PHRASES.has(t) || SILENCE_PHRASES.has(t));
}

/**
 * A bare reply ("yes", "no", "proceed", "do that"): it can answer a pending
 * question or approve a plan, so hearing it back from the speakers matters.
 */
export function isBareReply(text: string): boolean {
  const n = normalizeUtterance(text);
  if (!n) return false;
  const core = coreCommand(n);
  return [n, core].some((t) => AFFIRMATIVE.has(t) || NEGATIVE.has(t) || BARE_REPLIES.has(t));
}

/** Decide what a final speech transcript should do. */
export function classifyUtterance(text: string, ctx: IntentContext): UtteranceIntent {
  const raw = (text ?? '').trim();
  const n = normalizeUtterance(raw);
  const tokens = tokensOf(n);
  if (!n || tokens.every((t) => FILLERS.has(t))) return { kind: 'ignore' };

  const core = coreCommand(n);
  if (SILENCE_PHRASES.has(n) || SILENCE_PHRASES.has(core)) return { kind: 'silence' };
  if (STOP_PHRASES.has(core)) return ctx.running ? { kind: 'stop' } : { kind: 'silence' };

  const cleaned = cleanSpokenText(raw) || raw;
  if (ctx.pendingQuestion) {
    const matched = ctx.options?.length ? matchOption(raw, ctx.options) : null;
    if (matched) return { kind: 'answer', answer: matched };
    // "thanks" or "hang on" would otherwise resolve the question
    if (NON_ANSWERS.has(n)) return { kind: 'ignore' };
    return { kind: 'answer', answer: cleaned };
  }

  if (PLEASANTRIES.has(n) || NARRATOR_PHRASES.has(n)) return { kind: 'ignore' };
  if (!ctx.expectsReply && [n, core].some((t) => PLEASANTRIES.has(t) || BARE_REPLIES.has(t))) {
    return { kind: 'ignore' };
  }

  return ctx.running ? { kind: 'steer', text: cleaned } : { kind: 'prompt', text: cleaned };
}
