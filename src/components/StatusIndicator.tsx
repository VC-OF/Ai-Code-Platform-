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
  const configs: Record<AgentStatus, { label: string; bg: string; text: string; dot: string; pulse: boolean }> = {
    planning:   { label: 'Planning', bg: 'bg-indigo-50/50 dark:bg-indigo-950/20', text: 'text-indigo-600 dark:text-indigo-400', dot: 'bg-indigo-500', pulse: true },
    reading:    { label: 'Reading Files', bg: 'bg-blue-50/50 dark:bg-blue-950/20', text: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500', pulse: true },
    writing:    { label: 'Writing Changes', bg: 'bg-amber-50/50 dark:bg-amber-950/20', text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500', pulse: true },
    linting:    { label: 'Linting Code', bg: 'bg-teal-50/50 dark:bg-teal-950/20', text: 'text-teal-600 dark:text-teal-400', dot: 'bg-teal-500', pulse: true },
    testing:    { label: 'Testing Suite', bg: 'bg-purple-50/50 dark:bg-purple-950/20', text: 'text-purple-600 dark:text-purple-400', dot: 'bg-purple-500', pulse: true },
    running:    { label: 'Running Task', bg: 'bg-emerald-50/50 dark:bg-emerald-950/20', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500', pulse: true },
    waiting:    { label: 'Waiting for Your Answer', bg: 'bg-amber-50/50 dark:bg-amber-950/20', text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500', pulse: true },
    done:       { label: 'Idle', bg: 'bg-slate-50 dark:bg-slate-900', text: 'text-slate-500 dark:text-slate-400', dot: 'bg-slate-400', pulse: false },
    error:      { label: 'Failed', bg: 'bg-rose-50/50 dark:bg-rose-950/20', text: 'text-rose-600 dark:text-rose-400', dot: 'bg-rose-500', pulse: false },
    compacting: { label: 'Compacting Context', bg: 'bg-cyan-50/50 dark:bg-cyan-950/20', text: 'text-cyan-600 dark:text-cyan-400', dot: 'bg-cyan-500', pulse: true },
  };

  const config = configs[status] || configs.done;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-current/10 ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${config.pulse ? 'animate-pulse' : ''}`} />
      {config.label}
    </div>
  );
}
