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
    case 'execute_code': {
      // `{language: "bash", command: "…"}` is how models reach for a shell
      rename(args, 'code', ['source', 'script', 'snippet', 'program', 'content', 'command', 'cmd']);
      rename(args, 'language', ['lang']);
      if (typeof args.language === 'string') {
        const lang = args.language.trim().toLowerCase();
        args.language = LANGUAGE_ALIASES[lang] ?? lang;
      } else if (args.language === undefined && typeof args.code === 'string' && !/\n/.test(args.code)) {
        args.language = 'shell';
      }
      const t = toInt(args.timeout_seconds ?? args.timeout);
      delete args.timeout;
      args.timeout_seconds = typeof t === 'number' && t > 900 ? 900 : t;
      if (args.timeout_seconds === undefined) delete args.timeout_seconds;
      break;
    }
    case 'view_image':
    case 'run_notebook':
      rename(args, 'path', PATH_ALIASES);
      break;
    case 'notebook_edit':
      rename(args, 'path', [...PATH_ALIASES, 'notebook_path', 'notebook']);
      rename(args, 'action', ['edit_mode', 'mode', 'operation', 'op']);
      rename(args, 'cell_index', ['index', 'cell', 'cellIndex', 'cell_number', 'cell_id']);
      rename(args, 'cell_type', ['type', 'cellType']);
      rename(args, 'source', ['new_source', 'content', 'code', 'text']);
      if (typeof args.action === 'string') {
        const a = args.action.trim().toLowerCase();
        args.action = ACTION_ALIASES[a] ?? a;
      }
      args.cell_index = toInt(args.cell_index);
      break;
    case 'save_memory':
      rename(args, 'text', ['memory', 'note', 'content', 'fact', 'message']);
      break;
    case 'http_request': {
      rename(args, 'url', ['uri', 'endpoint', 'path']);
      rename(args, 'body', ['data', 'json', 'payload']);
      if (typeof args.method === 'string') args.method = args.method.trim().toUpperCase();
      const t = toInt(args.timeout_seconds ?? args.timeout);
      delete args.timeout;
      if (typeof t === 'number') args.timeout_seconds = Math.min(120, t);
      else delete args.timeout_seconds;
      break;
    }
    case 'query_data':
      rename(args, 'source', [...PATH_ALIASES, 'table', 'dataset']);
      rename(args, 'sql', ['query', 'statement']);
      args.limit = toInt(args.limit);
      if (args.limit === undefined) delete args.limit;
      break;
    case 'plot_data':
      rename(args, 'path', ['output', 'out', 'file_path', 'filename', 'save_as']);
      rename(args, 'source', ['file', 'dataset', 'data_file', 'csv']);
      rename(args, 'kind', ['type', 'chart', 'chart_type', 'plot_type']);
      rename(args, 'y_columns', ['y_column', 'y_cols', 'columns', 'y']);
      rename(args, 'x_column', ['x_col']);
      if (typeof args.y_columns === 'string') args.y_columns = [args.y_columns];
      // `{x, y: [...numbers]}` → one series
      if (Array.isArray(args.y_columns) && args.y_columns.every((v) => typeof v === 'number') && !args.source) {
        args.series = [{ y: args.y_columns }];
        delete args.y_columns;
      }
      if (typeof args.kind === 'string') args.kind = args.kind.trim().toLowerCase().replace(/plot$/, '').replace(/^(lines?)$/, 'line');
      break;
    case 'review_changes':
      rename(args, 'base', ['ref', 'against', 'since']);
      rename(args, 'path', PATH_ALIASES);
      break;
    case 'spawn_agent': {
      rename(args, 'task', ['prompt', 'instructions', 'description', 'goal']);
      rename(args, 'kind', ['type', 'agent', 'agent_type', 'subagent_type', 'role']);
      rename(args, 'label', ['name', 'title']);
      if (typeof args.kind === 'string') {
        const k = args.kind.trim().toLowerCase();
        args.kind = KIND_ALIASES[k] ?? k;
      }
      break;
    }
  }
  return args;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  py: 'python', python3: 'python', ipython: 'python',
  js: 'javascript', node: 'javascript', nodejs: 'javascript',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  'c++': 'cpp', cxx: 'cpp', cc: 'cpp',
  f90: 'fortran', f95: 'fortran', f: 'fortran', fortran90: 'fortran',
  rscript: 'r', rlang: 'r',
};

const ACTION_ALIASES: Record<string, string> = {
  replace: 'replace', update: 'replace', edit: 'replace', set: 'replace',
  insert: 'insert', add: 'insert', append: 'insert', create: 'insert', new: 'insert',
  delete: 'delete', remove: 'delete', del: 'delete',
};

const KIND_ALIASES: Record<string, string> = {
  explore: 'explore', explorer: 'explore', search: 'explore', find: 'explore', 'read-only': 'explore', readonly: 'explore',
  research: 'research', researcher: 'research', investigate: 'research', docs: 'research',
  verify: 'verify', verifier: 'verify', test: 'verify', tester: 'verify', check: 'verify', review: 'verify', reviewer: 'verify',
  general: 'general', 'general-purpose': 'general', coder: 'general', implement: 'general', implementer: 'general', worker: 'general', build: 'general',
};
