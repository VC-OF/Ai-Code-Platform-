'use client';

import { useState } from 'react';

interface ToolModalProps {
  onClose: () => void;
}

type Step = 'plan' | 'execute' | 'review';
const STEPS: Array<{ id: Step; label: string; num: number }> = [
  { id: 'plan',    label: 'Plan',    num: 1 },
  { id: 'execute', label: 'Execute', num: 2 },
  { id: 'review',  label: 'Review',  num: 3 },
];

const TOOLS = [
  { category: 'File System',  tool: 'list_files',    scope: 'workspace', desc: 'List files and folders at a path' },
  { category: 'File System',  tool: 'read_file',     scope: 'workspace', desc: 'Read the full content of a file' },
  { category: 'File System',  tool: 'create_file',   scope: 'workspace', desc: 'Create or overwrite a file with the given content' },
  { category: 'File System',  tool: 'edit_file',     scope: 'workspace', desc: 'Replace a unique text snippet (requires a fresh read first)' },
  { category: 'File System',  tool: 'replace_lines', scope: 'workspace', desc: 'Replace a 1-indexed line range with new content' },
  { category: 'File System',  tool: 'delete_file',   scope: 'workspace', desc: 'Remove a file from the workspace' },
  { category: 'Search',       tool: 'grep_files',    scope: 'workspace', desc: 'Regex search across workspace files with line numbers' },
  { category: 'Search',       tool: 'glob_files',    scope: 'workspace', desc: 'Find files matching a glob pattern' },
  { category: 'Web',          tool: 'web_search',    scope: 'network',   desc: 'Search the web for docs, examples, or error messages' },
  { category: 'Web',          tool: 'fetch_url',     scope: 'network',   desc: 'Fetch a public URL as readable text (private IPs blocked)' },
  { category: 'Media',        tool: 'generate_image', scope: 'network',  desc: 'Generate an image (Flux via Pollinations/HF) into the workspace' },
  { category: 'Shell',        tool: 'run_command',   scope: 'sandbox',   desc: 'Run an allowlisted command (npm, node, git, …) — no shell operators' },
  { category: 'Verification', tool: 'run_lint',      scope: 'sandbox',   desc: 'Run TypeScript + ESLint checks and report errors' },
  { category: 'Verification', tool: 'run_tests',     scope: 'sandbox',   desc: 'Run the project test suite and capture results' },
  { category: 'Verification', tool: 'read_preview_logs', scope: 'workspace', desc: 'Read the dev server logs to diagnose runtime errors' },
  { category: 'Verification', tool: 'fetch_preview', scope: 'workspace', desc: 'Fetch the rendered preview page to confirm it works' },
  { category: 'Verification', tool: 'check_preview', scope: 'workspace', desc: 'Load the preview in a real browser — console errors + screenshot' },
  { category: 'Interaction',  tool: 'ask_user',      scope: 'workspace', desc: 'Pause and ask you a clarifying question mid-run' },
  { category: 'Interaction',  tool: 'update_plan',   scope: 'workspace', desc: 'Maintain a persistent task plan shown in chat, resumable across turns' },
  { category: 'Deploy',       tool: 'deploy_app',    scope: 'network',   desc: 'Deploy the workspace to Vercel (needs VERCEL_TOKEN)' },
];

