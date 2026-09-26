import React, { useState } from 'react';
import { toolLabel } from './toolLabels';
import Markdown from './chat/Markdown';

export interface TimelineEventData {
  type: string;
  stepIndex?: number;
  ts: number;
  plan?: string;
  toolName?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  result?: {
    success?: boolean;
    summary?: string;
    screenshotUrl?: string;
    screenshot?: string;
    /** execute_code figures */
    images?: { path: string; url: string; bytes?: number }[];
    /** view_image */
    imageUrl?: string;
    subagent?: SubagentMeta;
  };
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
  /** reasoning */
  content?: string;
  /** hook */
  event?: string;
  command?: string;
  exitCode?: number;
  blocked?: boolean;
  timedOut?: boolean;
  output?: string;
  /** subagent card (assembled by ChatPanel from spawn_agent + subagent_event) */
  label?: string;
  kind?: string;
  task?: string;
  status?: string;
  done?: boolean;
  success?: boolean;
  events?: TimelineEventData[];
  subagent?: SubagentMeta;
  [key: string]: unknown;
}

export interface SubagentMeta {
  reason?: string;
  steps?: number;
  toolCalls?: number;
  tokens?: number;
  filesChanged?: string[];
  report?: string;
}

interface TimelineEventProps {
  event: TimelineEventData;
  projectId?: string;
}

// Shared class fragments (design tokens only).
const ROW = 'flex items-center gap-2 py-1 text-[12.5px] text-[var(--text-secondary)]';
const TIME = 'ml-auto shrink-0 text-[10.5px] font-mono text-[var(--text-disabled)]';
const MONO = 'font-mono text-[12px] text-[var(--text-primary)]';
const DOT = 'shrink-0 w-1.5 h-1.5 rounded-full';
const LINK_BTN =
  'font-mono text-[12px] px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-primary)] ' +
  'hover:bg-[var(--bg-hover)] cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';
const CHEVRON_BTN =
  'inline-flex items-center gap-1.5 text-left cursor-pointer bg-transparent border-0 p-0 text-inherit ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded-[var(--radius-sm)]';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={11} height={11} aria-hidden="true"
      className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function Thumb({ url, title, alt }: { url: string; title?: string; alt: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" title={title} className="shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="h-12 w-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--accent)] transition-colors"
      />
    </a>
  );
}

