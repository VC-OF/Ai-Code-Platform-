import crypto from 'crypto';

/**
 * Jupyter notebook (.ipynb, nbformat 4) support for the agent: render a
 * notebook as readable cells with outputs (read_file), apply cell edits
 * (notebook_edit) and extract execution errors after run_notebook.
 * Pure functions — no filesystem access here.
 */

export type CellType = 'code' | 'markdown' | 'raw';

export interface NotebookOutput {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error' | string;
  name?: string;
  text?: string | string[];
  data?: Record<string, string | string[]>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  execution_count?: number | null;
}

export interface NotebookCell {
  id?: string;
  cell_type: CellType;
  source: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: NotebookOutput[];
  execution_count?: number | null;
}

export interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

export interface NotebookEditOp {
  action: 'replace' | 'insert' | 'delete';
  /** 0-based cell index. For insert: the new cell goes at this position
   *  (0 = first, cells.length = append). */
  index: number;
  cellType?: CellType;
  source?: string;
}

export function parseNotebook(text: string): Notebook {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not a valid notebook (JSON parse failed: ${err instanceof Error ? err.message : String(err)})`);
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Notebook).cells)) {
    throw new Error('Not a valid notebook: missing "cells" array');
  }
  const nb = raw as Notebook;
  return {
    cells: nb.cells,
    metadata: nb.metadata && typeof nb.metadata === 'object' ? nb.metadata : {},
    nbformat: typeof nb.nbformat === 'number' ? nb.nbformat : 4,
    nbformat_minor: typeof nb.nbformat_minor === 'number' ? nb.nbformat_minor : 5,
  };
}

export function emptyNotebook(kernel: 'python3' = 'python3'): Notebook {
  return {
    cells: [],
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: kernel },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

export function cellSource(cell: NotebookCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
}

/** nbformat stores multi-line source as a list of lines that keep their "\n". */
function toSourceLines(source: string): string[] {
  const lines = source.split('\n');
  return lines.map((l, i) => (i < lines.length - 1 ? `${l}\n` : l)).filter((l, i, a) => !(i === a.length - 1 && l === ''));
}

export function newCell(type: CellType, source: string): NotebookCell {
  const cell: NotebookCell = {
    id: crypto.randomBytes(4).toString('hex'),
    cell_type: type,
    metadata: {},
    source: toSourceLines(source),
  };
  if (type === 'code') {
    cell.outputs = [];
    cell.execution_count = null;
  }
  return cell;
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

function joinText(t: string | string[] | undefined): string {
  return Array.isArray(t) ? t.join('') : String(t ?? '');
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.6);
  return `${s.slice(0, head)}\n…[${s.length - max} chars omitted]…\n${s.slice(-(max - head))}`;
}

/** Text rendering of a cell's outputs; rich mime types are named, not dumped. */
export function formatOutputs(outputs: NotebookOutput[] | undefined, maxChars = 2_000): string {
  if (!outputs || outputs.length === 0) return '';
  const parts: string[] = [];
  for (const out of outputs) {
    switch (out.output_type) {
      case 'stream':
        parts.push(`[${out.name ?? 'stdout'}]\n${stripAnsi(joinText(out.text))}`);
        break;
      case 'execute_result':
      case 'display_data': {
        const data = out.data ?? {};
        const text = data['text/plain'] !== undefined ? stripAnsi(joinText(data['text/plain'])) : '';
        const rich = Object.keys(data).filter((k) => k !== 'text/plain');
        const label = out.output_type === 'execute_result' && out.execution_count != null
          ? `Out[${out.execution_count}]`
          : 'display';
        parts.push(`[${label}]${rich.length ? ` (${rich.join(', ')})` : ''}${text ? `\n${text}` : ''}`);
        break;
      }
      case 'error': {
        const tb = (out.traceback ?? []).map(stripAnsi).join('\n');
        const tail = tb.split('\n').slice(-12).join('\n');
        parts.push(`[error] ${out.ename ?? 'Error'}: ${out.evalue ?? ''}${tail ? `\n${tail}` : ''}`);
        break;
      }
      default:
        parts.push(`[${out.output_type}]`);
    }
  }
  return clip(parts.join('\n'), maxChars);
}

/** Readable dump of the notebook: numbered cells, sources and outputs. */
export function formatNotebook(
  nb: Notebook,
  opts: { maxCellChars?: number; maxOutputChars?: number } = {}
): string {
  const maxCell = opts.maxCellChars ?? 6_000;
  const maxOut = opts.maxOutputChars ?? 2_000;
  const kernel = (nb.metadata as { kernelspec?: { name?: string } }).kernelspec?.name;
  const lines: string[] = [
    `# Notebook: ${nb.cells.length} cells (nbformat ${nb.nbformat}.${nb.nbformat_minor}${kernel ? `, kernel ${kernel}` : ''})`,
    'Cells are 0-indexed; edit them with notebook_edit and execute the notebook with run_notebook.',
    '',
  ];
  nb.cells.forEach((cell, i) => {
    const count = cell.cell_type === 'code' && cell.execution_count != null ? ` In[${cell.execution_count}]` : '';
    lines.push(`## Cell ${i} [${cell.cell_type}]${count}`);
    lines.push(clip(cellSource(cell), maxCell) || '(empty)');
    if (cell.cell_type === 'code') {
      const out = formatOutputs(cell.outputs, maxOut);
      if (out) lines.push('--- output ---', out);
    }
    lines.push('');
  });
  return lines.join('\n');
}