export default function ToolModal({ onClose }: ToolModalProps) {
  const [activeStep, setActiveStep] = useState<Step>('plan');

  return (
    <>
      {/* Backdrop */}
      <div className="tm-backdrop" onClick={onClose} />

      {/* Modal */}
      <div className="tm-modal animate-slide-up">
        {/* Header */}
        <div className="tm-head">
          <h3 className="tm-title">Tool Configuration</h3>
          <button className="tm-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="tm-body">
          {/* Step navigator */}
          <div className="tm-steps">
            {STEPS.map((s) => (
              <button
                key={s.id}
                className={`tm-step ${activeStep === s.id ? 'tm-step--active' : ''}`}
                onClick={() => setActiveStep(s.id)}
              >
                <span className="tm-step-n">{s.num}</span>
                <span className="tm-step-lbl">{s.label}</span>
              </button>
            ))}
          </div>

          {/* Tool permissions table */}
          <div className="tm-tbl-wrap">
            <table className="tm-tbl">
              <thead>
                <tr>
                  <th>CATEGORY</th>
                  <th>TOOL</th>
                  <th>SCOPE</th>
                  <th>DESCRIPTION</th>
                </tr>
              </thead>
              <tbody>
                {TOOLS.map((t, i) => (
                  <tr key={i}>
                    <td className="tm-cat">{t.category}</td>
                    <td><code className="tm-tool-name">{t.tool}</code></td>
                    <td>
                      <span className={`tm-scope tm-scope--${t.scope}`}>{t.scope}</span>
                    </td>
                    <td className="tm-desc">{t.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Execution model info */}
          <div className="tm-info">
            <div className="tm-info-lbl">EXECUTION MODEL</div>
            <p className="tm-info-txt">
              Tools run sequentially inside a <strong>path-jailed workspace</strong>.
              File writes are git-checkpointed before and after each turn, and the agent
              must run lint or tests before finishing a turn that changed code. Shell
              commands are limited to an allowlist of binaries with timeouts and output
              caps. All actions are logged and reversible via checkpoints.
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        .tm-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          z-index: 300;
        }

        .tm-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 680px;
          max-height: 82vh;
          z-index: 301;
          background: rgba(18, 18, 23, 0.95);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-xl);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: var(--shadow-lg);
        }

        .tm-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 22px;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(255,255,255,0.02);
          flex-shrink: 0;
        }

        .tm-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .tm-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 16px;
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          transition: all var(--transition-fast);
        }
        .tm-close:hover { color: var(--text-primary); background: var(--bg-overlay); }

        .tm-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px 22px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* Step navigator */
        .tm-steps {
          display: flex;
          background: rgba(0,0,0,0.2);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          overflow: hidden;
          flex-shrink: 0;
        }

        .tm-step {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          padding: 12px;
          border: none;
          border-right: 1px solid var(--border-subtle);
          background: none;
          cursor: pointer;
          transition: all var(--transition-fast);
        }
        .tm-step:last-child { border-right: none; }
        .tm-step:hover { background: rgba(255,255,255,0.03); }

        .tm-step--active { background: rgba(0,122,255,0.08) !important; }

        .tm-step-n {
          width: 22px;
          height: 22px;
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--border-base);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          color: var(--text-muted);
        }
        .tm-step--active .tm-step-n {
          background: var(--brand-glow);
          border-color: rgba(0,122,255,0.4);
          color: var(--brand);
        }

        .tm-step-lbl { font-size: 10.5px; color: var(--text-muted); }
        .tm-step--active .tm-step-lbl { color: var(--brand); }

        /* Tool table */
        .tm-tbl-wrap {
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          overflow: hidden;
        }

        .tm-tbl {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        .tm-tbl th {
          text-align: left;
          padding: 8px 12px;
          background: rgba(255,255,255,0.03);
          color: var(--text-muted);
          font-size: 9px;
          letter-spacing: 0.07em;
          font-weight: 700;
          border-bottom: 1px solid var(--border-subtle);
        }

        .tm-tbl td {
          padding: 9px 12px;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          vertical-align: top;
          line-height: 1.5;
        }
        .tm-tbl tr:last-child td { border-bottom: none; }
        .tm-tbl tr:hover td { background: rgba(255,255,255,0.02); }

        .tm-cat  { color: var(--brand); font-weight: 500; font-size: 11px; white-space: nowrap; }

        .tm-tool-name {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--accent);
          background: rgba(100,210,255,0.08);
          padding: 1px 6px;
          border-radius: 4px;
          white-space: nowrap;
        }

        .tm-scope {
          display: inline-block;
          padding: 2px 8px;
          border-radius: var(--radius-full);
          font-size: 9.5px;
          font-weight: 600;
          border: 1px solid;
        }
        .tm-scope--workspace { background: rgba(48,209,88,0.08); border-color: rgba(48,209,88,0.25); color: var(--success); }
        .tm-scope--sandbox   { background: rgba(255,159,10,0.08); border-color: rgba(255,159,10,0.25); color: var(--warning); }
        .tm-scope--network   { background: rgba(100,210,255,0.08); border-color: rgba(100,210,255,0.25); color: var(--cyan); }
        .tm-scope--project   { background: rgba(152,144,227,0.08); border-color: rgba(152,144,227,0.25); color: var(--violet); }

        .tm-desc { font-size: 11px; color: var(--text-muted); }

        /* Info block */
        .tm-info {
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 12px 14px;
          flex-shrink: 0;
        }
        .tm-info-lbl {
          font-size: 8.5px;
          letter-spacing: 0.07em;
          color: var(--text-muted);
          font-weight: 700;
          margin-bottom: 6px;
        }
        .tm-info-txt {
          font-size: 11.5px;
          color: var(--text-secondary);
          line-height: 1.6;
        }
        .tm-info-txt strong { color: var(--text-primary); }
      `}</style>
    </>
  );
}
