'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { parseAnsi } from '@/lib/ansi';

interface TerminalPanelProps {
  projectId: string;
  onClose?: () => void;
}

interface LogEntry {
  id: string;
  type: 'cmd' | 'output' | 'info' | 'error';
  text: string;
  durationMs?: number;
  exitCode?: number;
}

export default function TerminalPanel({ projectId, onClose }: TerminalPanelProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'init-1',
      type: 'info',
      text: 'PowerShell 7.5.0',
    },
    {
      id: 'init-2',
      type: 'info',
      text: `Loading personal and system profiles took 220ms.`,
    },
    {
      id: 'init-3',
      type: 'info',
      text: `PS C:\\${projectId.toUpperCase()}>`,
    },
  ]);
  const [commandInput, setCommandInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [lastDuration, setLastDuration] = useState<number | null>(null);
  const [lastCode, setLastCode] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
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

    const cmdId = 'cmd_' + Date.now();
    setLogs((prev) => [
      ...prev,
      { id: cmdId, type: 'cmd', text: `$ ${cmd}` },
    ]);

    const startTime = performance.now();

    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, projectId }),
      });
      const durationMs = Math.round(performance.now() - startTime);
      setLastDuration(durationMs);

      const data = await res.json();
      const exitCode = res.ok && data.success ? 0 : 1;
      setLastCode(exitCode);

      let out = '';
      if (data.stdout) out += data.stdout;
      if (data.stderr) out += (out ? '\n' : '') + data.stderr;
      if (data.error) out += (out ? '\n' : '') + `Error: ${data.error}`;
      if (!out) out = 'Process exited with code 0 (no output)';

      setLogs((prev) => [
        ...prev,
        {
          id: 'out_' + Date.now(),
          type: exitCode === 0 ? 'output' : 'error',
          text: out,
          durationMs,
          exitCode,
        },
      ]);
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - startTime);
      setLastDuration(durationMs);
      setLastCode(1);
      const msg = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [
        ...prev,
        {
          id: 'err_' + Date.now(),
          type: 'error',
          text: `Execution error: ${msg}`,
          durationMs,
          exitCode: 1,
        },
      ]);
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
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      setLogs([]);
    }
  };

  const copyTerminalOutput = () => {
    const text = logs.map((l) => l.text).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={`terminal-panel-root ${isMaximized ? 'terminal-panel-root--maximized' : ''}`}>
      {/* Header Bar */}
      <div className="terminal-header">
        <div className="terminal-header-left">
          <div className="term-tab-active">
            <span className="term-tab-title">Terminal</span>
            <button
              type="button"
              className="term-tab-add"
              onClick={() => {
                setLogs((prev) => [
                  ...prev,
                  { id: 'tab_' + Date.now(), type: 'info', text: `PS C:\\${projectId.toUpperCase()}>` },
                ]);
              }}
              title="New terminal tab"
            >
              +
            </button>
          </div>
          {executing ? (
            <span className="term-exec-indicator">
              <span className="term-spin" />
              Running…
            </span>
          ) : lastDuration !== null ? (
            <span className="text-[11px] text-[#8b877c]">
              {lastDuration}ms {lastCode === 0 ? '✓' : `(exit ${lastCode})`}
            </span>
          ) : null}
        </div>
        <div className="terminal-header-right">
          <button
            type="button"
            className="term-action-icon"
            onClick={copyTerminalOutput}
            title={copied ? "Copied!" : "Copy output (Ctrl+C)"}
            aria-label={copied ? "Copied" : "Copy output"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
              <circle cx="12" cy="5" r="1.5" fill="currentColor" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              <circle cx="12" cy="19" r="1.5" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="term-action-icon"
            onClick={() => setIsMaximized((m) => !m)}
            title={isMaximized ? 'Restore size' : 'Maximize terminal'}
            aria-label={isMaximized ? 'Restore size' : 'Maximize terminal'}
          >
            {isMaximized ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
          {onClose && (
            <button
              type="button"
              className="term-action-icon"
              onClick={onClose}
              title="Close terminal"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width={13} height={13}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Terminal Output */}
      <div className="terminal-body" onClick={() => inputRef.current?.focus()}>
        {logs.map((log) => {
          if (log.type === 'cmd') {
            return (
              <div key={log.id} className="term-line term-line--cmd">
                {log.text}
              </div>
            );
          }

          const spans = parseAnsi(log.text);
          return (
            <div
              key={log.id}
              className={`term-line ${log.type === 'error' ? 'term-line--err' : ''}`}
            >
              {spans.map((s, idx) => (
                <span
                  key={idx}
                  style={{
                    color: s.color,
                    fontWeight: s.bold ? 600 : 'normal',
                    opacity: s.dim ? 0.75 : 1,
                  }}
                >
                  {s.text}
                </span>
              ))}
            </div>
          );
        })}
        <div ref={logsEndRef} />
      </div>

      {/* Input row */}
      <div className="terminal-input-bar">
        <span className="term-cursor-prompt">PS C:\{projectId.toUpperCase()}&gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={executing}
          placeholder=""
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
          background: #181816;
          color: #ede8de;
          font-family: var(--font-mono, monospace);
          font-size: 12px;
          border-top: 1px solid var(--border-subtle);
          overflow: hidden;
        }

        .terminal-panel-root--maximized {
          position: fixed;
          inset: 52px 16px 16px 16px;
          z-index: 50;
          border-radius: 16px;
          border: 1px solid #383632;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
        }

        .terminal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px;
          background: #201f1c;
          border-bottom: 1px solid #2e2d29;
          flex-shrink: 0;
          user-select: none;
          font-family: var(--font-sans);
        }

        .terminal-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .term-tab-active {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 8px;
          border-radius: 6px;
          background: #2a2926;
          color: #ede8de;
          font-size: 12px;
          font-weight: 500;
        }

        .term-tab-title {
          font-size: 12px;
          font-weight: 500;
          color: #ede8de;
        }

        .term-tab-add {
          background: transparent;
          border: none;
          color: #9c978b;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 0 2px;
          border-radius: 4px;
          transition: color 0.15s;
        }

        .term-tab-add:hover {
          color: #ede8de;
        }

        .term-exec-indicator {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11.5px;
          color: #9c978b;
        }

        .term-spin {
          width: 8px;
          height: 8px;
          border: 1.5px solid #737067;
          border-top-color: #ede8de;
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

        .term-action-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: #9c978b;
          cursor: pointer;
          padding: 5px;
          border-radius: 5px;
          transition: background 0.15s, color 0.15s;
        }

        .term-action-icon:hover {
          color: #ede8de;
          background: #2e2d29;
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

        .term-line--err {
          color: #fca5a5;
        }

        .terminal-input-bar {
          display: flex;
          align-items: center;
          padding: 6px 12px;
          background: #201f1c;
          border-top: 1px solid #2e2d29;
          gap: 8px;
          flex-shrink: 0;
        }

        .term-cursor-prompt {
          color: #9c978b;
          font-weight: 600;
          font-size: 12px;
        }

        .term-input {
          flex: 1;
          background: transparent;
          border: none;
          color: #ede8de;
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
