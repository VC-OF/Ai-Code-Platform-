'use client';

import { Fragment, type ReactNode } from 'react';
import katex from 'katex';
import { mathBlockLanguage, resolveMarkdownImageSrc, splitMathSegments } from '@/lib/markdownMath';

// Minimal, dependency-free Markdown renderer for chat replies.
// Builds React elements directly (no innerHTML), so model output can't inject markup.
// The single exception is KaTeX output (see renderMath below).

type Ctx = { projectId?: string };

// KaTeX is the one sanctioned use of dangerouslySetInnerHTML in this renderer:
// katex.renderToString HTML-escapes every character of the input, and `trust: false`
// disables \href, \url, \includegraphics and every other command that could emit a
// URL or arbitrary attribute, so the resulting markup cannot carry model-controlled
// links or scripts.
function renderMath(tex: string, display: boolean, key: string, forceInline = false): ReactNode {
  const html = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml',
  });
  if (!display) return <span key={key} className="md-math" dangerouslySetInnerHTML={{ __html: html }} />;
  // Display math that appears inside a paragraph/list item/etc. must stay phrasing
  // content, so use a block-styled <span> there and a real <div> at block level.
  if (forceInline) return <span key={key} className="md-math-block" dangerouslySetInnerHTML={{ __html: html }} />;
  return <div key={key} className="md-math-block" dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderImage(alt: string, rawSrc: string, key: string, ctx: Ctx, literal: string): ReactNode {
  const src = resolveMarkdownImageSrc(rawSrc, ctx.projectId);
  if (!src) return literal;
  return (
    <a key={key} href={src} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="md-img"
        src={src}
        alt={alt}
        loading="lazy"
        style={{
          maxWidth: '100%',
          height: 'auto',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          display: 'block',
          margin: '4px 0 8px',
        }}
      />
    </a>
  );
}

