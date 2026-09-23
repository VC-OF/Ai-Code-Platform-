import React from 'react';

export type AgentStatus =
  | 'planning'
  | 'reading'
  | 'writing'
  | 'linting'
  | 'testing'
  | 'running'
  | 'waiting'
  | 'done'
  | 'error'
  | 'compacting';

interface StatusIndicatorProps {
  status: AgentStatus;
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  const configs: Record<AgentStatus, { label: string; tone: string; pulse: boolean }> = {
    planning:   { label: 'Planning', tone: 'active', pulse: true },
    reading:    { label: 'Reading Files', tone: 'info', pulse: true },
    writing:    { label: 'Writing Changes', tone: 'active', pulse: true },
    linting:    { label: 'Linting Code', tone: 'info', pulse: true },
    testing:    { label: 'Testing Suite', tone: 'info', pulse: true },
    running:    { label: 'Running Task', tone: 'active', pulse: true },
    waiting:    { label: 'Waiting for Your Answer', tone: 'warning', pulse: true },
    done:       { label: 'Idle', tone: 'neutral', pulse: false },
    error:      { label: 'Failed', tone: 'error', pulse: false },
    compacting: { label: 'Compacting Context', tone: 'info', pulse: true },
  };

  const config = configs[status] || configs.done;

  return (
    <div className={`status-indicator status-indicator--${config.tone} ${config.pulse ? 'status-indicator--pulse' : ''}`}>
      <span className="status-indicator__dot" />
      {config.label}
      <style jsx>{`
        .status-indicator {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 8px;
          border: 1px solid var(--border-base);
          border-radius: var(--radius-full);
          background: var(--bg-elevated);
          color: var(--text-secondary);
          font-size: var(--text-xs);
          font-weight: 600;
          line-height: 1.2;
        }
        .status-indicator--active { color: var(--brand); background: var(--brand-glow); border-color: var(--accent-border); }
        .status-indicator--info { color: var(--cyan); background: var(--cyan-soft); border-color: var(--accent-border); }
        .status-indicator--warning { color: var(--warning); background: var(--warning-dim); border-color: var(--accent-border); }
        .status-indicator--error { color: var(--error); background: var(--error-dim); border-color: var(--error); }
        .status-indicator__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
        .status-indicator--pulse .status-indicator__dot { animation: status-pulse 1.4s ease-in-out infinite; }
        @keyframes status-pulse { 50% { opacity: 0.35; } }
      `}</style>
    </div>
  );
}
