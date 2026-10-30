'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { DbTask, TaskStatus, TaskTimelineEntry } from '@/lib/db';
import { groupModelOptions } from '@/lib/modelOptions';

interface ProjectSummary {
  id: string;
  title: string;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  running: 'Working',
  needs_input: 'Needs you',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_STYLE: Record<TaskStatus, string> = {
  running: 'bg-[#e8f0fb] text-[#2b5ea7] dark:bg-[#1e2a3a] dark:text-[#8fb5ea]',
  needs_input: 'bg-[#fbeee6] text-[#b4532a] dark:bg-[#3a261c] dark:text-[#f0a47f]',
  done: 'bg-[#e7f3ea] text-[#2f7a45] dark:bg-[#1c3123] dark:text-[#86cf9b]',
  failed: 'bg-[#fbe8e8] text-[#b23b3b] dark:bg-[#3a1f1f] dark:text-[#f19393]',
  cancelled: 'bg-[#efede6] text-[#737067] dark:bg-[#2e2d29] dark:text-[#9c978b]',
};

const isActive = (s: TaskStatus) => s === 'running' || s === 'needs_input';

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function notify(title: string, body: string) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {
    // Notifications unavailable (insecure context, blocked) — the page still shows the change
  }
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<DbTask[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [goal, setGoal] = useState('');
  const [projectId, setProjectId] = useState('');
  const [model, setModel] = useState('');
  const [deploy, setDeploy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notifyPermission, setNotifyPermission] = useState<string>('default');
  const lastStatus = useRef<Map<string, TaskStatus>>(new Map());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) return;
      const data = (await res.json()) as { tasks: DbTask[] };
      // Notify on transitions seen while this page is open
      for (const t of data.tasks) {
        const prev = lastStatus.current.get(t.id);
        if (prev && prev !== t.status) {
          if (t.status === 'done') notify('Task finished', t.goal.slice(0, 120));
          else if (t.status === 'needs_input') notify('Task needs your input', t.question ?? t.goal.slice(0, 120));
          else if (t.status === 'failed') notify('Task failed', t.goal.slice(0, 120));
        }
        lastStatus.current.set(t.id, t.status);
      }
      setTasks(data.tasks);
    } catch {
      // Network blip — the next poll retries
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.projects && setProjects(d.projects.map((p: ProjectSummary) => ({ id: p.id, title: p.title }))))
      .catch(() => {});
    if (typeof Notification !== 'undefined') setNotifyPermission(Notification.permission);
  }, [load]);

  // Poll quickly while something is running, slowly otherwise
  const anyActive = tasks.some((t) => isActive(t.status));
  useEffect(() => {
    const timer = setInterval(load, anyActive ? 2500 : 15000);
    return () => clearInterval(timer);
  }, [load, anyActive]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, projectId: projectId || undefined, model: model || undefined, deploy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the task');
      setGoal('');
      setExpanded(data.task.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const answer = async (id: string) => {
    const text = answers[id]?.trim();
    if (!text) return;
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: text }),
    });
    if (res.ok) setAnswers((a) => ({ ...a, [id]: '' }));
    await load();
  };

  const cancel = async (id: string) => {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    await load();
  };

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setNotifyPermission(await Notification.requestPermission());
  };

  return (
    <div className="min-h-screen bg-[#faf9f5] dark:bg-[#1f1e1d] text-[#1f1e1d] dark:text-[#ede8de]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Tasks</h1>
            <p className="text-sm text-[#737067] dark:text-[#9c978b]">
              Hand off a goal. The agent works on its own and tells you when it&apos;s done or stuck.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {notifyPermission === 'default' && (
              <button
                type="button"
                onClick={enableNotifications}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e6df] dark:border-[#3e3c36] hover:bg-[#f0eee6] dark:hover:bg-[#2e2d29]"
              >
                Enable notifications
              </button>
            )}
            <Link href="/" className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e6df] dark:border-[#3e3c36] hover:bg-[#f0eee6] dark:hover:bg-[#2e2d29]">
              Back to Open Code
            </Link>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-[#e8e6df] dark:border-[#3e3c36] bg-white dark:bg-[#262624] p-4 shadow-sm mb-8"
        >
          <label htmlFor="task-goal" className="sr-only">Task goal</label>
          <textarea
            id="task-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
            }}
            rows={3}
            placeholder="e.g. Build a habit tracker with streaks and dark mode, test it, and make sure the preview works"
            className="w-full resize-y bg-transparent outline-none text-[15px] placeholder:text-[#a8a59c]"
          />
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <select
              aria-label="Project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="text-xs rounded-lg border border-[#e8e6df] dark:border-[#3e3c36] bg-transparent px-2 py-1.5 max-w-[14rem]"
            >
              <option value="">New project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
            <select
              aria-label="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="text-xs rounded-lg border border-[#e8e6df] dark:border-[#3e3c36] bg-transparent px-2 py-1.5 max-w-[14rem]"
            >
              <option value="">Default model</option>
              {groupModelOptions().map(([group, options]) => (
                <optgroup key={group} label={group}>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-[#4a4842] dark:text-[#c9c4b8] cursor-pointer select-none">
              <input type="checkbox" checked={deploy} onChange={(e) => setDeploy(e.target.checked)} className="accent-[#da7756]" />
              Deploy &amp; share link when done
            </label>
            <span className="flex-1" />
            <button
              type="submit"
              disabled={!goal.trim() || submitting}
              className="text-sm font-medium px-4 py-1.5 rounded-lg bg-[#da7756] hover:bg-[#c96c4d] text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Starting…' : 'Delegate'}
            </button>
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-[#b23b3b] dark:text-[#f19393]">{error}</p>}
        </form>

        {tasks.length === 0 ? (
          <p className="text-center text-sm text-[#737067] dark:text-[#9c978b] py-12">No tasks yet.</p>
        ) : (
          <ul className="space-y-3">
            {tasks.map((t) => {
              const open = expanded === t.id;
              const timeline = JSON.parse(t.timeline) as TaskTimelineEntry[];
              return (
                <li key={t.id} className="rounded-xl border border-[#e8e6df] dark:border-[#3e3c36] bg-white dark:bg-[#262624]">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : t.id)}
                    aria-expanded={open}
                    className="w-full text-left px-4 py-3 flex items-start gap-3"
                  >
                    <span className={`shrink-0 mt-0.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[t.status]}`}>
                      {t.status === 'running' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1 animate-pulse align-middle" />}
                      {STATUS_LABEL[t.status]}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{t.goal.split('\n')[0]}</span>
                      <span className="block text-xs text-[#737067] dark:text-[#9c978b]">
                        {timeAgo(t.created_at)}
                        {t.files_changed > 0 && ` · ${t.files_changed} file(s) changed`}
                        {t.model && ` · ${t.model.replace(/^openrouter:/, '')}`}
                      </span>
                      {t.result_url && (
                        <span className="block text-xs text-[#2f7a45] dark:text-[#86cf9b] truncate">Live: {t.result_url}</span>
                      )}
                    </span>
                  </button>

                  {open && (
                    <div className="px-4 pb-4 border-t border-[#efede6] dark:border-[#33322e] pt-3 space-y-3">
                      {t.status === 'needs_input' && (
                        <div className="rounded-lg bg-[#fbeee6] dark:bg-[#3a261c] p-3">
                          <p className="text-sm font-medium mb-2">{t.question}</p>
                          <div className="flex gap-2">
                            <input
                              aria-label="Your answer"
                              value={answers[t.id] ?? ''}
                              onChange={(e) => setAnswers((a) => ({ ...a, [t.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && answer(t.id)}
                              className="flex-1 text-sm rounded-md border border-[#e8e6df] dark:border-[#3e3c36] bg-white dark:bg-[#1f1e1d] px-2 py-1"
                            />
                            <button
                              type="button"
                              onClick={() => answer(t.id)}
                              className="text-sm px-3 py-1 rounded-md bg-[#da7756] hover:bg-[#c96c4d] text-white"
                            >
                              Answer
                            </button>
                          </div>
                        </div>
                      )}

                      {t.result_url && (
                        <div className="flex items-center gap-2 rounded-lg bg-[#e7f3ea] dark:bg-[#1c3123] p-3">
                          <span className="text-sm font-medium shrink-0">Live app</span>
                          <a href={t.result_url} target="_blank" rel="noopener noreferrer" className="text-sm underline truncate flex-1 min-w-0">
                            {t.result_url}
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(t.result_url!).then(() => setCopied(t.id), () => {});
                            }}
                            className="text-xs px-2 py-1 rounded-md border border-[#c4dfcb] dark:border-[#2f4a37] shrink-0"
                          >
                            {copied === t.id ? 'Copied' : 'Copy link'}
                          </button>
                        </div>
                      )}

                      {t.summary && (
                        <div className="text-sm whitespace-pre-wrap rounded-lg bg-[#f6f5f0] dark:bg-[#2e2d29] p-3 max-h-64 overflow-y-auto">
                          {t.summary}
                        </div>
                      )}

                      <ol className="space-y-1 max-h-72 overflow-y-auto">
                        {timeline.map((e, i) => (
                          <li key={i} className="flex gap-2 text-xs">
                            <span className="shrink-0 tabular-nums text-[#a8a59c] w-16">
                              {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span
                              className={
                                e.ok === false
                                  ? 'text-[#b23b3b] dark:text-[#f19393]'
                                  : e.kind === 'question'
                                    ? 'text-[#b4532a] dark:text-[#f0a47f]'
                                    : 'text-[#4a4842] dark:text-[#c9c4b8]'
                              }
                            >
                              {e.text}
                            </span>
                          </li>
                        ))}
                      </ol>

                      <div className="flex gap-2">
                        <Link
                          href={`/?projectId=${encodeURIComponent(t.project_id)}`}
                          className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e6df] dark:border-[#3e3c36] hover:bg-[#f0eee6] dark:hover:bg-[#2e2d29]"
                        >
                          Open project
                        </Link>
                        {isActive(t.status) && (
                          <button
                            type="button"
                            onClick={() => cancel(t.id)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e6df] dark:border-[#3e3c36] hover:bg-[#fbe8e8] dark:hover:bg-[#3a1f1f]"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
