/**
 * Repairs common, unambiguous argument-shape slips before validation.
 *
 * Models trained on other agent harnesses reuse those harnesses' field names
 * (TodoWrite's `content` for a plan task title, `file_path`, `old_string` …)
 * or send numbers as strings. Each slip cost a full LLM round-trip on a
 * validation error — and some models repeated it every time. Only renames
 * and coercions with a single sensible meaning are applied; anything else is
 * left for the validator to reject.
 */

type Args = Record<string, unknown>;

const PATH_ALIASES = ['file_path', 'filePath', 'filename', 'file'];

const STATUS_ALIASES: Record<string, 'pending' | 'in_progress' | 'completed'> = {
  pending: 'pending', todo: 'pending', 'to-do': 'pending', not_started: 'pending', open: 'pending',
  in_progress: 'in_progress', 'in-progress': 'in_progress', inprogress: 'in_progress',
  active: 'in_progress', doing: 'in_progress', started: 'in_progress',
  completed: 'completed', complete: 'completed', done: 'completed', finished: 'completed',
};

function rename(args: Args, target: string, aliases: string[]): void {
  if (args[target] !== undefined) return;
  for (const alias of aliases) {
    if (args[alias] !== undefined) {
      args[target] = args[alias];
      delete args[alias];
      return;
    }
  }
}

function toInt(v: unknown): unknown {
  return typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
}

function normalizePlanTasks(raw: unknown): unknown {
  let tasks = raw;
  if (typeof tasks === 'string') {
    try { tasks = JSON.parse(tasks); } catch { return raw; }
  }
  if (!Array.isArray(tasks)) return raw;
  return tasks.map((t, i) => {
    if (typeof t === 'string') return { id: `t${i + 1}`, title: t, status: 'pending' };
    if (!t || typeof t !== 'object') return t;
    const task = { ...(t as Args) };
    rename(task, 'title', ['content', 'task', 'description', 'name', 'text', 'activeForm']);
    if (task.id === undefined || task.id === null || task.id === '') task.id = `t${i + 1}`;
    else if (typeof task.id === 'number') task.id = String(task.id);
    if (typeof task.status === 'string') {
      task.status = STATUS_ALIASES[task.status.trim().toLowerCase()] ?? task.status;
    } else if (task.status === undefined) {
      task.status = 'pending';
    }
    return task;
  });
}

export function normalizeToolArgs(toolName: string, input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const args: Args = { ...(input as Args) };

  switch (toolName) {
    case 'read_file':
    case 'delete_file':
      rename(args, 'path', PATH_ALIASES);
      break;
    case 'create_file':
    case 'append_file':
      rename(args, 'path', PATH_ALIASES);
      rename(args, 'content', ['contents', 'text', 'file_content']);
      break;
    case 'edit_file':
      rename(args, 'path', PATH_ALIASES);
      rename(args, 'oldText', ['old_text', 'old_string', 'oldString', 'old_str', 'search']);
      rename(args, 'newText', ['new_text', 'new_string', 'newString', 'new_str', 'replace']);
      break;
    case 'replace_lines':
      rename(args, 'path', PATH_ALIASES);
      rename(args, 'start_line', ['startLine', 'start']);
      rename(args, 'end_line', ['endLine', 'end']);
      rename(args, 'new_content', ['newContent', 'content', 'text']);
      args.start_line = toInt(args.start_line);
      args.end_line = toInt(args.end_line);
      break;
    case 'run_command': {
      rename(args, 'command', ['cmd']);
      const t = toInt(args.timeout_seconds);
      // Clamp instead of rejecting an over-long timeout outright
      args.timeout_seconds = typeof t === 'number' && t > 900 ? 900 : t;
      if (args.timeout_seconds === undefined) delete args.timeout_seconds;
      break;
    }
    case 'update_plan':
      rename(args, 'tasks', ['todos', 'plan', 'items']);
      args.tasks = normalizePlanTasks(args.tasks);
      break;
  }
  return args;
}
