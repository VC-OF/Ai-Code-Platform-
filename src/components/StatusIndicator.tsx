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
    reading:    { label: 'Reading Files', tone: 'info', pulse: true, icon: 'spin' },
    writing:    { label: 'Writing Changes', tone: 'active', pulse: true, icon: 'spin' },
    linting:    { label: 'Linting Code', tone: 'info', pulse: true, icon: 'spin' },
    testing:    { label: 'Testing Suite', tone: 'info', pulse: true, icon: 'spin' },
    running:    { label: 'Running Task', tone: 'active', pulse: true, icon: 'spin' },
    waiting:    { label: 'Waiting for Your Answer', tone: 'warning', pulse: true, icon: 'warn' },
    done:       { label: 'Idle', tone: 'neutral', pulse: false, icon: 'dot' },
    error:      { label: 'Failed', tone: 'error', pulse: false, icon: 'error' },
    compacting: { label: 'Compacting Context', tone: 'info', pulse: true, icon: 'spin' },
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
          padding: 3px 9px;
          border: 1px solid var(--border-base);
          border-radius: var(--radius-full);
          background: var(--bg-elevated);
          color: var(--text-secondary);
          font-size: var(--text-xs);
          font-weight: 600;
          line-height: 1.2;
          transition: all var(--transition-fast);
        }
        .status-indicator--active {
          color: var(--brand);
          background: var(--brand-glow);
          border-color: var(--accent-border);
          box-shadow: 0 0 8px rgba(255, 107, 0, 0.15);
        }
        .status-indicator--info {
          color: var(--cyan, #06b6d4);
          background: rgba(6, 182, 212, 0.08);
          border-color: rgba(6, 182, 212, 0.3);
        }
        .status-indicator--warning {
          color: var(--warning, #f59e0b);
          background: rgba(245, 158, 11, 0.08);
          border-color: rgba(245, 158, 11, 0.3);
        }
        .status-indicator--error {
          color: var(--error, #ef4444);
          background: rgba(239, 68, 68, 0.08);
          border-color: var(--error, #ef4444);
        }
        .status-spinner {
          animation: spin 0.85s linear infinite;
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
          animation: status-pulse 1.4s ease-in-out infinite;
        }
        .status-indicator__time {
          font-family: var(--font-mono, monospace);
          font-size: 10px;
          opacity: 0.85;
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
        @keyframes status-pulse {
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
