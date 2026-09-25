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
  { category: 'Search',       tool: 'list_files',    scope: 'workspace', desc: 'List files and folders inside the workspace directory' },
  { category: 'Web',          tool: 'web_search',    scope: 'network',   desc: 'Search the web for docs, examples, or error messages' },
  { category: 'Web',          tool: 'fetch_url',     scope: 'network',   desc: 'Fetch a public URL as readable text (private IPs blocked)' },
  { category: 'Media',        tool: 'generate_image', scope: 'network',  desc: 'Generate an image (Flux via Pollinations/HF) into the workspace' },
  { category: 'Shell',        tool: 'run_command',   scope: 'sandbox',   desc: 'Run an allowlisted command (npm, node, git, …) — no shell operators' },
  { category: 'Verification', tool: 'run_lint',      scope: 'sandbox',   desc: 'Run TypeScript + ESLint checks and report errors' },
  { category: 'Verification', tool: 'run_tests',     scope: 'sandbox',   desc: 'Run the project test suite and capture results' },
  { category: 'Verification', tool: 'read_preview_logs', scope: 'workspace', desc: 'Read the dev server logs to diagnose runtime errors' },
  { category: 'Verification', tool: 'fetch_preview', scope: 'workspace', desc: 'Fetch the rendered preview page to confirm it works' },
  { category: 'Verification', tool: 'check_preview', scope: 'workspace', desc: 'Load the preview in a real browser — console errors + screenshot' },
  { category: 'Browser',      tool: 'browser_open',       scope: 'network',   desc: 'Open the project preview (or a public URL) in the built-in browser' },
  { category: 'Browser',      tool: 'browser_snapshot',   scope: 'network',   desc: 'Read page text and an outline of elements with clickable refs' },
  { category: 'Browser',      tool: 'browser_click',      scope: 'network',   desc: 'Click an element by ref' },
  { category: 'Browser',      tool: 'browser_type',       scope: 'network',   desc: 'Fill a field by ref, optionally pressing Enter' },
  { category: 'Browser',      tool: 'browser_press',      scope: 'network',   desc: 'Press a key or chord (Enter, Escape, Tab…)' },
  { category: 'Browser',      tool: 'browser_select',     scope: 'network',   desc: 'Choose options in a select by ref' },
  { category: 'Browser',      tool: 'browser_scroll',     scope: 'network',   desc: 'Scroll the page up/down/top/bottom' },
  { category: 'Browser',      tool: 'browser_wait',       scope: 'network',   desc: 'Wait for text to appear or a fixed delay (≤15s)' },
  { category: 'Browser',      tool: 'browser_console',    scope: 'network',   desc: 'Console messages, page errors and failed requests since last read' },
  { category: 'Browser',      tool: 'browser_screenshot', scope: 'workspace', desc: 'Save a PNG screenshot to .open-code/screenshots/' },
  { category: 'Browser',      tool: 'browser_close',      scope: 'network',   desc: 'Close the built-in browser' },
  { category: 'Interaction',  tool: 'load_skill',    scope: 'workspace', desc: 'Load a skill\'s full instructions on demand' },
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
          <h3 className="tm-title">Tools</h3>
          <button className="tm-close" onClick={onClose} title="Close" aria-label="Close">✕</button>
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
                  <th>Category</th>
                  <th>Tool</th>
                  <th>Scope</th>
                  <th>Description</th>
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
            <div className="tm-info-lbl">Execution model</div>
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
          background: rgba(20, 20, 19, 0.4);
          z-index: 300;
        }

        .tm-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: min(680px, calc(100vw - 32px));
          max-height: 82vh;
          z-index: 301;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
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
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .tm-close:hover { color: var(--text-primary); background: var(--bg-overlay); }

        .tm-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* Step navigator */
        .tm-steps {
          display: flex;
          background: var(--bg-base);
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
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .tm-step:last-child { border-right: none; }
        .tm-step:hover { background: var(--bg-hover); }

        .tm-step.tm-step--active { background: var(--bg-overlay); box-shadow: inset 0 0 0 1px var(--border-strong); }
        .tm-step:focus-visible, .tm-close:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

        .tm-step-n {
          width: 22px;
          height: 22px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          color: var(--text-muted);
        }
        .tm-step--active .tm-step-n {
          border-color: var(--border-strong);
          color: var(--text-primary);
        }

        .tm-step-lbl { font-size: 12px; color: var(--text-muted); }
        .tm-step--active .tm-step-lbl { color: var(--text-primary); }

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
          background: var(--bg-elevated);
          color: var(--text-muted);
          font-size: 11.5px;
          font-weight: 500;
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
        .tm-tbl tr:hover td { background: var(--bg-hover); }

        .tm-cat  { color: var(--text-secondary); font-weight: 500; font-size: 11px; white-space: nowrap; }

        .tm-tool-name {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-primary);
          background: var(--bg-elevated);
          padding: 1px 6px;
          border-radius: 4px;
          white-space: nowrap;
        }

        .tm-scope {
          display: inline-block;
          padding: 2px 8px;
          border-radius: var(--radius-full);
          font-size: 11px;
          font-weight: 500;
          border: 1px solid var(--border-base);
        }
        .tm-scope--workspace { background: var(--bg-elevated); color: var(--text-secondary); }
        .tm-scope--sandbox   { background: var(--warning-dim); color: var(--warning); }
        .tm-scope--network   { background: var(--info-dim); color: var(--info); }
        .tm-scope--project   { background: var(--bg-elevated); color: var(--text-muted); }

        .tm-desc { font-size: 11px; color: var(--text-muted); }

        /* Info block */
        .tm-info {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 12px 14px;
          flex-shrink: 0;
        }
        .tm-info-lbl {
          font-size: 12px;
          color: var(--text-primary);
          font-weight: 600;
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
