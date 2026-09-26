// Pure helpers for LaTeX math and image handling in chat Markdown.
// No React / DOM here so this module can be unit-tested in a node environment.

export type MathSegment = { type: 'text' | 'inline' | 'block'; value: string };

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isDigit = (ch: string | undefined) => ch !== undefined && ch >= '0' && ch <= '9';

/**
 * Tokenise a single paragraph/line of markdown into text and math segments.
 *
 * Delimiters (checked in this order at every position):
 *   - `$$…$$`  block (may contain newlines)
 *   - `\[…\]`  block
 *   - `\(…\)`  inline
 *   - `$…$`    inline, pandoc rules: the opening `$` must be immediately followed by
 *              a non-space character, the closing `$` must be immediately preceded by
 *              a non-space character and must NOT be followed by a digit, and the span
 *              must not contain a newline. So "costs $5 and $10 each" stays text.
 *
 * `\$` is a literal `$`. Inline code spans (`…`) are never scanned for math and come
 * through as text. Unterminated delimiters are plain text.
 */
export function splitMathSegments(text: string): MathSegment[] {
  const out: MathSegment[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', value: buf });
    buf = '';
  };
  const push = (type: 'inline' | 'block', value: string) => {
    flush();
    out.push({ type, value });
  };

  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];

    // Escaped dollar → literal "$" (kept as text, including the backslash so that the
    // downstream inline pass sees a plain "$"; we drop the backslash here).
    if (ch === '\\' && text[i + 1] === '$') {
      buf += '$';
      i += 2;
      continue;
    }

    // Inline code span: copy verbatim, never math-parsed.
    if (ch === '`') {
      let ticks = 1;
      while (text[i + ticks] === '`') ticks++;
      const open = text.slice(i, i + ticks);
      const close = text.indexOf(open, i + ticks);
      if (close !== -1) {
        buf += text.slice(i, close + ticks);
        i = close + ticks;
      } else {
        buf += open;
        i += ticks;
      }
      continue;
    }

    // \[ … \]  (block)
    if (ch === '\\' && text[i + 1] === '[') {
      const close = text.indexOf('\\]', i + 2);
      if (close !== -1) {
        push('block', text.slice(i + 2, close));
        i = close + 2;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    // \( … \)  (inline)
    if (ch === '\\' && text[i + 1] === '(') {
      const close = text.indexOf('\\)', i + 2);
      if (close !== -1) {
        push('inline', text.slice(i + 2, close));
        i = close + 2;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === '$') {
      // $$ … $$ (block, may span newlines)
      if (text[i + 1] === '$') {
        const close = text.indexOf('$$', i + 2);
        if (close !== -1) {
          push('block', text.slice(i + 2, close));
          i = close + 2;
          continue;
        }
        buf += '$$';
        i += 2;
        continue;
      }

      // $ … $ (inline, pandoc rules)
      if (!isSpace(text[i + 1])) {
        let j = i + 1;
        let found = -1;
        while (j < n) {
          const c = text[j];
          if (c === '\n') break;
          if (c === '\\') {
            j += 2;
            continue;
          }
          if (c === '$') {
            if (!isSpace(text[j - 1]) && !isDigit(text[j + 1])) {
              found = j;
            }
            break; // first candidate closer decides; an invalid one means no match
          }
          j++;
        }
        if (found !== -1) {
          push('inline', text.slice(i + 1, found));
          i = found + 1;
          continue;
        }
      }
      buf += '$';
      i++;
      continue;
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolve the `src` of a markdown image to something safe to put in an <img>.
 * Returns null when the source is not allowed.
 *
 *  - http(s) URLs and `data:image/...` URLs are returned unchanged.
 *  - A workspace-relative path (no scheme, not starting with "/" or "//", no ".."
 *    segments, image extension) is routed through the workspace image API when a
 *    projectId is supplied; without a projectId it is disallowed.
 *  - Everything else (javascript:, file:, absolute paths, other schemes) → null.
 */
export function resolveMarkdownImageSrc(src: string, projectId?: string): string | null {
  const s = src.trim();
  if (!s) return null;

  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(s)) return s;

  if (HAS_SCHEME.test(s)) return null;
  if (s.startsWith('/') || s.startsWith('\\')) return null;
  if (s.includes('\\')) return null;
  if (s.split('/').some((seg) => seg === '..')) return null;
  if (!IMAGE_EXT.test(s)) return null;
  if (!projectId) return null;

  return `/api/workspace/image?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(s)}`;
}

const MATH_LANGS = new Set(['math', 'latex', 'tex', 'katex']);

/** True for fenced code block languages that should render as display math. */
export function mathBlockLanguage(lang: string): boolean {
  return MATH_LANGS.has(lang.trim().toLowerCase());
}
