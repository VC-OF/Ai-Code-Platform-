// Turn chat Markdown into text that sounds natural when read by a TTS voice.
// Pure string helpers: no DOM, safe to unit-test in node.

import { splitMathSegments } from '@/lib/markdownMath';

const CODE_OMITTED = '(code omitted)';
const EQUATION_OMITTED = '(equation omitted)';

/** Inline math that reads fine as-is ("x = 2", "n + 1"); anything else is a formula. */
const SIMPLE_MATH = /^[A-Za-z0-9 =+\-*/().,<>]{1,40}$/;

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"]/gi;

function stripFencedCode(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
      continue;
    }
    if (m) {
      fence = m[1];
      out.push(CODE_OMITTED);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function replaceMath(text: string): string {
  if (!text.includes('$') && !text.includes('\\[') && !text.includes('\\(')) return text;
  return splitMathSegments(text)
    .map((seg) => {
      if (seg.type === 'text') return seg.value;
      if (seg.type === 'block') return ` ${EQUATION_OMITTED} `;
      const v = seg.value.trim();
      return SIMPLE_MATH.test(v) ? v : '(formula)';
    })
    .join('');
}

// Only real HTML tags are stripped, so "x<y>z" and Array<string> keep their text
const HTML_TAG_NAMES =
  'a|abbr|audio|b|blockquote|br|button|caption|center|cite|code|col|colgroup|dd|del|details|dfn|div|dl|dt|em|' +
  'figcaption|figure|font|footer|form|h[1-6]|header|hr|i|iframe|img|input|ins|kbd|label|li|main|mark|nav|ol|' +
  'option|p|picture|pre|q|s|samp|script|section|select|small|source|span|strike|strong|style|sub|summary|sup|' +
  'table|tbody|td|textarea|tfoot|th|thead|tr|tt|u|ul|var|video|wbr';
const HTML_TAG_RE = new RegExp(`<\\/?(?:${HTML_TAG_NAMES})(?:\\s[^<>]*)?\\/?>`, 'gi');

const CODE_SPAN_RE = /`+([^`]*)`+/g;
// Private-use character, not expected in chat text
const MARK = '\uE000';
const CODE_PLACEHOLDER_RE = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');

/** Inline code as it should sound: Array<string> → "Array of string", <App /> → "App". */
function speakCode(code: string): string {
  let s = code.replace(URL_RE, 'a link');
  for (let i = 0; i < 3 && /\w<[^<>]+>/.test(s); i++) s = s.replace(/(\w)<([^<>]+)>/g, '$1 of $2');
  return s.replace(/<\/?([A-Za-z][\w.-]*)[^<>]*?\/?>/g, '$1');
}

function stripInline(line: string): string {
  // Inline code is set aside so markup rules cannot eat its <, > or _
  const code: string[] = [];
  let s = line.replace(CODE_SPAN_RE, (_m, content: string) => `${MARK}${code.push(content) - 1}${MARK}`);
  // Images before links: ![alt](src) → alt
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt.trim() ? alt : 'an image'));
  // Links: [text](url) and [text][ref] → text
  s = s.replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  // Autolinks and bare URLs
  s = s.replace(/<(?:https?:\/\/|mailto:)[^>]+>/gi, 'a link');
  s = s.replace(URL_RE, 'a link');
  s = s.replace(HTML_TAG_RE, ' ');
  // Emphasis and strikethrough (underscore forms only at word boundaries so
  // snake_case identifiers survive)
  s = s.replace(/(\*\*\*|___)(\S(?:.*?\S)?)\1/g, '$2');
  s = s.replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, '$2');
  s = s.replace(/(^|[^\w*])\*(\S(?:[^*]*?\S)?)\*(?!\w)/g, '$1$2');
  s = s.replace(/(^|[^\w])_(\S(?:[^_]*?\S)?)_(?!\w)/g, '$1$2');
  s = s.replace(/~~(\S(?:.*?\S)?)~~/g, '$1');
  s = s.replace(/\s*(?:→|⟶|->)\s*/g, ' to ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return s.replace(CODE_PLACEHOLDER_RE, (_m, i: string) => speakCode(code[Number(i)] ?? ''));
}

const endsSentence = (s: string) => /[.!?:;…)]$/.test(s);
const punctuate = (s: string) => (s && !endsSentence(s) ? `${s}.` : s);

/**
 * Convert Markdown to plain speakable text.
 *
 * Code blocks become "(code omitted)", display math "(equation omitted)",
 * links read as their text, bare URLs as "a link"; headings, bullets,
 * emphasis and tables lose their markup (headings and list items end with a
 * full stop so the voice pauses). The result is cut at a sentence boundary
 * so it stays under `maxChars`.
 */
export function toSpeakable(markdown: string, maxChars = 400): string {
  if (!markdown) return '';
  let text = markdown.replace(/\r\n?/g, '\n');
  text = stripFencedCode(text);
  text = replaceMath(text);

  const pieces: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) pieces.push(punctuate(paragraph.join(' ').trim()));
    paragraph = [];
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    // Reference-style link definitions and horizontal rules carry no speech
    if (/^\[[^\]]+\]:\s*\S+/.test(line)) continue;
    if (/^([-*_])(\s*\1){2,}$/.test(line) || /^=+$/.test(line)) {
      flushParagraph();
      continue;
    }
    // Table rows: separator rows vanish, cells are read as a list
    if (/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(line)) {
      flushParagraph();
      continue;
    }
    if (/^\|.*\|$/.test(line) || (/^\|/.test(line) && line.split('|').length > 2)) {
      flushParagraph();
      const cells = line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => stripInline(c).trim())
        .filter(Boolean);
      if (cells.length) pieces.push(punctuate(cells.join(', ')));
      continue;
    }
    const heading = /^#{1,6}\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      flushParagraph();
      const h = stripInline(heading[1]).trim();
      if (h) pieces.push(punctuate(h));
      continue;
    }
    let body = line.replace(/^(?:>\s?)+/, '');
    const listItem = /^(?:[-*+]|\d{1,3}[.)])\s+(.*)$/.exec(body);
    if (listItem) {
      flushParagraph();
      body = listItem[1].replace(/^\[[ xX]\]\s+/, '');
      const item = stripInline(body).trim();
      if (item) pieces.push(punctuate(item));
      continue;
    }
    const inline = stripInline(body).trim();
    if (inline) paragraph.push(inline);
  }
  flushParagraph();

  let spoken = pieces
    .join(' ')
    .replace(/\s+\|\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\.{2,}(?!\.)/g, '.')
    .replace(/([!?:;])\./g, '$1')
    .trim();
  // A run of omitted blocks reads as one
  spoken = spoken.replace(/(\(code omitted\)\.?\s*){2,}/g, `${CODE_OMITTED} `).trim();
  return truncateAtSentence(spoken, maxChars);
}

/** Cut `text` to at most `maxChars`, preferring the last sentence end, then a word break. */
export function truncateAtSentence(text: string, maxChars: number): string {
  const t = text.trim();
  if (maxChars <= 0) return '';
  if (t.length <= maxChars) return t;
  const window = t.slice(0, maxChars + 1);
  let cut = -1;
  const re = /[.!?…](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) {
    if (m.index + 1 <= maxChars) cut = m.index + 1;
  }
  if (cut >= Math.min(40, maxChars * 0.3)) return t.slice(0, cut).trim();
  const room = t.slice(0, Math.max(1, maxChars - 1));
  const space = room.lastIndexOf(' ');
  const base = (space > maxChars * 0.3 ? room.slice(0, space) : room).replace(/[\s,;:]+$/, '');
  return `${base}…`;
}

/** Split on sentence-ending punctuation followed by whitespace ("3.5" stays whole). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[.!?…]+(?=\s)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const sentence = text.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Split speakable text into chunks of at most `maxLen` characters on
 * sentence boundaries (merging short sentences), falling back to clause and
 * word breaks for very long sentences. Browser voices cut off long
 * utterances and server voices start faster on short ones.
 */
export function splitForSpeech(text: string, maxLen = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const units: string[] = [];
  for (const sentence of splitSentences(clean)) {
    if (sentence.length <= maxLen) {
      units.push(sentence);
      continue;
    }
    // Long sentence: break after commas/semicolons, then on spaces
    let rest = sentence;
    while (rest.length > maxLen) {
      const head = rest.slice(0, maxLen);
      let at = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '));
      if (at < maxLen * 0.4) at = head.lastIndexOf(' ');
      if (at <= 0) at = maxLen - 1;
      units.push(rest.slice(0, at + 1).trim());
      rest = rest.slice(at + 1).trim();
    }
    if (rest) units.push(rest);
  }

  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if (!current) current = unit;
    else if (current.length + 1 + unit.length <= maxLen) current = `${current} ${unit}`;
    else {
      chunks.push(current);
      current = unit;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
