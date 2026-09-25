import React from 'react';
import { browserToolLabel } from './browserToolLabels';

interface TimelineEventProps {
  event: {
    type: string;
    stepIndex?: number;
    ts: number;
    plan?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    result?: { success?: boolean; summary?: string; screenshotUrl?: string; screenshot?: string };
    durationMs?: number;
    error?: string;
    suggestion?: string;
    sha?: string;
    filesChanged?: number | string[];
    before?: { messages?: number; tokens?: number };
    after?: { messages?: number; tokens?: number };
    passed?: boolean;
    tool?: string;
    summary?: string;
    message?: string;
    question?: string;
    options?: string[];
    reason?: string;
  };
}

// Shared class fragments (design tokens only).
const ROW = 'flex items-center gap-2 py-1 text-[12.5px] text-[var(--text-secondary)]';
const TIME = 'ml-auto shrink-0 text-[10.5px] font-mono text-[var(--text-disabled)]';
const MONO = 'font-mono text-[12px] text-[var(--text-primary)]';
const DOT = 'shrink-0 w-1.5 h-1.5 rounded-full';
const LINK_BTN =
  'font-mono text-[12px] px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-primary)] ' +
  'hover:bg-[var(--bg-hover)] cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';

export function TimelineEvent({ event }: TimelineEventProps) {
  const timeStr = new Date(event.ts).toLocaleTimeString();

  switch (event.type) {
    case 'plan':
      return (
        <div className="py-2">
          <div className={ROW}>
            <span className={`${DOT} bg-[var(--text-muted)]`} />
            <span className="font-medium text-[var(--text-primary)]">Plan (step {event.stepIndex})</span>
            <span className={TIME}>{timeStr}</span>
          </div>
          <p className="mt-1 ml-3.5 text-[12px] text-[var(--text-secondary)] whitespace-pre-wrap font-mono leading-relaxed bg-[var(--bg-elevated)] p-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
            {event.plan}
          </p>
        </div>
      );

    case 'tool_start': {
      const browserLabel = browserToolLabel(event.toolName, event.args);
      if (browserLabel) {
        return (
          <div className={ROW}>
            <span className={`${DOT} bg-[var(--accent)]`} />
            <span className="min-w-0 truncate text-[var(--text-primary)]">{browserLabel}</span>
            <span className={TIME}>{timeStr}</span>
          </div>
        );
      }
      return (
        <div className={ROW}>
          <span className={`${DOT} bg-[var(--accent)]`} />
          <span className={MONO}>{event.toolName}</span>
          {event.args && Object.keys(event.args).length > 0 && (
            <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-muted)]">
              {JSON.stringify(event.args).slice(0, 80)}
            </span>
          )}
          <span className={TIME}>{timeStr}</span>
        </div>
      );
    }

    case 'tool_end':
      return (
        <div className={`${ROW} pl-3.5`}>
          <span className={`${DOT} ${event.result?.success ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`} />
          <span className={event.result?.success ? 'text-[var(--success)]' : 'text-[var(--error)]'}>
            {event.result?.success ? 'Done' : 'Failed'}
          </span>
          <span className="min-w-0 truncate">{event.result?.summary}</span>
          <span className={TIME}>{((event.durationMs ?? 0) / 1000).toFixed(2)}s</span>
          {event.result?.screenshotUrl && (
            <a href={event.result.screenshotUrl} target="_blank" rel="noreferrer" title={event.result.screenshot} className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={event.result.screenshotUrl}
                alt="Browser screenshot"
                className="h-12 w-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--accent)] transition-colors"
              />
            </a>
          )}
        </div>
      );

    case 'tool_error':
      return (
        <div className="ml-3.5 my-1 px-2.5 py-2 rounded-[var(--radius-md)] bg-[var(--error-dim)] text-[12.5px] text-[var(--error)]">
          <div>
            Error in <span className="font-mono">{event.toolName}</span>: {event.error}
          </div>
          {event.suggestion && (
            <div className="mt-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
              Suggestion: {event.suggestion}
            </div>
          )}
        </div>
      );

    case 'checkpoint':
      return (
        <div className={ROW}>
          <span className={`${DOT} bg-[var(--text-muted)]`} />
          <span>Checkpoint</span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('oc-open-review-modal'))}
            className={LINK_BTN}
            title="Open checkpoints and diff viewer"
          >
            {event.sha?.slice(0, 7)}
          </button>
          {typeof event.filesChanged === 'number' && event.filesChanged > 0 && (
            <span className="text-[var(--text-muted)]">{event.filesChanged} files changed</span>
          )}
          <span className={TIME}>{timeStr}</span>
        </div>
      );

    case 'compaction':
      return (
        <div className={ROW}>
          <span className={`${DOT} bg-[var(--text-muted)]`} />
          <span>
            Context compacted:{' '}
            <span className="font-mono">
              {event.before?.messages} → {event.after?.messages}
            </span>{' '}
            messages ({event.before?.tokens} → {event.after?.tokens} tokens)
          </span>
          <span className={TIME}>{timeStr}</span>
        </div>
      );

    case 'verification':
      return (
        <div className={ROW}>
          <span className={`${DOT} ${event.passed ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`} />
          <span className={`font-medium ${event.passed ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
            {event.tool === 'run_lint' ? 'Lint' : 'Tests'}
          </span>
          <span className="min-w-0 truncate">{event.summary}</span>
          <span className={TIME}>{timeStr}</span>
        </div>
      );

    case 'user_input_request':
      return (
        <div className="py-1">
          <div className={ROW}>
            <span className={`${DOT} bg-[var(--warning)]`} />
            <span>
              Agent asked: <span className="text-[var(--text-primary)]">{event.question}</span>
            </span>
            <span className={TIME}>{timeStr}</span>
          </div>
          {event.options && event.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1 ml-3.5">
              {event.options.map((opt, i) => (
                <span
                  key={i}
                  className="text-[11.5px] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                >
                  {opt}
                </span>
              ))}
            </div>
          )}
        </div>
      );

    case 'error':
      return (
        <div className="my-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--error-dim)] text-[var(--error)]">
          <div className="text-[12.5px] font-medium mb-0.5">Agent error</div>
          <p className="text-[12px] font-mono whitespace-pre-wrap">{event.message}</p>
        </div>
      );

    case 'done':
      return (
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] text-[var(--text-secondary)]">
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className={`${DOT} bg-[var(--success)]`} />
            <span className="font-medium text-[var(--text-primary)]">Turn complete</span>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('oc-open-review-modal'))}
              className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] border border-[var(--border-base)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-[12px] transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              title="Review modified files and git checkpoints"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
              </svg>
              <span>Review changes</span>
            </button>
          </div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1 ml-3.5 flex flex-wrap gap-x-3 gap-y-1">
            <span>Duration: {((event.durationMs ?? 0) / 1000).toFixed(1)}s</span>
            <span>Reason: {event.reason}</span>
            {Array.isArray(event.filesChanged) && event.filesChanged.length > 0 && (
              <span className="font-mono">Files: {event.filesChanged.join(', ')}</span>
            )}
          </div>
        </div>
      );

    default:
      return null;
  }
}
