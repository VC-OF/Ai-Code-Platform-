import React from 'react';

interface TimelineEventProps {
  event: {
    type: string;
    stepIndex?: number;
    ts: number;
    plan?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    result?: { success?: boolean; summary?: string };
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
    reason?: string;
  };
}

export function TimelineEvent({ event }: TimelineEventProps) {
  const timeStr = new Date(event.ts).toLocaleTimeString();

  switch (event.type) {
    case 'plan':
      return (
        <div className="flex gap-3 py-3 border-b border-slate-100 dark:border-slate-850">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">
            P
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Forced Planning Step (Step {event.stepIndex})</span>
              <span className="text-[10px] text-slate-400 font-mono">{timeStr}</span>
            </div>
            <p className="text-xs text-slate-650 dark:text-slate-350 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded border border-slate-200/10">
              {event.plan}
            </p>
          </div>
        </div>
      );

    case 'tool_start':
      return (
        <div className="flex gap-3 py-2">
          <div className="flex-shrink-0 w-5 h-5 rounded bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[10px] font-bold">
            T
          </div>
          <div className="flex-1 flex justify-between items-center">
            <div className="text-xs text-slate-600 dark:text-slate-400">
              Executing <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-slate-800 dark:text-slate-200 font-semibold">{event.toolName}</span>
              {event.args && Object.keys(event.args).length > 0 && (
                <span className="text-[10px] text-slate-400 font-mono ml-1">({JSON.stringify(event.args).slice(0, 80)}...)</span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 font-mono">{timeStr}</span>
          </div>
        </div>
      );

    case 'tool_end':
      return (
        <div className="flex gap-3 py-2 pl-8 border-l border-slate-100 dark:border-slate-800/50">
          <div className="flex-1">
            <div className="flex justify-between items-center">
              <div className="text-xs text-slate-700 dark:text-slate-300">
                {event.result?.success ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Success:</span>
                ) : (
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">✗ Failed:</span>
                )}{' '}
                {event.result?.summary}
              </div>
              <span className="text-[10px] text-slate-400 font-mono">{((event.durationMs ?? 0) / 1000).toFixed(2)}s</span>
            </div>
          </div>
        </div>
      );

    case 'tool_error':
      return (
        <div className="flex gap-3 py-2 pl-8 border-l border-rose-100 dark:border-rose-950/30">
          <div className="flex-1 bg-rose-50/50 dark:bg-rose-950/10 p-2 rounded border border-rose-500/10">
            <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">
              Error executing {event.toolName}: {event.error}
            </div>
            {event.suggestion && (
              <div className="text-[10px] text-rose-500 dark:text-rose-400/80 mt-0.5 font-mono">
                Suggestion: {event.suggestion}
              </div>
            )}
          </div>
        </div>
      );

    case 'checkpoint':
      return (
        <div className="flex gap-3 py-2.5">
          <div className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-[10px] font-bold">
            C
          </div>
          <div className="flex-1 flex justify-between items-center">
            <div className="text-xs text-slate-700 dark:text-slate-300">
              Checkpoint created:{' '}
              <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-slate-800 dark:text-slate-200">
                {event.sha?.slice(0, 7)}
              </span>
              {typeof event.filesChanged === 'number' && event.filesChanged > 0 && (
                <span className="ml-1.5 text-slate-500 font-medium">({event.filesChanged} files modified)</span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 font-mono">{timeStr}</span>
          </div>
        </div>
      );

    case 'compaction':
      return (
        <div className="flex gap-3 py-2 bg-cyan-50/20 dark:bg-cyan-950/5 px-2 rounded border border-cyan-500/10 my-1">
          <div className="flex-shrink-0 w-5 h-5 rounded bg-cyan-50 dark:bg-cyan-950/30 text-cyan-600 dark:text-cyan-400 flex items-center justify-center text-[10px] font-bold">
            K
          </div>
          <div className="flex-1 text-xs text-slate-650 dark:text-slate-350 flex justify-between items-center">
            <div>
              Context compacted:{' '}
              <span className="font-mono font-semibold">
                {event.before?.messages} → {event.after?.messages}
              </span>{' '}
              messages ({event.before?.tokens} → {event.after?.tokens} tokens)
            </div>
            <span className="text-[10px] text-slate-400 font-mono">{timeStr}</span>
          </div>
        </div>
      );

    case 'verification':
      return (
        <div className={`flex gap-3 py-2 px-2.5 rounded border my-1 ${
          event.passed 
            ? 'bg-emerald-50/30 dark:bg-emerald-950/5 border-emerald-500/10 text-emerald-700 dark:text-emerald-400' 
            : 'bg-rose-50/30 dark:bg-rose-950/5 border-rose-500/10 text-rose-700 dark:text-rose-400'
        }`}>
          <div className="flex-1 flex justify-between items-center text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold">{event.tool === 'run_lint' ? 'Linting' : 'Testing'} Status:</span>
              <span>{event.summary}</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">{timeStr}</span>
          </div>
        </div>
      );

    case 'user_input_request':
      return (
        <div className="flex gap-3 py-2.5">
          <div className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 flex items-center justify-center text-[10px] font-bold">
            ?
          </div>
          <div className="flex-1 flex justify-between items-center">
            <div className="text-xs text-slate-700 dark:text-slate-300">
              Agent asked: <span className="font-medium">{event.question}</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">{timeStr}</span>
          </div>
        </div>
      );

    case 'error':
      return (
        <div className="flex gap-3 py-3 px-3 rounded bg-rose-50 dark:bg-rose-950/20 border border-rose-500/10 my-2 text-rose-700 dark:text-rose-400">
          <div className="flex-1">
            <div className="text-xs font-semibold mb-0.5">Agent Execution Error</div>
            <p className="text-xs font-mono whitespace-pre-wrap">{event.message}</p>
          </div>
        </div>
      );

    case 'done':
      return (
        <div className="flex gap-3 py-4 border-t border-slate-100 dark:border-slate-800/50 mt-4 text-slate-800 dark:text-slate-200">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs">
            ✓
          </div>
          <div className="flex-1">
            <div className="text-xs font-semibold">Agent turn complete</div>
            <div className="text-[10px] text-slate-400 mt-1 flex gap-3">
              <span>Duration: {((event.durationMs ?? 0) / 1000).toFixed(1)}s</span>
              <span>Reason: {event.reason}</span>
              {Array.isArray(event.filesChanged) && event.filesChanged.length > 0 && (
                <span>Files modified: {event.filesChanged.join(', ')}</span>
              )}
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}
