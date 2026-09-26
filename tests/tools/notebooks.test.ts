import { describe, it, expect } from 'vitest';
import {
  parseNotebook,
  formatNotebook,
  formatOutputs,
  editNotebook,
  serializeNotebook,
  notebookErrors,
  emptyNotebook,
  cellSource,
  newCell,
  stripAnsi,
} from '@/lib/notebooks';

const NB = {
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Title\n', 'Intro'] },
    {
      cell_type: 'code',
      execution_count: 3,
      metadata: {},
      source: 'import numpy as np\nprint(np.pi)',
      outputs: [
        { output_type: 'stream', name: 'stdout', text: ['3.141592653589793\n'] },
        { output_type: 'execute_result', execution_count: 3, data: { 'text/plain': ['42'], 'image/png': 'iVBOR...' } },
      ],
    },
    {
      cell_type: 'code',
      execution_count: 4,
      metadata: {},
      source: '1/0',
      outputs: [
        { output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: ['\u001b[31mTraceback\u001b[0m', 'ZeroDivisionError: division by zero'] },
      ],
    },
  ],
  metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' } },
  nbformat: 4,
  nbformat_minor: 5,
};

describe('notebooks', () => {
  it('parses and renders cells with outputs', () => {
    const nb = parseNotebook(JSON.stringify(NB));
    const text = formatNotebook(nb);
    expect(text).toContain('Notebook: 3 cells');
    expect(text).toContain('kernel python3');
    expect(text).toContain('## Cell 0 [markdown]');
    expect(text).toContain('# Title\nIntro');
    expect(text).toContain('## Cell 1 [code] In[3]');
    expect(text).toContain('[stdout]\n3.141592653589793');
    expect(text).toContain('[Out[3]] (image/png)\n42');
    expect(text).toContain('[error] ZeroDivisionError: division by zero');
    expect(text).not.toContain('\u001b[31m'); // ANSI stripped
  });

  it('rejects non-notebooks', () => {
    expect(() => parseNotebook('{"cells": "x"}')).toThrow(/missing "cells"/);
    expect(() => parseNotebook('not json')).toThrow(/JSON parse failed/);
  });

  it('formats outputs and strips ANSI', () => {
    expect(stripAnsi('\u001b[1;31mred\u001b[0m')).toBe('red');
    expect(formatOutputs(undefined)).toBe('');
    expect(formatOutputs([{ output_type: 'display_data', data: { 'image/svg+xml': '<svg/>' } }])).toBe('[display] (image/svg+xml)');
  });

  it('inserts, replaces and deletes cells', () => {
    let nb = emptyNotebook();
    ({ notebook: nb } = editNotebook(nb, { action: 'insert', index: 0, cellType: 'markdown', source: '# Hello' }));
    ({ notebook: nb } = editNotebook(nb, { action: 'insert', index: 1, source: 'x = 1\nprint(x)\n' }));
    expect(nb.cells.map((c) => c.cell_type)).toEqual(['markdown', 'code']);
    expect(cellSource(nb.cells[1])).toBe('x = 1\nprint(x)\n');
    expect(nb.cells[1].outputs).toEqual([]);
    expect(nb.cells[1].id).toMatch(/^[0-9a-f]{8}$/);

    // Replace clears stale outputs
    nb.cells[1].outputs = [{ output_type: 'stream', name: 'stdout', text: '1' }];
    nb.cells[1].execution_count = 7;
    const replaced = editNotebook(nb, { action: 'replace', index: 1, source: 'x = 2' });
    expect(replaced.description).toBe('Replaced cell 1 (code)');
    expect(replaced.notebook.cells[1].outputs).toEqual([]);
    expect(replaced.notebook.cells[1].execution_count).toBeNull();
    expect(cellSource(replaced.notebook.cells[1])).toBe('x = 2');

    // Replacing a code cell as markdown drops code-only fields
    const md = editNotebook(replaced.notebook, { action: 'replace', index: 1, cellType: 'markdown', source: 'note' });
    expect(md.notebook.cells[1]).not.toHaveProperty('outputs');

    const deleted = editNotebook(md.notebook, { action: 'delete', index: 0 });
    expect(deleted.notebook.cells).toHaveLength(1);
    expect(deleted.description).toBe('Deleted cell 0 (now 1 cells)');
  });

  it('validates indexes and required fields', () => {
    const nb = parseNotebook(JSON.stringify(NB));
    expect(() => editNotebook(nb, { action: 'replace', index: 3, source: 'x' })).toThrow(/out of range/);
    expect(() => editNotebook(nb, { action: 'insert', index: 4, source: 'x' })).toThrow(/use 3 to append/);
    expect(() => editNotebook(nb, { action: 'delete', index: -1 })).toThrow(/non-negative/);
    expect(() => editNotebook(nb, { action: 'replace', index: 0 })).toThrow(/source is required/);
  });

  it('serializes round-trippably with nbformat conventions', () => {
    const nb = parseNotebook(JSON.stringify(NB));
    const text = serializeNotebook(nb);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.startsWith('{\n "cells"')).toBe(true);
    expect(parseNotebook(text).cells).toHaveLength(3);
    expect(cellSource(newCell('code', 'a\nb'))).toBe('a\nb');
  });

  it('collects execution errors per cell', () => {
    const errors = notebookErrors(parseNotebook(JSON.stringify(NB)));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 2, ename: 'ZeroDivisionError', evalue: 'division by zero' });
    expect(errors[0].traceback).toContain('Traceback');
    expect(errors[0].traceback).not.toContain('\u001b');
  });
});
