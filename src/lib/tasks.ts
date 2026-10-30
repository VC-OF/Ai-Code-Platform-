// Delegated tasks: hand the agent a whole goal and let it run unattended.
// The agent already runs server-side per project; this layer starts it with
// delegation instructions, follows its event stream into a persistent
// timeline, and surfaces when it finishes or is blocked on a question.
import crypto from 'crypto';
import { agentManager } from './agentManager';
import { streamRegistry } from './cancellation';
import { createProject } from './projects';
import { taskDb, projectDb, type DbTask, type TaskStatus, type TaskTimelineEntry } from './db';

export interface DelegateOptions {
  /** Run in an existing project; omitted → a new project named after the goal */
  projectId?: string;
  model?: string;
  /** Deploy the finished app and return its live URL */
  deploy?: boolean;
}

const DELEGATION_INSTRUCTIONS = `[Delegated task] The user handed this off and is not watching.
Work autonomously until the goal is fully done: plan, implement, then verify
with run_lint / run_tests (and check_preview for apps) before finishing.
Only use ask_user when you are truly blocked on a decision only the user can
make. Finish with a short summary of what you did and how you verified it.

Goal:
`;

const DEPLOY_INSTRUCTIONS = `

When the app is built and verified (check_preview shows it working), publish it
with deploy_app and end your summary with the live URL. If deploy_app reports
that no deploy token is configured, say exactly that and how to add it in
Settings; do not try other ways to expose the app publicly.`;

export class TaskBusyError extends Error {}

export async function delegateTask(goal: string, opts: DelegateOptions = {}): Promise<DbTask> {
  const trimmed = goal.trim();
  if (!trimmed) throw new Error('Goal is required');

  let projectId = opts.projectId;
  if (projectId) {
    if (!projectDb.getById(projectId)) throw new Error(`Project ${projectId} not found`);
    if (agentManager.isRunning(projectId)) {
      throw new TaskBusyError('The agent is already working in this project');
    }
  } else {
    projectId = (await createProject(trimmed.split('\n')[0].slice(0, 60), 'blank')).id;
  }

  const id = 'task_' + crypto.randomBytes(6).toString('hex');
  taskDb.create({ id, project_id: projectId, goal: trimmed, model: opts.model ?? null });
  taskDb.appendTimeline(id, { ts: Date.now(), kind: 'status', text: 'Task started' });

  const stream = agentManager.startAgent(
    projectId,
    [{ role: 'user', content: DELEGATION_INSTRUCTIONS + trimmed + (opts.deploy ? DEPLOY_INSTRUCTIONS : '') }],
    undefined,
    opts.model,
    'auto'
  );
  void followStream(id, stream);
  return taskDb.get(id)!;
}

/** Answer the question a task is blocked on. */
export function answerTask(id: string, answer: string): boolean {
  const task = taskDb.get(id);
  if (!task || task.status !== 'needs_input') return false;
  if (!agentManager.provideUserInput(task.project_id, answer)) return false;
  taskDb.update(id, { status: 'running', question: null });
  taskDb.appendTimeline(id, { ts: Date.now(), kind: 'status', text: `You answered: ${answer.slice(0, 200)}` });
  return true;
}

export function cancelTask(id: string): boolean {
  const task = taskDb.get(id);
  if (!task || !isActive(task.status)) return false;
  streamRegistry.cancel(task.project_id, 'Task cancelled');
  // Cancellation can end the stream without a done event, so record it now
  taskDb.update(id, { status: 'cancelled', question: null, finished_at: Date.now() });
  taskDb.appendTimeline(id, { ts: Date.now(), kind: 'done', text: 'Cancelled', ok: false });
  return true;
}

export function isActive(status: TaskStatus): boolean {
  return status === 'running' || status === 'needs_input';
}

// ─── Event stream → task state ────────────────────────────────────────────────

type StreamEvent = Record<string, unknown> & { type?: string };

async function followStream(id: string, stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastText = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let event: StreamEvent;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === 'text_done' && typeof event.content === 'string' && event.content.trim()) {
          lastText = event.content.trim();
        }
        applyEvent(id, event, lastText);
      }
    }
  } catch (err) {
    taskDb.appendTimeline(id, { ts: Date.now(), kind: 'error', text: err instanceof Error ? err.message : String(err) });
  } finally {
    // Stream closed without a done event (crash, server restart mid-run)
    const task = taskDb.get(id);
    if (task && isActive(task.status)) {
      taskDb.update(id, { status: 'failed', summary: lastText || 'The agent stopped unexpectedly.', finished_at: Date.now() });
    }
  }
}

export function applyEvent(id: string, event: StreamEvent, lastText = ''): void {
  const now = Date.now();
  const add = (entry: Omit<TaskTimelineEntry, 'ts'>) => taskDb.appendTimeline(id, { ts: now, ...entry });

  // Work resumed after a question answered elsewhere (e.g. the project chat)
  if ((event.type === 'tool_start' || event.type === 'text_delta') && taskDb.get(id)?.status === 'needs_input') {
    taskDb.update(id, { status: 'running', question: null });
  }

  switch (event.type) {
    case 'tool_end': {
      const result = (event.result ?? {}) as { success?: boolean; summary?: string };
      add({ kind: 'tool', text: `${event.toolName}: ${String(result.summary ?? '').slice(0, 200)}`, ok: result.success !== false });
      if (event.toolName === 'deploy_app' && result.success !== false) {
        const url = String(result.summary ?? '').match(/https?:\/\/\S+/)?.[0];
        if (url) taskDb.update(id, { result_url: url });
      }
      break;
    }
    case 'checkpoint':
      add({ kind: 'checkpoint', text: `Checkpoint ${String(event.sha ?? '').slice(0, 7)}` });
      break;
    case 'verification':
      add({ kind: 'verification', text: String(event.summary ?? event.tool), ok: event.passed === true });
      break;
    case 'user_input_request': {
      const question = String(event.question ?? 'The agent needs your input');
      taskDb.update(id, { status: 'needs_input', question });
      add({ kind: 'question', text: question });
      break;
    }
    case 'error':
      add({ kind: 'error', text: String(event.message ?? 'Error') });
      break;
    case 'done': {
      const reason = String(event.reason ?? 'completed');
      if (taskDb.get(id)?.status === 'cancelled') break;
      const status: TaskStatus =
        reason === 'completed' ? 'done' : reason === 'user_cancelled' ? 'cancelled' : 'failed';
      const files = Array.isArray(event.filesChanged) ? event.filesChanged.length : 0;
      taskDb.update(id, { status, question: null, summary: lastText || null, files_changed: files, finished_at: now });
      add({ kind: 'done', text: status === 'done' ? `Finished · ${files} file(s) changed` : `Stopped: ${reason}`, ok: status === 'done' });
      break;
    }
  }
}
