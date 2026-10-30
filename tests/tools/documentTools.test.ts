import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeDocumentTool, parseMarkdown, inlineRuns } from '@/lib/documentTools';
import { validateTool } from '@/lib/toolValidator';

let ws: string;
beforeAll(() => { ws = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-docs-')); });
afterAll(() => fs.rmSync(ws, { recursive: true, force: true }));

const REPORT = `# Findings

Revenue grew **18%** year over year.

- Faster onboarding
- Lower churn

1. Hire
2. Ship

| Region | Growth |
|---|---|
| EU | 12% |
| US | 21% |
`;

describe('parseMarkdown', () => {
  it('turns headings, paragraphs, lists and tables into blocks', () => {
    expect(parseMarkdown(REPORT).map((b) => b.kind)).toEqual([
      'heading', 'paragraph', 'bullet', 'bullet', 'bullet', 'bullet', 'table',
    ]);
    const table = parseMarkdown(REPORT).at(-1);
    expect(table).toEqual({ kind: 'table', rows: [['Region', 'Growth'], ['EU', '12%'], ['US', '21%']] });
  });

  it('keeps bold runs', () => {
    expect(inlineRuns('grew **18%** fast')).toEqual([
      { text: 'grew ', bold: false }, { text: '18%', bold: true }, { text: ' fast', bold: false },
    ]);
  });
});

describe('create_document', () => {
  const magic = (file: string) => fs.readFileSync(path.join(ws, file)).subarray(0, 4).toString('latin1');

  it.each([
    ['docx', { content: REPORT }, 'PK\u0003\u0004'],
    ['pdf', { content: REPORT }, '%PDF'],
    ['pptx', { slides: [{ title: 'Plan', bullets: ['One', 'Two'], notes: 'Say hi' }] }, 'PK\u0003\u0004'],
    ['xlsx', { sheets: [{ name: 'Data', rows: [['Region', 'Growth'], ['EU', 0.12], ['US', 0.21]] }] }, 'PK\u0003\u0004'],
  ])('writes a valid %s file with a download link', async (format, extra, header) => {
    const res = await executeDocumentTool('create_document', { format, title: 'Q3 Report', ...extra }, ws, 'proj_x');
    expect(res.success, res.output).toBe(true);
    const rel = `documents/q3-report.${format}`;
    expect(res.changedFile).toBe(rel);
    expect(res.output).toContain(`/api/download?projectId=proj_x&path=${encodeURIComponent(rel)}`);
    expect(magic(rel)).toBe(header);
  }, 30_000);

  it('adds the extension to a custom path and rejects escaping the workspace', async () => {
    const ok = await executeDocumentTool('create_document', { format: 'pdf', title: 'x', path: 'out/summary', content: 'Hi' }, ws, 'p');
    expect(ok.changedFile).toBe('out/summary.pdf');
    const bad = await executeDocumentTool('create_document', { format: 'pdf', title: 'x', path: '../escape.pdf', content: 'Hi' }, ws, 'p');
    expect(bad.success).toBe(false);
    expect(fs.existsSync(path.join(ws, '..', 'escape.pdf'))).toBe(false);
  });

  it('requires the content field that matches the format', async () => {
    const res = await executeDocumentTool('create_document', { format: 'pptx', title: 'Deck', content: 'text only' }, ws, 'p');
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/pptx needs `slides`/);
    expect(validateTool('create_document', { format: 'xlsx', title: 'T', sheets: [{ name: 'S', rows: [[1]] }] }).ok).toBe(true);
  });
});
