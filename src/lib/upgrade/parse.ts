import type { Risk } from './store';

/** Parsers for the structured JSON blocks agent stages end with. */

export function parseAnalysis(text: string): { analysis: string; affected_areas: string[]; proposed_plan: string[]; risk: Risk } {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const b of blocks.reverse()) {
    try {
      const j = JSON.parse(b[1]);
      if (j && typeof j === 'object' && (j.analysis || j.proposed_plan)) {
        const risk: Risk = ['low', 'medium', 'high'].includes(j.risk) ? j.risk : 'medium';
        const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : []);
        return { analysis: String(j.analysis ?? ''), affected_areas: arr(j.affected_areas), proposed_plan: arr(j.proposed_plan), risk };
      }
    } catch {}
  }
  return { analysis: text.trim(), affected_areas: [], proposed_plan: [], risk: 'medium' };
}

export function parseReview(text: string): { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; findings: string } {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const b of blocks.reverse()) {
    try {
      const j = JSON.parse(b[1]);
      const v = String(j.verdict ?? '').toUpperCase();
      if (v === 'PASS' || v === 'FAIL' || v === 'INCONCLUSIVE') {
        const f = Array.isArray(j.findings) ? j.findings.map((x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') : String(j.findings ?? '');
        return { verdict: v, findings: f };
      }
    } catch {}
  }
  return { verdict: 'INCONCLUSIVE', findings: `Reviewer gave no machine-readable verdict.\n\n${text.slice(0, 4000)}` };
}
