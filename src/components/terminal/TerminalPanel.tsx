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
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
          <span className="term-prompt-icon">&gt;_</span>
          <span className="term-title">Interactive Terminal</span>
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
              title="Close Terminal"
              aria-label="Close"
            >
              ✕
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
        >
          ↵
        </button>
      </div>

      <style jsx>{`
        .terminal-panel-root {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          background: #0d1117;
          color: #c9d1d9;
          font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
          font-size: 12px;
          border-top: 1px solid var(--border-subtle, #30363d);
          overflow: hidden;
        }

        .terminal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px;
          background: #161b22;
          border-bottom: 1px solid #21262d;
          flex-shrink: 0;
          user-select: none;
        }

        .terminal-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .term-prompt-icon {
          color: var(--brand, #f97316);
          font-weight: 700;
          font-size: 13px;
        }

        .term-title {
          font-weight: 600;
          font-size: 12px;
          color: #e6edf3;
        }

        .term-pill {
          font-size: 10px;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(56, 189, 248, 0.15);
          color: #38bdf8;
          border: 1px solid rgba(56, 189, 248, 0.25);
        }

        .term-exec-indicator {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: #f59e0b;
        }

        .term-spin {
          width: 8px;
          height: 8px;
          border: 1.5px solid rgba(245, 158, 11, 0.3);
          border-top-color: #f59e0b;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .terminal-header-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .term-tool-btn {
          background: #21262d;
          color: #8b949e;
          border: 1px solid #30363d;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s ease;
        }

        .term-tool-btn:hover {
          color: #e6edf3;
          background: #30363d;
        }

        .term-close-btn {
          background: transparent;
          border: none;
          color: #8b949e;
          cursor: pointer;
          padding: 3px 6px;
          border-radius: 4px;
          font-size: 11px;
          transition: color 0.15s ease;
        }

        .term-close-btn:hover {
          color: #f85149;
          background: rgba(248, 81, 73, 0.1);
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
          line-height: 1.45;
          color: #c9d1d9;
        }

        .term-line--cmd {
          color: #58a6ff;
          font-weight: 600;
          margin-top: 4px;
        }

        .terminal-input-bar {
          display: flex;
          align-items: center;
          padding: 6px 12px;
          background: #161b22;
          border-top: 1px solid #21262d;
          gap: 8px;
          flex-shrink: 0;
        }

        .term-cursor-prompt {
          color: #3fb950;
          font-weight: 700;
          font-size: 13px;
        }

        .term-input {
          flex: 1;
          background: transparent;
          border: none;
          color: #f0f6fc;
          font-family: inherit;
          font-size: 12px;
          outline: none;
        }

        .term-input::placeholder {
          color: #484f58;
        }

        .term-send-btn {
          background: var(--brand, #f97316);
          color: white;
          border: none;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          opacity: 0.9;
          transition: opacity 0.15s ease;
        }

        .term-send-btn:hover:not(:disabled) {
          opacity: 1;
        }

        .term-send-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
