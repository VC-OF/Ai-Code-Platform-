'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface TerminalPanelProps {
  projectId: string;
  onClose?: () => void;
}

export default function TerminalPanel({ projectId, onClose }: TerminalPanelProps) {
  const [logs, setLogs] = useState<string[]>([
    'Open Code Interactive Terminal initialized.',
    `Workspace root: projects/${projectId}`,
    'Type any shell command (e.g. npm test, cargo check, ls, git status) and press Enter.\n'
  ]);
  const [commandInput, setCommandInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    logsEndRef.current?.scrollIntoView({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runCommand = async (cmdToRun?: string) => {
    const cmd = (cmdToRun ?? commandInput).trim();
    if (!cmd || executing) return;

    setCommandInput('');
    setExecuting(true);
    setHistory((prev) => [cmd, ...prev.filter((c) => c !== cmd)]);
    setHistoryIdx(-1);

    setLogs((prev) => [...prev, `$ ${cmd}`]);

    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, projectId }),
      });
      const data = await res.json();

      let out = '';
      if (data.stdout) out += data.stdout;
      if (data.stderr) out += (out ? '\n' : '') + data.stderr;
      if (data.error) out += (out ? '\n' : '') + `Error: ${data.error}`;
      if (!out) out = 'Process exited with code 0 (no output)';

      setLogs((prev) => [...prev, out]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `Execution error: ${msg}`]);
    } finally {
      setExecuting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(nextIdx);
        setCommandInput(history[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setCommandInput(history[nextIdx]);
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setCommandInput('');
      }
    }
  };

  return (
    <div className="terminal-panel-root">
      {/* Header Bar */}
      <div className="terminal-header">
        <div className="terminal-header-left">
          <svg className="term-prompt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14} aria-hidden="true">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span className="term-title">Terminal</span>
          <span className="term-pill">node:20</span>
          {executing && (
            <span className="term-exec-indicator">
              <span className="term-spin" />
              Running…
            </span>
          )}
        </div>
        <div className="terminal-header-right">
          <button
            type="button"
            className="term-tool-btn"
            onClick={() => runCommand('git status')}
            title="Run git status"
          >
            git status
          </button>
          <button
            type="button"
            className="term-tool-btn"
            onClick={() => runCommand('ls -la')}
            title="List files"
          >
            ls
          </button>
          <button
            type="button"
            className="term-tool-btn"
            onClick={() => setLogs([])}
            title="Clear terminal output"
          >
            Clear
          </button>
          {onClose && (
            <button
              type="button"
              className="term-close-btn"
              onClick={onClose}
              title="Close terminal"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width={12} height={12} aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Terminal Output */}
      <div className="terminal-body" onClick={() => inputRef.current?.focus()}>
        {logs.map((log, idx) => (
          <div key={idx} className={`term-line ${log.startsWith('$') ? 'term-line--cmd' : ''}`}>
            {log}
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>

      {/* Input row */}
      <div className="terminal-input-bar">
        <span className="term-cursor-prompt">$</span>
        <input
          ref={inputRef}
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={executing}
          placeholder={executing ? 'Command is running…' : 'Type shell command… (Enter to run, ↑/↓ for history)'}
          className="term-input"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => runCommand()}
          disabled={executing || !commandInput.trim()}
          className="term-send-btn"
          title="Run command"
          aria-label="Run command"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={12} height={12} aria-hidden="true">
            <polyline points="9 10 4 15 9 20" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
          </svg>
        </button>
      </div>

      <style jsx>{`
        .terminal-panel-root {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          background: var(--bg-base);
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 12px;
          border-top: 1px solid var(--border-subtle);
          overflow: hidden;
        }

        .terminal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          user-select: none;
          font-family: var(--font-sans);
        }

        .terminal-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .term-prompt-icon {
          color: var(--text-muted);
        }

        .term-title {
          font-weight: 500;
          font-size: 12px;
          color: var(--text-primary);
        }

        .term-pill {
          font-family: var(--font-mono);
          font-size: 11px;
          padding: 1px 6px;
          border-radius: var(--radius-sm);
          background: var(--bg-elevated);
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
        }

        .term-exec-indicator {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .term-spin {
          width: 8px;
          height: 8px;
          border: 1.5px solid var(--border-strong);
          border-top-color: var(--text-secondary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .terminal-header-right {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .term-tool-btn {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          padding: 2px 8px;
          font-size: 12px;
          cursor: pointer;
          font-family: var(--font-mono);
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .term-tool-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .term-close-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: var(--radius-md);
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .term-close-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .terminal-body {
          flex: 1;
          overflow-y: auto;
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          cursor: text;
        }

        .term-line {
          white-space: pre-wrap;
          word-break: break-all;
          line-height: 1.5;
          color: var(--text-secondary);
        }

        .term-line--cmd {
          color: var(--text-primary);
          font-weight: 600;
          margin-top: 4px;
        }

        .terminal-input-bar {
          display: flex;
          align-items: center;
          padding: 6px 12px;
          background: var(--bg-surface);
          border-top: 1px solid var(--border-subtle);
          gap: 8px;
          flex-shrink: 0;
        }

        .term-cursor-prompt {
          color: var(--text-muted);
          font-weight: 600;
          font-size: 12px;
        }

        .term-input {
          flex: 1;
          background: transparent;
          border: none;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 12px;
          outline: none;
        }

        .term-input::placeholder {
          color: var(--text-muted);
        }

        .term-send-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent);
          color: var(--text-on-accent);
          border: 1px solid var(--accent);
          border-radius: var(--radius-md);
          padding: 4px 8px;
          cursor: pointer;
          transition: background var(--transition-fast);
        }

        .term-send-btn:hover:not(:disabled) {
          background: var(--accent-dim);
        }

        .term-send-btn:disabled {
          background: var(--bg-elevated);
          border-color: var(--border-base);
          color: var(--text-disabled);
          cursor: not-allowed;
        }

        .term-tool-btn:focus-visible,
        .term-close-btn:focus-visible,
        .term-send-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        .terminal-input-bar:focus-within {
          box-shadow: inset 0 1px 0 var(--border-strong);
        }

        @media (prefers-reduced-motion: reduce) {
          .term-spin {
            animation: none;
          }
          .term-tool-btn,
          .term-close-btn,
          .term-send-btn {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
