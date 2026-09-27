import crypto from 'crypto';

/**
 * Scheduled agents: cron-triggered agent turns.
 *
 * - parseCron / nextRun are pure (5-field cron: minute hour dom month dow,
 *   with `*`, lists, ranges, steps and month/day names), evaluated in the
 *   server's local time zone. Like Vixie cron, when both day-of-month and
 *   day-of-week are restricted a day matching either one fires.
 * - A single in-process interval (guarded on globalThis so HMR / duplicate
 *   route bundles never start a second one) is started lazily by the first
 *   API request that calls ensureSchedulerStarted(). Each tick starts due
 *   schedules through agentManager.startAgent when the project is idle; a
 *   busy project is retried on the next tick.
 */

export interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseValue(raw: string, min: number, max: number, names?: string[], nameBase = 0): number {
  const lower = raw.toLowerCase();
  if (names) {
    const idx = names.indexOf(lower);
    if (idx >= 0) return idx + nameBase;
  }
  if (!/^\d+$/.test(raw)) throw new Error(`invalid value '${raw}'`);
  const n = Number(raw);
  if (n < min || n > max) throw new Error(`value ${n} out of range ${min}-${max}`);
  return n;
}

function parseField(field: string, min: number, max: number, label: string, names?: string[], nameBase = 0): Set<number> {
  const out = new Set<number>();
  if (!field) throw new Error(`empty ${label} field`);
  for (const part of field.split(',')) {
    try {
      const [rangePart, stepPart, extra] = part.split('/');
      if (extra !== undefined) throw new Error(`invalid step in '${part}'`);
      let step = 1;
      if (stepPart !== undefined) {
        if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) throw new Error(`invalid step '${stepPart}'`);
        step = Number(stepPart);
      }
      let lo: number;
      let hi: number;
      if (rangePart === '*') {
        lo = min;
        hi = max;
      } else if (rangePart.includes('-')) {
        const [a, b, more] = rangePart.split('-');
        if (more !== undefined) throw new Error(`invalid range '${rangePart}'`);
        lo = parseValue(a, min, max, names, nameBase);
        hi = parseValue(b, min, max, names, nameBase);
        if (lo > hi) throw new Error(`range ${rangePart} is reversed`);
      } else {
        lo = parseValue(rangePart, min, max, names, nameBase);
        // "5/15" means 5, 20, 35, 50 (start at 5, step to max)
        hi = stepPart !== undefined ? max : lo;
      }
      for (let v = lo; v <= hi; v += step) out.add(v);
    } catch (err) {
      throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/** Parse a 5-field cron expression; throws a descriptive Error when invalid. */
export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron needs 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`);
  }
  const [mi, h, dom, mo, dow] = fields;
  const daysOfWeek = parseField(dow, 0, 7, 'day-of-week', DAY_NAMES);
  if (daysOfWeek.has(7)) {
    daysOfWeek.delete(7);
    daysOfWeek.add(0); // 7 = Sunday
  }
  return {
    minutes: parseField(mi, 0, 59, 'minute'),
    hours: parseField(h, 0, 23, 'hour'),
    daysOfMonth: parseField(dom, 1, 31, 'day-of-month'),
    months: parseField(mo, 1, 12, 'month', MONTH_NAMES, 1),
    daysOfWeek,
    domRestricted: dom !== '*' && !dom.startsWith('*/'),
    dowRestricted: dow !== '*' && !dow.startsWith('*/'),
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  const dom = spec.daysOfMonth.has(d.getDate());
  const dow = spec.daysOfWeek.has(d.getDay());
  if (spec.domRestricted && spec.dowRestricted) return dom || dow;
  if (spec.domRestricted) return dom;
  if (spec.dowRestricted) return dow;
  return dom && dow;
}

/** Whether the cron fires in the (local-time) minute containing `d`. */
export function cronMatches(spec: CronSpec, d: Date): boolean {
  return (
    spec.months.has(d.getMonth() + 1) &&
    dayMatches(spec, d) &&
    spec.hours.has(d.getHours()) &&
    spec.minutes.has(d.getMinutes())
  );
}

/**
 * First minute strictly after `from` at which the cron fires, or null when
 * it never does within ~5 years (e.g. "0 0 30 2 *").
 */
export function nextRun(cron: string | CronSpec, from: Date = new Date()): Date | null {
  const spec = typeof cron === 'string' ? parseCron(cron) : cron;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = from.getTime() + 5 * 366 * 24 * 60 * 60_000;
  while (d.getTime() <= limit) {
    if (!spec.months.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(spec, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!spec.hours.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!spec.minutes.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return null;
}

// ─── Schedule management (DB-backed) ───────────────────────────────────────────

export interface ScheduleInput {
  projectId: string;
  cron: string;
  prompt: string;
  model?: string | null;
}

export async function createSchedule(input: ScheduleInput, now = new Date()) {
  const { scheduleDb, projectDb } = await import('./db');
  const cron = input.cron.trim().split(/\s+/).join(' ');
  parseCron(cron); // throws on invalid
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('prompt is required');
  if (prompt.length > 20_000) throw new Error('prompt is too long (max 20000 chars)');
  if (!projectDb.getById(input.projectId)) {
    // Same fallback as /api/chat: a project listed on disk but never chatted in
    const { getProject } = await import('./projects');
    const local = await getProject(input.projectId).catch(() => null);
    if (!local) throw new Error('Project not found');
    const { getWorkspaceRoot } = await import('./workspace');
    projectDb.create({ id: input.projectId, name: local.title, workspace: getWorkspaceRoot(input.projectId), description: null });
  }
  const next = nextRun(cron, now);
  const id = crypto.randomUUID().slice(0, 8);
  scheduleDb.create({
    id,
    project_id: input.projectId,
    cron,
    prompt,
    model: input.model || null,
    next_run_at: next ? next.getTime() : null,
  });
  return scheduleDb.get(id)!;
}

export async function setScheduleEnabled(id: string, enabled: boolean, now = new Date()): Promise<boolean> {
  const { scheduleDb } = await import('./db');
  const s = scheduleDb.get(id);
  if (!s) return false;
  // Resuming recomputes from now so a long pause doesn't fire a stale run
  const next = enabled ? nextRun(s.cron, now) : null;
  return scheduleDb.setEnabled(id, enabled, next ? next.getTime() : s.next_run_at);
}

// ─── Runner ────────────────────────────────────────────────────────────────────

const TICK_MS = 30_000;

const shared = globalThis as unknown as { __ocSchedulerTimer?: ReturnType<typeof setInterval> };

/**
 * Start every due schedule whose project is idle. Returns the ids started.
 * Exported for tests; the interval calls it every TICK_MS.
 */
export async function runDueSchedules(now = new Date()): Promise<string[]> {
  const { scheduleDb, projectDb } = await import('./db');
  const { agentManager } = await import('./agentManager');
  const { workspaceLocks } = await import('./workspaceLock');
  const started: string[] = [];
  for (const s of scheduleDb.due(now.getTime())) {
    if (!projectDb.getById(s.project_id)) continue;
    // Busy project: leave next_run_at alone so the next tick retries
    if (agentManager.isRunning(s.project_id) || workspaceLocks.get(s.project_id).isLocked()) continue;
    const next = nextRun(s.cron, now);
    scheduleDb.markRun(s.id, now.getTime(), next ? next.getTime() : null);
    try {
      const stream = agentManager.startAgent(
        s.project_id,
        [{ role: 'user', content: `[Scheduled run ${s.id}: ${s.cron}]\n\n${s.prompt}` }],
        undefined,
        s.model || undefined,
        'auto'
      );
      // Nobody reads this subscription — release it so events aren't buffered
      stream.cancel().catch(() => {});
      started.push(s.id);
    } catch (err) {
      console.error(`[scheduler] failed to start schedule ${s.id}:`, err);
    }
  }
  return started;
}

/** Start the scheduler interval once per process (idempotent). */
export function ensureSchedulerStarted(): void {
  if (shared.__ocSchedulerTimer || process.env.NODE_ENV === 'test' || process.env.OPEN_CODE_SCHEDULER === 'off') return;
  shared.__ocSchedulerTimer = setInterval(() => {
    runDueSchedules().catch((err) => console.error('[scheduler] tick failed:', err));
  }, TICK_MS);
  shared.__ocSchedulerTimer.unref?.();
  // Daily "Today in AI" digest (Upgrade OpenCode → Discover) — a plain job,
  // not an agent turn, so it runs on its own timer
  void import('./discover/digest').then((m) => m.startDigestScheduler(process.cwd())).catch(() => {});
}

export function stopScheduler(): void {
  if (shared.__ocSchedulerTimer) clearInterval(shared.__ocSchedulerTimer);
  shared.__ocSchedulerTimer = undefined;
}
