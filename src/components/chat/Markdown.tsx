'use client';

import { Fragment, type ReactNode } from 'react';

// Minimal, dependency-free Markdown renderer for chat replies.
// Builds React elements directly (no innerHTML), so model output can't inject markup.

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={k} className="md-code">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{renderInline(m[2].slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3].slice(1, -1)}</em>);
    else if (m[4]) {
      const label = m[4].slice(1, m[4].indexOf(']'));
      out.push(<a key={k} href={m[5]} target="_blank" rel="noopener noreferrer">{label}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const splitRow = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const k = `b${key++}`;

    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={k} className="md-pre"><code>{body.join('\n')}</code></pre>);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const Tag = (`h${Math.min(h[1].length + 2, 6)}`) as 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={k} className="md-h">{renderInline(h[2], k)}</Tag>);
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
            <thead><tr>{head.map((c, j) => <th key={j}>{renderInline(c, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{renderInline(c, `${k}r${ri}c${j}`)}</td>)}</tr>
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
          {items.map((it, j) => <li key={j}>{renderInline(it, `${k}l${j}`)}</li>)}
        </List>
      );
      continue;
    }

    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={k} className="md-quote">{renderInline(quote.join(' '), k)}</blockquote>);
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
      !lines[i].trim().startsWith('|')
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={k} className="md-p">
        {para.map((p, j) => (
          <Fragment key={j}>{j > 0 && <br />}{renderInline(p, `${k}p${j}`)}</Fragment>
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
        .md :global(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
      `}</style>
    </div>
  );
}
