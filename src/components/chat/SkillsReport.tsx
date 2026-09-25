'use client';

import { formatTokens } from './ContextReport';

export interface SkillsReportItem {
  name: string;
  description: string;
  source: string;
  group?: 'project' | 'global';
  listingTokens?: number;
  instructionTokens?: number;
}

function groupOf(s: SkillsReportItem): 'project' | 'global' {
  return s.group ?? (s.source.startsWith('global:') ? 'global' : 'project');
}

export default function SkillsReport({ skills }: { skills: SkillsReportItem[] }) {
  const groups = [
    { key: 'project', title: 'Project skills' },
    { key: 'global', title: 'Global skills' },
  ].map((g) => ({ ...g, items: skills.filter((s) => groupOf(s) === g.key) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="ctx-report">
      <div className="ctx-header">
        <span className="ctx-title">Skills</span>
        <span className="ctx-muted">{skills.length} available · loaded on demand</span>
      </div>
      {skills.length === 0 ? (
        <p className="ctx-muted skl-empty">
          No skills yet. Add a SKILL.md under <code className="ctx-mono">.agents/skills/&lt;name&gt;/</code> in this project.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="skl-group">
            <h4 className="skl-group-title">{g.title}</h4>
            <ul>
              {g.items.map((s) => (
                <li key={s.name} className="skl-row" title={s.source}>
                  <span className="ctx-mono ctx-name">{s.name}</span>
                  <span className="ctx-muted skl-desc">{s.description}</span>
                  <span
                    className="ctx-mono ctx-muted"
                    title={s.instructionTokens != null ? `Full instructions: ${formatTokens(s.instructionTokens)} tokens` : undefined}
                  >
                    {s.listingTokens != null ? formatTokens(s.listingTokens) : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