export function editNotebook(nb: Notebook, op: NotebookEditOp): { notebook: Notebook; description: string } {
  const cells = [...nb.cells];
  const n = cells.length;
  if (!Number.isInteger(op.index) || op.index < 0) {
    throw new Error(`cell_index must be a non-negative integer (got ${op.index})`);
  }
  switch (op.action) {
    case 'insert': {
      if (op.index > n) throw new Error(`cell_index ${op.index} is out of range for insert (notebook has ${n} cells; use ${n} to append)`);
      if (typeof op.source !== 'string') throw new Error('source is required for insert');
      cells.splice(op.index, 0, newCell(op.cellType ?? 'code', op.source));
      return { notebook: { ...nb, cells }, description: `Inserted ${op.cellType ?? 'code'} cell at index ${op.index} (now ${cells.length} cells)` };
    }
    case 'replace': {
      if (op.index >= n) throw new Error(`cell_index ${op.index} is out of range (notebook has ${n} cells)`);
      if (typeof op.source !== 'string') throw new Error('source is required for replace');
      const old = cells[op.index];
      const type = op.cellType ?? old.cell_type;
      const cell: NotebookCell = { ...old, cell_type: type, source: toSourceLines(op.source) };
      if (type === 'code') {
        // Stale outputs would misrepresent the new code
        cell.outputs = [];
        cell.execution_count = null;
      } else {
        delete cell.outputs;
        delete cell.execution_count;
      }
      cells[op.index] = cell;
      return { notebook: { ...nb, cells }, description: `Replaced cell ${op.index} (${type})` };
    }
    case 'delete': {
      if (op.index >= n) throw new Error(`cell_index ${op.index} is out of range (notebook has ${n} cells)`);
      cells.splice(op.index, 1);
      return { notebook: { ...nb, cells }, description: `Deleted cell ${op.index} (now ${cells.length} cells)` };
    }
    default:
      throw new Error(`Unknown action '${String(op.action)}'`);
  }
}

/** nbformat convention: 1-space indent, trailing newline. */
export function serializeNotebook(nb: Notebook): string {
  return `${JSON.stringify(nb, null, 1)}\n`;
}

export interface NotebookError {
  index: number;
  ename: string;
  evalue: string;
  traceback: string;
}

export function notebookErrors(nb: Notebook): NotebookError[] {
  const errors: NotebookError[] = [];
  nb.cells.forEach((cell, index) => {
    for (const out of cell.outputs ?? []) {
      if (out.output_type === 'error') {
        errors.push({
          index,
          ename: out.ename ?? 'Error',
          evalue: out.evalue ?? '',
          traceback: (out.traceback ?? []).map(stripAnsi).slice(-15).join('\n'),
        });
      }
    }
  });
  return errors;
}
