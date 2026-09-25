'use client';

export interface ContextReportData {
  model: string;
  windowSize: number;
  used: number;
  buffer: number;
  free: number;
  compactThreshold: number;
  categories: { key: string; label: string; tokens: number }[];
  mcpTools?: { name: string; tokens: number }[];
  memoryFiles?: { name: string; tokens: number }[];
  skills?: { name: string; source?: string; tokens: number }[];
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 || n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);
const pctLabel = (p: number) => (p > 0 && p < 0.1 ? '<0.1%' : `${p.toFixed(p < 10 ? 1 : 0)}%`);

type CellKind = string; // category key | 'free' | 'buffer'

/** Allocate 100 cells (1% each) in category order; any non-zero category gets
 * at least one cell so it stays visible, then free and buffer fill the rest. */
function buildCells(data: ContextReportData): CellKind[] {
  const cells: CellKind[] = [];
  for (const c of data.categories) {
    if (c.tokens <= 0) continue;
    const n = Math.max(1, Math.round(pct(c.tokens, data.windowSize)));
    for (let i = 0; i < n && cells.length < 100; i++) cells.push(c.key);
  }
  const bufferCells = Math.min(100 - cells.length, Math.round(pct(data.buffer, data.windowSize)));
  while (cells.length < 100 - bufferCells) cells.push('free');
  while (cells.length < 100) cells.push('buffer');
  return cells;
}

function DetailSection({ title, rows }: { title: string; rows?: { name: string; tokens: number }[] }) {
  if (!rows || rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.tokens - a.tokens);
  return (
    <details className="ctx-details">
      <summary>
        {title} <span className="ctx-mono ctx-muted">{sorted.length}</span>
      </summary>
      <ul>
        {sorted.map((r) => (
          <li key={r.name}>
            <span className="ctx-mono ctx-name">{r.name}</span>
            <span className="ctx-mono ctx-muted">{formatTokens(r.tokens)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function ContextReport({ data }: { data: ContextReportData }) {
  const usedPct = pct(data.used, data.windowSize);
  const cells = buildCells(data);
  const legend = [
    ...data.categories.map((c) => ({ key: c.key, label: c.label, tokens: c.tokens })),
    { key: 'free', label: 'Free space', tokens: data.free },
    { key: 'buffer', label: 'Autocompact buffer', tokens: data.buffer },
  ];
  const summary = `${formatTokens(data.used)} of ${formatTokens(data.windowSize)} tokens used (${pctLabel(usedPct)}). ` +
    legend.map((l) => `${l.label} ${formatTokens(l.tokens)}`).join(', ');

  return (
    <div className="ctx-report">
      <div className="ctx-header">
        <span className="ctx-title">Context usage</span>
        <span className="ctx-mono ctx-muted">
          {data.model} · {formatTokens(data.used)} / {formatTokens(data.windowSize)} tokens ({pctLabel(usedPct)})
        </span>
      </div>
      <div className="ctx-body">
        <div className="ctx-grid" role="img" aria-label={summary}>
          {cells.map((kind, i) => (
            <span key={i} className={`ctx-cell ctx-c-${kind}`} />
          ))}
        </div>
        <ul className="ctx-legend">
          {legend.map((l) => (
            <li key={l.key}>
              <span className={`ctx-cell ctx-c-${l.key}`} aria-hidden="true" />
              <span className="ctx-label">{l.label}</span>
              <span className="ctx-mono">{formatTokens(l.tokens)}</span>
              <span className="ctx-mono ctx-muted ctx-pct">{pctLabel(pct(l.tokens, data.windowSize))}</span>
            </li>
          ))}
        </ul>
      </div>
      <DetailSection title="MCP tools" rows={data.mcpTools} />
      <DetailSection title="Memory files" rows={data.memoryFiles} />
      <DetailSection title="Skills" rows={data.skills} />
      {data.used > data.compactThreshold && (
        <p className="ctx-hint">Run /compact to free up space.</p>
      )}
    </div>
  );
}
