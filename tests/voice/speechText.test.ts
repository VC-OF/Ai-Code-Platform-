import { describe, expect, it } from 'vitest';
import { splitForSpeech, splitSentences, toSpeakable, truncateAtSentence } from '@/lib/voice/speechText';

describe('toSpeakable', () => {
  it('returns an empty string for empty input', () => {
    expect(toSpeakable('')).toBe('');
    expect(toSpeakable('   \n\n  ')).toBe('');
  });

  it('replaces fenced code blocks with "(code omitted)"', () => {
    const md = 'Run this:\n\n```bash\nnpm install\nnpm test\n```\n\nThen it works.';
    const out = toSpeakable(md);
    expect(out).toBe('Run this: (code omitted) Then it works.');
    expect(out).not.toContain('npm install');
  });

  it('handles tilde fences and an unterminated fence', () => {
    expect(toSpeakable('Before.\n~~~\nsecret()\n~~~\nAfter.')).toBe('Before. (code omitted) After.');
    expect(toSpeakable('Start.\n```ts\nconst x = 1;\nconst y = 2;')).toBe('Start. (code omitted)');
  });

  it('collapses consecutive code blocks into one mention', () => {
    const md = '```js\na()\n```\n\n```js\nb()\n```';
    expect(toSpeakable(md)).toBe('(code omitted)');
  });

  it('keeps inline code content without backticks', () => {
    expect(toSpeakable('Call `useSpeech()` from the `ChatPanel`.')).toBe('Call useSpeech() from the ChatPanel.');
  });

  it('keeps generics and angle brackets in inline code', () => {
    expect(toSpeakable('Use `Array<string>` here')).toBe('Use Array of string here.');
    expect(toSpeakable('It returns `Promise<void>` and takes `Record<string, unknown>`.')).toBe(
      'It returns Promise of void and takes Record of string, unknown.'
    );
    expect(toSpeakable('A `Map<string, Array<number>>` cache')).toBe('A Map of string, Array of number cache.');
    expect(toSpeakable('Render `<App />` inside `<main>`')).toBe('Render App inside main.');
    expect(toSpeakable('Keep `__init__` and `**kwargs`')).toBe('Keep __init__ and **kwargs.');
  });

  it('strips only real HTML tags from prose', () => {
    expect(toSpeakable('x<y>z stays')).toBe('x<y>z stays.');
    expect(toSpeakable('Line one<br/>line <em>two</em> and <span class="a">three</span>')).toBe('Line one line two and three.');
  });

  it('reads links as their text and URLs as "a link"', () => {
    expect(toSpeakable('See [the docs](https://example.com/docs) for more.')).toBe('See the docs for more.');
    expect(toSpeakable('Open https://example.com/path?q=1 now.')).toBe('Open a link now.');
    expect(toSpeakable('Visit <https://example.com>.')).toBe('Visit a link.');
    expect(toSpeakable('Check www.example.org today')).toBe('Check a link today.');
  });

  it('uses alt text for images', () => {
    expect(toSpeakable('![Architecture diagram](diagram.png)')).toBe('Architecture diagram.');
    expect(toSpeakable('![](shot.png)')).toBe('an image.');
  });

  it('drops reference-style link definitions', () => {
    expect(toSpeakable('Read [the guide][1].\n\n[1]: https://example.com/guide')).toBe('Read the guide.');
  });

  it('strips headings and ends them with a full stop', () => {
    expect(toSpeakable('## Summary\nAll tests pass')).toBe('Summary. All tests pass.');
    expect(toSpeakable('# Done!')).toBe('Done!');
  });

  it('strips bullets, numbers and task checkboxes, one sentence per item', () => {
    const md = '- add tests\n- fix lint\n\n1. Build\n2) Deploy\n\n- [x] shipped';
    expect(toSpeakable(md)).toBe('add tests. fix lint. Build. Deploy. shipped.');
  });

  it('removes emphasis and strikethrough but keeps snake_case identifiers', () => {
    expect(toSpeakable('This is **very** _important_ and ~~old~~ *new*.')).toBe('This is very important and old new.');
    expect(toSpeakable('Rename snake_case_name please')).toBe('Rename snake_case_name please.');
    expect(toSpeakable('***Both*** __bold__')).toBe('Both bold.');
  });

  it('reads tables as comma-separated rows and skips separator rows', () => {
    const md = '| Name | Status |\n|------|:------:|\n| lint | ok |\n| tests | failing |';
    expect(toSpeakable(md)).toBe('Name, Status. lint, ok. tests, failing.');
  });

  it('removes blockquote markers, horizontal rules and HTML tags', () => {
    expect(toSpeakable('> Quoted text\n\n---\n\n<b>Bold</b> end')).toBe('Quoted text. Bold end.');
  });

  it('turns display math into "(equation omitted)" and keeps simple inline math', () => {
    expect(toSpeakable('The energy is $$E = mc^2$$ as shown.')).toBe('The energy is (equation omitted) as shown.');
    expect(toSpeakable('So $x = 2$ here.')).toBe('So x = 2 here.');
    expect(toSpeakable('Ratio $\\frac{a}{b}$ holds.')).toBe('Ratio (formula) holds.');
    expect(toSpeakable('It costs $5 and $10 each.')).toBe('It costs $5 and $10 each.');
  });

  it('collapses whitespace and joins soft-wrapped lines', () => {
    expect(toSpeakable('First line\ncontinues   here.\n\n\nNext   paragraph')).toBe('First line continues here. Next paragraph.');
  });

  it('reads arrows as "to"', () => {
    expect(toSpeakable('Renamed foo → bar')).toBe('Renamed foo to bar.');
  });

  it('cuts at a sentence boundary under maxChars', () => {
    const md = 'First sentence is here. Second sentence is a bit longer than the first. Third one.';
    const out = toSpeakable(md, 60);
    expect(out).toBe('First sentence is here.');
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it('falls back to a word break with an ellipsis when there is no sentence end', () => {
    const out = toSpeakable('word '.repeat(50), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it('keeps the whole text when it fits', () => {
    expect(toSpeakable('Short reply.', 400)).toBe('Short reply.');
  });
});

describe('truncateAtSentence', () => {
  it('returns the text unchanged when short enough', () => {
    expect(truncateAtSentence('Hi there.', 20)).toBe('Hi there.');
  });

  it('never exceeds maxChars', () => {
    const text = 'A'.repeat(500);
    const out = truncateAtSentence(text, 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it('returns empty for a non-positive limit', () => {
    expect(truncateAtSentence('Anything.', 0)).toBe('');
  });
});

describe('splitSentences', () => {
  it('splits on sentence punctuation followed by whitespace only', () => {
    expect(splitSentences('Version 3.5 is out. Update now! Really? Yes')).toEqual([
      'Version 3.5 is out.',
      'Update now!',
      'Really?',
      'Yes',
    ]);
  });
});

describe('splitForSpeech', () => {
  it('returns one chunk for short text and none for empty text', () => {
    expect(splitForSpeech('Hello there.', 50)).toEqual(['Hello there.']);
    expect(splitForSpeech('   ', 50)).toEqual([]);
  });

  it('merges sentences up to the limit', () => {
    const chunks = splitForSpeech('One two. Three four. Five six. Seven eight.', 20);
    expect(chunks).toEqual(['One two. Three four.', 'Five six.', 'Seven eight.']);
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
  });

  it('breaks a long sentence at commas, then spaces', () => {
    const sentence = 'alpha beta gamma, delta epsilon zeta, eta theta iota kappa lambda mu nu xi omicron pi rho sigma.';
    const chunks = splitForSpeech(sentence, 40);
    expect(chunks.every((c) => c.length <= 40)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(sentence);
  });

  it('hard-splits a single overlong word', () => {
    const chunks = splitForSpeech('x'.repeat(95), 40);
    expect(chunks.every((c) => c.length <= 40)).toBe(true);
    expect(chunks.join('')).toBe('x'.repeat(95));
  });
});
