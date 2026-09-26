import { describe, expect, it } from 'vitest';
import {
  mathBlockLanguage,
  resolveMarkdownImageSrc,
  splitMathSegments,
  type MathSegment,
} from '@/lib/markdownMath';

const text = (value: string): MathSegment => ({ type: 'text', value });
const inline = (value: string): MathSegment => ({ type: 'inline', value });
const block = (value: string): MathSegment => ({ type: 'block', value });

describe('splitMathSegments', () => {
  it('parses inline $…$', () => {
    expect(splitMathSegments('Einstein: $E = mc^2$ wow')).toEqual([
      text('Einstein: '),
      inline('E = mc^2'),
      text(' wow'),
    ]);
  });

  it('parses display $$…$$', () => {
    expect(splitMathSegments('$$\\int_0^1 x\\,dx$$')).toEqual([block('\\int_0^1 x\\,dx')]);
  });

  it('parses \\(…\\) and \\[…\\]', () => {
    expect(splitMathSegments('a \\(a\\) b \\[b\\] c')).toEqual([
      text('a '),
      inline('a'),
      text(' b '),
      block('b'),
      text(' c'),
    ]);
  });

  it('keeps money as text', () => {
    expect(splitMathSegments('costs $5 and $10 each')).toEqual([text('costs $5 and $10 each')]);
    expect(splitMathSegments('$5 and $10')).toEqual([text('$5 and $10')]);
  });

  it('applies the "closing $ must not be followed by a digit" rule', () => {
    expect(splitMathSegments('$5$1')).toEqual([text('$5$1')]);
    expect(splitMathSegments('$5$ x')).toEqual([inline('5'), text(' x')]);
  });

  it('rejects openers followed by a space and closers preceded by a space', () => {
    expect(splitMathSegments('a $ b $ c')).toEqual([text('a $ b $ c')]);
    expect(splitMathSegments('a $b $ c')).toEqual([text('a $b $ c')]);
  });

  it('treats escaped \\$ as a literal dollar', () => {
    expect(splitMathSegments('pay \\$5 now')).toEqual([text('pay $5 now')]);
    expect(splitMathSegments('\\$a\\$')).toEqual([text('$a$')]);
  });

  it('leaves unterminated delimiters as text', () => {
    expect(splitMathSegments('price $x is unknown')).toEqual([text('price $x is unknown')]);
    expect(splitMathSegments('$$x')).toEqual([text('$$x')]);
    expect(splitMathSegments('\\(x')).toEqual([text('\\(x')]);
    expect(splitMathSegments('\\[x')).toEqual([text('\\[x')]);
  });

  it('never scans code spans for math', () => {
    expect(splitMathSegments('use `$x$` here')).toEqual([text('use `$x$` here')]);
    expect(splitMathSegments('``a `$b$` c`` and $d$')).toEqual([text('``a `$b$` c`` and '), inline('d')]);
  });

  it('does not let inline $…$ span a newline', () => {
    expect(splitMathSegments('$a\nb$')).toEqual([text('$a\nb$')]);
  });

  it('parses a multi-line $$ block', () => {
    const src = '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$';
    expect(splitMathSegments(src)).toEqual([block('\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n')]);
  });

  it('handles several math spans in one line', () => {
    expect(splitMathSegments('$a$ + $b$ = $c$')).toEqual([
      inline('a'),
      text(' + '),
      inline('b'),
      text(' = '),
      inline('c'),
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(splitMathSegments('')).toEqual([]);
  });
});

describe('resolveMarkdownImageSrc', () => {
  it('allows http(s) URLs unchanged', () => {
    expect(resolveMarkdownImageSrc('https://x/y.png')).toBe('https://x/y.png');
    expect(resolveMarkdownImageSrc('http://x/y.png', 'p1')).toBe('http://x/y.png');
  });

  it('allows data:image URLs unchanged', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveMarkdownImageSrc(url)).toBe(url);
  });

  it('routes workspace-relative paths through the image API', () => {
    expect(resolveMarkdownImageSrc('results/plot.png', 'p1')).toBe(
      '/api/workspace/image?projectId=p1&path=results%2Fplot.png',
    );
    expect(resolveMarkdownImageSrc('Plot.JPG', 'p 1')).toBe('/api/workspace/image?projectId=p%201&path=Plot.JPG');
  });

  it('denies workspace-relative paths without a projectId', () => {
    expect(resolveMarkdownImageSrc('results/plot.png')).toBeNull();
  });

  it('denies traversal, absolute paths and non-http schemes', () => {
    expect(resolveMarkdownImageSrc('../secret.png', 'p1')).toBeNull();
    expect(resolveMarkdownImageSrc('a/../secret.png', 'p1')).toBeNull();
    expect(resolveMarkdownImageSrc('/etc/x.png', 'p1')).toBeNull();
    expect(resolveMarkdownImageSrc('//evil/x.png', 'p1')).toBeNull();
    expect(resolveMarkdownImageSrc('javascript:alert(1)', 'p1')).toBeNull();
    expect(resolveMarkdownImageSrc('file:///etc/passwd.png', 'p1')).toBeNull();
    expect(resolveMarkdownImageSrc('data:text/html,<b>x</b>', 'p1')).toBeNull();
    expect(resolveMarkdownImageSrc('ftp://x/y.png', 'p1')).toBeNull();
  });

  it('denies non-image extensions and empty input', () => {
    expect(resolveMarkdownImageSrc('notes.txt', 'p1')).toBeNull();
    expect(resolveMarkdownImageSrc('', 'p1')).toBeNull();
  });
});

describe('mathBlockLanguage', () => {
  it('recognises math fence languages', () => {
    for (const l of ['math', 'latex', 'tex', 'katex', 'LaTeX', ' TeX ']) expect(mathBlockLanguage(l)).toBe(true);
  });

  it('rejects other languages', () => {
    for (const l of ['', 'ts', 'python', 'markdown', 'mathematica']) expect(mathBlockLanguage(l)).toBe(false);
  });
});
