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
  elapsedSeconds?: number;
}

export function StatusIndicator({ status, elapsedSeconds }: StatusIndicatorProps) {
  const configs: Record<AgentStatus, { label: string; tone: string; pulse: boolean; icon: 'spin' | 'dot' | 'warn' | 'error' }> = {
    planning:   { label: 'Planning', tone: 'active', pulse: true, icon: 'spin' },
    reading:    { label: 'Reading files', tone: 'info', pulse: true, icon: 'spin' },
    writing:    { label: 'Writing changes', tone: 'active', pulse: true, icon: 'spin' },
    linting:    { label: 'Linting code', tone: 'info', pulse: true, icon: 'spin' },
    testing:    { label: 'Running tests', tone: 'info', pulse: true, icon: 'spin' },
    running:    { label: 'Running task', tone: 'active', pulse: true, icon: 'spin' },
    waiting:    { label: 'Waiting for your answer', tone: 'warning', pulse: true, icon: 'warn' },
    done:       { label: 'Idle', tone: 'neutral', pulse: false, icon: 'dot' },
    error:      { label: 'Failed', tone: 'error', pulse: false, icon: 'error' },
    compacting: { label: 'Compacting context', tone: 'info', pulse: true, icon: 'spin' },
  };

  const config = configs[status] || configs.done;

  return (
    <div className={`status-indicator status-indicator--${config.tone} ${config.pulse ? 'status-indicator--pulse' : ''}`}>
      {config.icon === 'spin' ? (
        <svg className="status-spinner" viewBox="0 0 16 16" fill="none" width={11} height={11}>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
          <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : (
        <span className="status-indicator__dot" />
      )}
      <span className="status-indicator__label">{config.label}</span>
      {typeof elapsedSeconds === 'number' && elapsedSeconds > 0 && (
        <span className="status-indicator__time">
          ({Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')})
        </span>
      )}
      <style jsx>{`
        .status-indicator {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 2px 8px;
          border: 1px solid var(--border-base);
          border-radius: var(--radius-full);
          background: var(--bg-elevated);
          color: var(--text-secondary);
          font-size: var(--text-xs);
          font-weight: 500;
          line-height: 1.3;
          transition: color var(--transition-fast), border-color var(--transition-fast);
        }
        .status-indicator--active { color: var(--accent); }
        .status-indicator--info { color: var(--text-secondary); }
        .status-indicator--warning { color: var(--warning); background: var(--warning-dim); }
        .status-indicator--error { color: var(--error); background: var(--error-dim); }
        .status-spinner {
          animation: status-spin 0.9s linear infinite;
          flex-shrink: 0;
        }
        .status-indicator__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex-shrink: 0;
        }
        .status-indicator--pulse .status-indicator__dot {
          animation: status-pulse 1.6s ease-in-out infinite;
        }
        .status-indicator__time {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: var(--text-muted);
        }
        @keyframes status-spin {
          100% { transform: rotate(360deg); }
        }
        @keyframes status-pulse {
          50% { opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
          .status-spinner, .status-indicator--pulse .status-indicator__dot { animation-duration: 2.4s; }
        }
      `}</style>
    </div>
  );
}
