'use client';

interface CompletionDialogProps {
  projectId: string;
  onDismiss: () => void;
  onOpenPreview: () => void;
}

export default function CompletionDialog({
  projectId,
  onDismiss,
  onOpenPreview,
}: CompletionDialogProps) {
  return (
    <div className="completion-dialog animate-slide-bottom">
      {/* Header */}
      <div className="cd-header">
        <div className="cd-title-row">
          <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14} aria-hidden="true">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          <h4 className="cd-title">Task complete</h4>
        </div>
        <button className="cd-close" onClick={onDismiss} title="Dismiss" aria-label="Dismiss">✕</button>
      </div>

      <p className="cd-desc">
        The agent finished successfully. Choose what to do next.
      </p>

      {/* Action options */}
      <div className="cd-opts">
        <button
          className="cd-opt cd-opt--primary"
          onClick={() => { onOpenPreview(); onDismiss(); }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6M10 14L21 3"/>
          </svg>
          Open preview
        </button>
        <a
          href={`/api/download?projectId=${encodeURIComponent(projectId)}`}
          className="cd-opt"
          download
          onClick={onDismiss}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <path d="M12 3v13M7 12l5 5 5-5M5 21h14"/>
          </svg>
          Download project
        </a>
        <button className="cd-opt" onClick={onDismiss}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          Back to editor
        </button>
      </div>

      <style jsx>{`
        .completion-dialog {
          position: fixed;
          bottom: 76px;
          right: 20px;
          width: 300px;
          z-index: 200;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          padding: 16px;
          box-shadow: var(--shadow-lg);
        }

        .cd-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
        }

        .cd-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .cd-icon { color: var(--success); flex-shrink: 0; }

        .cd-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .cd-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 2px 4px;
          border-radius: var(--radius-sm);
          transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
        }
        .cd-close:hover { color: var(--text-primary); background: var(--bg-overlay); }

        .cd-desc {
          font-size: 11.5px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin-bottom: 12px;
        }

        .cd-opts {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .cd-opt {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 12px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          font-size: 12.5px;
          color: var(--text-primary);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
          text-decoration: none;
          text-align: left;
        }

        .cd-opt:hover {
          background: var(--bg-hover);
          border-color: var(--border-base);
        }

        .cd-opt:focus-visible, .cd-close:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        .cd-opt--primary {
          background: var(--accent);
          border-color: var(--accent);
          color: #fff;
        }
        .cd-opt--primary:hover {
          background: var(--accent-dim);
          border-color: var(--accent-dim);
        }
      `}</style>
    </div>
  );
}