/** Reasoning-model "thinking" — collapsed by default, never part of the reply. */
function ReasoningBlock({ event }: { event: TimelineEventData }) {
  const [open, setOpen] = useState(false);
  const text = event.content ?? '';
  const words = text.split(/\s+/).filter(Boolean).length;
  return (
    <div className="py-1">
      <button type="button" className={`${CHEVRON_BTN} ${ROW} w-full`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Chevron open={open} />
        <span className={`${DOT} bg-[var(--text-muted)]`} />
        <span className="italic">Thought{words ? ` (${words} words)` : ''}</span>
        <span className={TIME}>{new Date(event.ts).toLocaleTimeString()}</span>
      </button>
      {open && (
        <div className="mt-1 ml-3.5 max-h-72 overflow-y-auto text-[12px] italic leading-relaxed text-[var(--text-muted)] whitespace-pre-wrap bg-[var(--bg-elevated)] p-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
          {text}
        </div>
      )}
    </div>
  );
}

const SUBAGENT_STATUS_TEXT: Record<string, string> = {
  planning: 'thinking…',
  reading: 'reading…',
  writing: 'writing…',
  linting: 'linting…',
  testing: 'testing…',
  running: 'running…',
  compacting: 'compacting…',
  waiting: 'waiting…',
};

/** A spawned sub-agent: its own nested tool timeline plus the final report. */
function SubagentCard({ event, projectId }: { event: TimelineEventData; projectId?: string }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const running = !event.done;
  const expanded = open ?? running;
  const inner = event.events ?? [];
  const toolCalls = inner.filter((e) => e.type === 'tool_start').length;
  const meta = event.subagent ?? event.result?.subagent;
  const ok = event.success !== false;
  const dotClass = running ? 'bg-[var(--accent)] animate-pulse' : ok ? 'bg-[var(--success)]' : 'bg-[var(--error)]';
  const statusText = running
    ? SUBAGENT_STATUS_TEXT[event.status ?? ''] ?? 'running…'
    : event.summary ?? (ok ? 'finished' : 'failed');

  return (
    <div className="my-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <button
        type="button"
        className={`${CHEVRON_BTN} w-full px-2.5 py-1.5 text-[12.5px] text-[var(--text-secondary)]`}
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
      >
        <Chevron open={expanded} />
        <span className={`${DOT} ${dotClass}`} />
        <span className="font-medium text-[var(--text-primary)]">Sub-agent</span>
        <span className="font-mono text-[11px] px-1.5 py-px rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]">{event.kind ?? 'agent'}</span>
        <span className="min-w-0 truncate">{event.label}</span>
        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-muted)]">
          {toolCalls} tool call{toolCalls === 1 ? '' : 's'} · {statusText}
        </span>
      </button>
      {expanded && (
        <div className="px-2.5 pb-2">
          {event.task && (
            <p className="text-[12px] text-[var(--text-secondary)] whitespace-pre-wrap mb-1.5 ml-3.5 border-l-2 border-[var(--border-subtle)] pl-2">
              {event.task}
            </p>
          )}
          {inner.length > 0 && (
            <div className="ml-3.5 border-l border-[var(--border-subtle)] pl-2">
              {inner.map((e, i) => (
                <TimelineEvent key={i} event={e} projectId={projectId} />
              ))}
            </div>
          )}
          {!running && meta?.report && (
            <div className="mt-1.5 ml-3.5 max-h-80 overflow-y-auto text-[12.5px] bg-[var(--bg-elevated)] p-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
              <Markdown text={meta.report} projectId={projectId} />
            </div>
          )}
          {!running && event.error && (
            <div className="mt-1.5 ml-3.5 text-[12px] text-[var(--error)]">{event.error}</div>
          )}
          {!running && meta && (
            <div className="mt-1 ml-3.5 text-[11px] text-[var(--text-muted)] flex flex-wrap gap-x-3">
              {typeof meta.steps === 'number' && <span>{meta.steps} steps</span>}
              {typeof meta.tokens === 'number' && <span>{meta.tokens.toLocaleString()} tokens</span>}
              {meta.filesChanged && meta.filesChanged.length > 0 && (
                <span className="font-mono">Files: {meta.filesChanged.join(', ')}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TimelineEvent({ event, projectId }: TimelineEventProps) {
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

    case 'reasoning':
      return <ReasoningBlock event={event} />;

    case 'subagent':
      return <SubagentCard event={event} projectId={projectId} />;

    case 'hook': {
      const status = event.error
        ? 'could not run'
        : event.timedOut
          ? 'timed out'
          : event.blocked
            ? 'blocked (exit 2)'
            : event.exitCode === 0
              ? 'ok'
              : `exit ${event.exitCode}`;
      const bad = Boolean(event.error || event.timedOut || (event.exitCode !== 0 && !event.blocked));
      const dot = event.blocked ? 'bg-[var(--warning)]' : bad ? 'bg-[var(--error)]' : 'bg-[var(--text-muted)]';
      const detail = event.error ?? ((event.blocked || bad) ? event.output : '');
      return (
        <div className="py-0.5">
          <div className={ROW}>
            <span className={`${DOT} ${dot}`} />
            <span>Hook</span>
            <span className={MONO}>{event.event}</span>
            <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-muted)]">{event.command}</span>
            <span className={event.blocked ? 'text-[var(--warning)]' : bad ? 'text-[var(--error)]' : ''}>{status}</span>
            <span className={TIME}>{timeStr}</span>
          </div>
          {detail && (
            <pre className="ml-3.5 mt-0.5 mb-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11.5px] font-mono text-[var(--text-secondary)] bg-[var(--bg-elevated)] p-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
              {detail}
            </pre>
          )}
        </div>
      );
    }

    case 'tool_start': {
      const label = toolLabel(event.toolName, event.args);
      if (label) {
        return (
          <div className={ROW}>
            <span className={`${DOT} bg-[var(--accent)]`} />
            <span className="min-w-0 truncate text-[var(--text-primary)]">{label}</span>
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

    case 'tool_end': {
      const images = event.result?.images ?? [];
      return (
        <div className="pl-3.5">
          <div className={ROW}>
            <span className={`${DOT} ${event.result?.success ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`} />
            <span className={event.result?.success ? 'text-[var(--success)]' : 'text-[var(--error)]'}>
              {event.result?.success ? 'Done' : 'Failed'}
            </span>
            <span className="min-w-0 truncate">{event.result?.summary}</span>
            <span className={TIME}>{((event.durationMs ?? 0) / 1000).toFixed(2)}s</span>
            {event.result?.screenshotUrl && (
              <Thumb url={event.result.screenshotUrl} title={event.result.screenshot} alt="Browser screenshot" />
            )}
            {event.result?.imageUrl && (
              <Thumb url={event.result.imageUrl} title={String(event.args?.path ?? '')} alt="Viewed image" />
            )}
          </div>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1.5 py-1 ml-3.5">
              {images.map((img) => (
                <Thumb key={img.path} url={img.url} title={img.path} alt={img.path} />
              ))}
            </div>
          )}
        </div>
      );
    }

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

    case 'text_done':
      // Only reached for nested (sub-agent) events: the child's final report
      return event.content ? (
        <div className="py-1 text-[12px] text-[var(--text-secondary)] whitespace-pre-wrap line-clamp-3">
          {event.content}
        </div>
      ) : null;

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