function renderInline(text: string, keyBase: string, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(!\[([^\]]*)\]\(([^\s)]+)\))|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={k} className="md-code">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{renderInline(m[2].slice(2, -2), k, ctx)}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3].slice(1, -1)}</em>);
    else if (m[4]) out.push(renderImage(m[5], m[6], k, ctx, m[4]));
    else if (m[7]) {
      const label = m[7].slice(1, m[7].indexOf(']'));
      out.push(<a key={k} href={m[8]} target="_blank" rel="noopener noreferrer">{label}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Inline pass with math: text segments get the usual bold/italic/code/link/image
// handling, math segments render via KaTeX. Code spans are never math-parsed.
function renderRich(text: string, keyBase: string, ctx: Ctx): ReactNode[] {
  const segs = splitMathSegments(text);
  if (segs.length === 1 && segs[0].type === 'text') return renderInline(segs[0].value, keyBase, ctx);
  const out: ReactNode[] = [];
  segs.forEach((seg, j) => {
    const k = `${keyBase}m${j}`;
    if (seg.type === 'text') out.push(<Fragment key={k}>{renderInline(seg.value, k, ctx)}</Fragment>);
    else out.push(renderMath(seg.value, seg.type === 'block', k, true));
  });
  return out;
}

const splitRow = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// If `lines[i]` opens a display-math block (`$$…$$` or `\[…\]`, possibly multi-line),
// return its TeX body and the index just past it; otherwise null.
function matchDisplayBlock(lines: string[], i: number): { tex: string; next: number } | null {
  const first = lines[i].trim();
  const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : null;
  if (!open) return null;
  const close = open === '$$' ? '$$' : '\\]';
  const rest = first.slice(open.length);
  const closeAt = rest.indexOf(close);
  if (closeAt !== -1) {
    // "$$x$$" is a one-liner only when the closer is at the very end of the line and
    // non-empty; "$$" alone opens a multi-line block; "$$x$$ and $$y$$" is a paragraph.
    if (closeAt === rest.length - close.length && rest.slice(0, closeAt).trim()) {
      return { tex: rest.slice(0, closeAt), next: i + 1 };
    }
    if (closeAt !== rest.length - close.length) return null;
  }
  const body: string[] = [rest];
  let j = i + 1;
  while (j < lines.length) {
    const t = lines[j].trimEnd();
    if (t.trim().endsWith(close)) {
      body.push(t.trim().slice(0, -close.length));
      return { tex: body.join('\n'), next: j + 1 };
    }
    body.push(lines[j]);
    j++;
  }
  return null; // unterminated → fall through to normal paragraph handling
}

export default function Markdown({ text, projectId }: { text: string; projectId?: string }) {
  const ctx: Ctx = { projectId };
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const k = `b${key++}`;

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      if (mathBlockLanguage(lang)) blocks.push(renderMath(body.join('\n'), true, k));
      else blocks.push(<pre key={k} className="md-pre"><code>{body.join('\n')}</code></pre>);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={k} className="md-hr" />);
      i++;
      continue;
    }

    const display = matchDisplayBlock(lines, i);
    if (display) {
      blocks.push(renderMath(display.tex, true, k));
      i = display.next;
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const Tag = (`h${Math.min(h[1].length + 2, 6)}`) as 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={k} className="md-h">{renderRich(h[2], k, ctx)}</Tag>);
      i++;
      continue;
    }

    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      blocks.push(
        <div key={k} className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{head.map((c, j) => <th key={j}>{renderRich(c, `${k}h${j}`, ctx)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{renderRich(c, `${k}r${ri}c${j}`, ctx)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*([-*•]|\d+\.)\s+/, ''));
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={k} className="md-list">
          {items.map((it, j) => <li key={j}>{renderRich(it, `${k}l${j}`, ctx)}</li>)}
        </List>
      );
      continue;
    }

    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={k} className="md-quote">{renderRich(quote.join(' '), k, ctx)}</blockquote>);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(```|#{1,4}\s|>|\s*([-*•]|\d+\.)\s+)/.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i]) &&
      !(para.length > 0 && matchDisplayBlock(lines, i))
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={k} className="md-p">
        {para.map((p, j) => (
          <Fragment key={j}>{j > 0 && <br />}{renderRich(p, `${k}p${j}`, ctx)}</Fragment>
        ))}
      </p>
    );
  }

  return (
    <div className="md">
      {blocks}
      <style jsx>{`
        .md :global(.md-p) { margin: 0 0 8px; }
        .md :global(.md-p:last-child) { margin-bottom: 0; }
        .md :global(.md-h) { font-family: var(--font-serif); font-weight: 500; font-size: 15px; margin: 12px 0 6px; color: var(--text-primary); }
        .md :global(.md-list) { margin: 0 0 8px; padding-left: 20px; }
        .md :global(.md-list li) { margin: 2px 0; }
        .md :global(.md-code) { font-family: var(--font-mono); font-size: 12px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 0 4px; }
        .md :global(.md-pre) { font-family: var(--font-mono); font-size: 12px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 10px 12px; overflow-x: auto; margin: 0 0 8px; white-space: pre; }
        .md :global(.md-quote) { border-left: 2px solid var(--border-strong); padding-left: 10px; color: var(--text-secondary); margin: 0 0 8px; }
        .md :global(.md-table-wrap) { overflow-x: auto; margin: 0 0 8px; }
        .md :global(.md-table) { border-collapse: collapse; font-size: 12.5px; }
        .md :global(.md-table th), .md :global(.md-table td) { border: 1px solid var(--border-base); padding: 4px 10px; text-align: left; }
        .md :global(.md-table th) { background: var(--bg-elevated); font-weight: 500; }
        .md :global(.md-math) { color: var(--text-primary); }
        .md :global(.md-math-block) { display: block; overflow-x: auto; overflow-y: hidden; margin: 4px 0 10px; padding: 4px 0; color: var(--text-primary); }
        .md :global(.md-img) { max-width: 100%; height: auto; }
        .md :global(.md-hr) { border: 0; border-top: 1px solid var(--border-subtle); margin: 10px 0; }
        .md :global(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
      `}</style>
    </div>
  );
}
