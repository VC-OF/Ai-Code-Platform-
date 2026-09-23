// In-memory data store with synchronous-safe access.
// On a Next.js dev server, modules are shared across requests, so a single
// global instance simulates the real database/cache layer. In production
// this is replaced with Prisma/Postgres/Redis.

import { v4 as uuid } from "uuid";
import { seedExams, seedQuestions, seedUsers } from "./seed";
import type {
  AntiCheatingPolicy,
  AppActivity,
  AttemptSummary,
  CandidateStatus,
  Exam,
  ExamAttempt,
  Question,
  Report,
  SearchRecord,
  SecurityEvent,
  SecurityEventType,
  User,
  WebsiteVisit,
} from "./types";

interface DBShape {
  users: User[];
  exams: Exam[];
  questions: Question[];
  attempts: ExamAttempt[];
  // In-process pub-sub for the SSE/WebSocket-style live feed.
  listeners: Set<(payload: ServerEvent) => void>;
}

export type ServerEvent =
  | { type: "attempt_update"; attempt: ExamAttempt }
  | { type: "security_event"; attemptId: string; event: SecurityEvent }
  | {
      type: "log";
      level: "info" | "warn" | "error";
      message: string;
      meta?: any;
    };

declare global {
  // eslint-disable-next-line no-var
  var __JEXAM_DB__: DBShape | undefined;
}

function createDB(): DBShape {
  const users: User[] = seedUsers.map(({ plainPassword: _pp, ...u }) => {
    void _pp;
    return u;
  });
  return {
    users,
    exams: structuredClone(seedExams),
    questions: structuredClone(seedQuestions),
    attempts: [],
    listeners: new Set(),
  };
}

export const db: DBShape = globalThis.__JEXAM_DB__ ?? createDB();
if (!globalThis.__JEXAM_DB__) globalThis.__JEXAM_DB__ = db;

// ===== Auth =====

export function authenticate(email: string, password: string): User | null {
  const u = db.users.find((x) => x.email.toLowerCase() === email.toLowerCase());
  if (!u) return null;
  // Simulated password check. In production: bcrypt.compare.
  const candidate = seedUsers.find((x) => x.id === u.id);
  if (candidate?.plainPassword !== password) return null;
  return u;
}

export function findUserByRegistration(regNo: string): User | null {
  return db.users.find((u) => u.registrationNumber === regNo) ?? null;
}

export function getUserById(id: string): User | null {
  return db.users.find((u) => u.id === id) ?? null;
}

export function getCandidates(): User[] {
  return db.users.filter((u) => u.role === "candidate");
}

// ===== Exams / Questions =====

export function listExams(): Exam[] {
  return db.exams;
}
export function getExam(id: string): Exam | null {
  return db.exams.find((e) => e.id === id) ?? null;
}
export function listQuestionsForExam(examId: string): Question[] {
  const exam = getExam(examId);
  if (!exam) return [];
  return exam.questionIds
    .map((qid) => db.questions.find((q) => q.id === qid))
    .filter((q): q is Question => !!q);
}
export function getQuestion(id: string): Question | null {
  return db.questions.find((q) => q.id === id) ?? null;
}

export function createExam(
  input: Partial<Exam> & { title: string; level: Exam["level"] }
): Exam {
  const exam: Exam = {
    id: `exam_${uuid().slice(0, 8)}`,
    title: input.title,
    titleJa: input.titleJa ?? input.title,
    level: input.level,
    description: input.description ?? "",
    durationMinutes: input.durationMinutes ?? 60,
    startWindowStart: input.startWindowStart ?? new Date().toISOString(),
    startWindowEnd:
      input.startWindowEnd ??
      new Date(Date.now() + 7 * 86400_000).toISOString(),
    totalPoints: input.totalPoints ?? 0,
    passingScore: input.passingScore ?? 0,
    questionIds: input.questionIds ?? [],
    antiCheating: input.antiCheating ?? defaultPolicy(),
    assignedCandidateIds: input.assignedCandidateIds ?? [],
    status: input.status ?? "scheduled",
    createdAt: new Date().toISOString(),
  };
  db.exams.push(exam);
  return exam;
}

export function updateExam(id: string, patch: Partial<Exam>): Exam | null {
  const idx = db.exams.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  db.exams[idx] = { ...db.exams[idx], ...patch };
  return db.exams[idx];
}

export function addQuestionToBank(q: Omit<Question, "id">): Question {
  const question: Question = { id: `q_${uuid().slice(0, 8)}`, ...q };
  db.questions.push(question);
  return question;
}

function defaultPolicy(): AntiCheatingPolicy {
  return {
    enforceFullscreen: true,
    blockCopyPaste: true,
    blockRightClick: true,
    blockDevTools: true,
    allowTabSwitch: true,
    maxTabSwitches: 3,
    maxFullscreenExits: 2,
    maxCopyPasteAttempts: 2,
    detectWebsites: true,
    requireWebcam: false,
    recordScreen: false,
  };
}

// ===== Attempts =====

export function getOrCreateAttempt(
  examId: string,
  candidateId: string
): ExamAttempt {
  let attempt = db.attempts.find(
    (a) => a.examId === examId && a.candidateId === candidateId
  );
  if (attempt) return attempt;

  const exam = getExam(examId);
  const candidate = getUserById(candidateId);
  if (!exam || !candidate) throw new Error("Exam or candidate not found");

  attempt = {
    id: `att_${uuid().slice(0, 8)}`,
    examId,
    candidateId,
    candidateName: candidate.fullName,
    registrationNumber: candidate.registrationNumber,
    durationSeconds: 0,
    answers: {},
    status: "not_started",
    events: [],
    websiteActivity: [],
    searchHistory: [],
    applicationActivity: [],
    warnings: 0,
    violations: 0,
  };
  db.attempts.push(attempt);
  publish({ type: "attempt_update", attempt });
  return attempt;
}

export function getAttempt(id: string): ExamAttempt | null {
  return db.attempts.find((a) => a.id === id) ?? null;
}

export function listAttemptsForExam(examId: string): ExamAttempt[] {
  return db.attempts.filter((a) => a.examId === examId);
}

export function listAllAttempts(): ExamAttempt[] {
  return db.attempts;
}

export function startAttempt(attemptId: string): ExamAttempt | null {
  const a = getAttempt(attemptId);
  if (!a || a.startedAt) return a;
  a.startedAt = new Date().toISOString();
  a.status = "in_progress";
  a.autoSavedAt = a.startedAt;
  publish({ type: "attempt_update", attempt: a });
  return a;
}

export function saveAnswers(
  attemptId: string,
  answers: Record<string, string | string[]>
): ExamAttempt | null {
  const a = getAttempt(attemptId);
  if (!a) return null;
  a.answers = { ...a.answers, ...answers };
  a.autoSavedAt = new Date().toISOString();
  publish({ type: "attempt_update", attempt: a });
  return a;
}

export function setStatus(
  attemptId: string,
  status: CandidateStatus
): ExamAttempt | null {
  const a = getAttempt(attemptId);
  if (!a) return null;
  a.status = status;
  publish({ type: "attempt_update", attempt: a });
  return a;
}

export function finalizeAttempt(
  attemptId: string,
  opts: { autoSubmit?: boolean; terminated?: boolean } = {}
): ExamAttempt | null {
  const a = getAttempt(attemptId);
  if (!a) return null;
  a.endedAt = new Date().toISOString();
  if (a.startedAt) {
    a.durationSeconds = Math.floor(
      (Date.parse(a.endedAt) - Date.parse(a.startedAt)) / 1000
    );
  }
  // Score
  const exam = getExam(a.examId);
  if (exam) {
    const qs = listQuestionsForExam(exam.id);
    let score = 0;
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;
    for (const q of qs) {
      const ans = a.answers[q.id];
      const correctAnswers = Array.isArray(q.correctAnswer)
        ? q.correctAnswer
        : [q.correctAnswer];
      const given = Array.isArray(ans) ? ans : ans ? [ans] : [];
      if (given.length === 0) {
        unanswered++;
        continue;
      }
      const isCorrect =
        given.length === correctAnswers.length &&
        given.every((g) => correctAnswers.includes(g));
      if (isCorrect) {
        score += q.points;
        correct++;
      } else {
        incorrect++;
      }
    }
    a.score = score;
    a.percentage = Math.round((score / exam.totalPoints) * 100);
    a.passed = score >= exam.passingScore;
  }
  if (opts.terminated) {
    a.status = "terminated";
    a.finalVerdict = "invalid";
  } else {
    a.status = "completed";
    a.finalVerdict =
      a.violations >= 5 ? "review" : a.violations >= 1 ? "review" : "clean";
  }
  pushEvent(a.id, {
    type: opts.autoSubmit ? "auto_submit" : "terminated",
    detail: opts.autoSubmit
      ? "Exam auto-submitted at time limit"
      : "Exam submitted",
    severity: "low",
  });
  publish({ type: "attempt_update", attempt: a });
  return a;
}

// ===== Security event helpers =====

export function pushEvent(
  attemptId: string,
  input: {
    type: SecurityEventType;
    detail?: string;
    severity?: SecurityEvent["severity"];
  }
): SecurityEvent | null {
  const a = getAttempt(attemptId);
  if (!a) return null;
  const event: SecurityEvent = {
    id: `evt_${uuid().slice(0, 8)}`,
    type: input.type,
    timestamp: new Date().toISOString(),
    detail: input.detail,
    severity: input.severity ?? severityFor(input.type),
  };
  a.events.push(event);
  a.violations += severityWeight(event.severity);
  publish({ type: "security_event", attemptId, event });
  publish({ type: "attempt_update", attempt: a });
  return event;
}

function severityFor(t: SecurityEventType): SecurityEvent["severity"] {
  if (
    t === "tab_switch" ||
    t === "fullscreen_exit" ||
    t === "window_blur" ||
    t === "reconnected" ||
    t === "idle_timeout"
  )
    return "low";
  if (
    t === "copy_attempt" ||
    t === "paste_attempt" ||
    t === "cut_attempt" ||
    t === "right_click" ||
    t === "cheat_key"
  )
    return "medium";
  if (
    t === "devtools_open" ||
    t === "screenshot_attempt" ||
    t === "face_missing" ||
    t === "multiple_faces"
  )
    return "high";
  if (t === "terminated" || t === "disconnected") return "critical";
  return "low";
}

function severityWeight(s: SecurityEvent["severity"]): number {
  return { low: 1, medium: 2, high: 3, critical: 5 }[s];
}

export function recordWebsiteVisit(
  attemptId: string,
  visit: Omit<WebsiteVisit, "id" | "openedAt" | "visitCount"> & {
    openedAt?: string;
  }
): WebsiteVisit | null {
  const a = getAttempt(attemptId);
  if (!a) return null;
  // Merge consecutive visits to the same host.
  const last = [...a.websiteActivity]
    .reverse()
    .find((v) => v.url === visit.url && !v.closedAt);
  if (last) {
    last.closedAt = new Date().toISOString();
    if (last.openedAt) {
      last.durationSeconds = Math.floor(
        (Date.parse(last.closedAt) - Date.parse(last.openedAt)) / 1000
      );
    }
    publish({ type: "attempt_update", attempt: a });
    return last;
  }
  const v: WebsiteVisit = {
    id: `vis_${uuid().slice(0, 8)}`,
    openedAt: visit.openedAt ?? new Date().toISOString(),
    visitCount: 1,
    ...visit,
  };
  a.websiteActivity.push(v);
  publish({ type: "attempt_update", attempt: a });
  return v;
}

export function closeOpenWebsiteVisits(attemptId: string) {
  const a = getAttempt(attemptId);
  if (!a) return;
  const now = new Date().toISOString();
  for (const v of a.websiteActivity) {
    if (!v.closedAt) {
      v.closedAt = now;
      v.durationSeconds = Math.floor(
        (Date.parse(now) - Date.parse(v.openedAt)) / 1000
      );
    }
  }
  publish({ type: "attempt_update", attempt: a });
}

export function recordSearch(
  attemptId: string,
  s: Omit<SearchRecord, "id" | "timestamp"> & { timestamp?: string }
): SearchRecord | null {
  const a = getAttempt(attemptId);
  if (!a) return null;
  const rec: SearchRecord = {
    id: `srch_${uuid().slice(0, 8)}`,
    timestamp: s.timestamp ?? new Date().toISOString(),
    ...s,
  };
  a.searchHistory.push(rec);
  publish({ type: "attempt_update", attempt: a });
  return rec;
}

export function recordAppActivity(
  attemptId: string,
  app: Omit<AppActivity, "id" | "openedAt"> & { openedAt?: string }
): AppActivity | null {
  const a = getAttempt(attemptId);
  if (!a) return null;
  // If same app is still open, close previous.
  const open = [...a.applicationActivity]
    .reverse()
    .find((x) => x.appName === app.appName && !x.closedAt);
  if (open) {
    open.closedAt = new Date().toISOString();
    open.durationSeconds = Math.floor(
      (Date.parse(open.closedAt) - Date.parse(open.openedAt)) / 1000
    );
    publish({ type: "attempt_update", attempt: a });
    return open;
  }
  const rec: AppActivity = {
    id: `app_${uuid().slice(0, 8)}`,
    openedAt: app.openedAt ?? new Date().toISOString(),
    ...app,
  };
  a.applicationActivity.push(rec);
  publish({ type: "attempt_update", attempt: a });
  return rec;
}

// ===== Reports =====

export function buildReport(attemptId: string): Report | null {
  const a = getAttempt(attemptId);
  if (!a || !a.endedAt) return null;
  const exam = getExam(a.examId);
  if (!exam) return null;
  const qs = listQuestionsForExam(exam.id);
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;
  for (const q of qs) {
    const ans = a.answers[q.id];
    const correctAnswers = Array.isArray(q.correctAnswer)
      ? q.correctAnswer
      : [q.correctAnswer];
    const given = Array.isArray(ans) ? ans : ans ? [ans] : [];
    if (given.length === 0) unanswered++;
    else {
      const ok =
        given.length === correctAnswers.length &&
        given.every((g) => correctAnswers.includes(g));
      if (ok) correct++;
      else incorrect++;
    }
  }
  const tabSwitches = a.events.filter((e) => e.type === "tab_switch").length;
  const fullscreenExits = a.events.filter(
    (e) => e.type === "fullscreen_exit"
  ).length;
  const cpAttempts = a.events.filter(
    (e) =>
      e.type === "copy_attempt" ||
      e.type === "paste_attempt" ||
      e.type === "cut_attempt"
  ).length;
  const devtools = a.events.filter((e) => e.type === "devtools_open").length;
  const suspiciousEvents = a.events.filter(
    (e) => e.severity === "high" || e.severity === "critical"
  ).length;

  const severityLevel: Report["violationSummary"]["severityLevel"] =
    a.violations >= 10
      ? "critical"
      : a.violations >= 5
        ? "high"
        : a.violations >= 3
          ? "medium"
          : a.violations >= 1
            ? "low"
            : "none";

  const finalStatus: Report["violationSummary"]["finalStatus"] =
    a.status === "terminated"
      ? "invalid"
      : a.violations >= 5
        ? "review"
        : "valid";

  return {
    attemptId: a.id,
    candidate: {
      name: a.candidateName,
      registrationNumber: a.registrationNumber,
      examTitle: exam.title,
      examLevel: exam.level,
      startTime: a.startedAt ?? "",
      endTime: a.endedAt,
      durationSeconds: a.durationSeconds,
    },
    result: {
      score: a.score ?? 0,
      totalPoints: exam.totalPoints,
      correctAnswers: correct,
      incorrectAnswers: incorrect,
      unanswered,
      percentage: a.percentage ?? 0,
      passed: a.passed ?? false,
    },
    security: {
      tabSwitches,
      fullscreenExits,
      copyPasteAttempts: cpAttempts,
      devtoolsAttempts: devtools,
      externalWebsites: a.websiteActivity.length,
      applicationsOpened: a.applicationActivity.length,
      suspiciousEvents,
      warningsIssued: a.warnings,
    },
    websiteActivity: a.websiteActivity,
    searchHistory: a.searchHistory,
    applicationActivity: a.applicationActivity,
    events: a.events,
    violationSummary: {
      totalViolations: a.violations,
      severityLevel,
      recommendedAction:
        finalStatus === "invalid"
          ? "Invalidate examination"
          : finalStatus === "review"
            ? "Manual invigilator review required"
            : "No action required",
      finalStatus,
    },
  };
}

// ===== Live event pub/sub (for invigilator dashboard SSE) =====

export function subscribe(fn: (e: ServerEvent) => void): () => void {
  db.listeners.add(fn);
  return () => db.listeners.delete(fn);
}

export function publish(e: ServerEvent) {
  for (const l of db.listeners) {
    try {
      l(e);
    } catch {
      /* ignore broken listeners */
    }
  }
}

// ===== Summary helpers =====

export function liveDashboard(): {
  exam: Exam;
  attempts: AttemptSummary[];
} | null {
  const live = db.exams.find((e) => e.status === "live");
  if (!live) return null;
  const attempts = listAttemptsForExam(live.id).map((a) => {
    const eventCount = a.events.length;
    return {
      id: a.id,
      candidateId: a.candidateId,
      candidateName: a.candidateName,
      registrationNumber: a.registrationNumber,
      status: a.status,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      score: a.score,
      percentage: a.percentage,
      warnings: a.warnings,
      violations: a.violations,
      lastEventType: a.events[eventCount - 1]?.type,
      lastEventTime: a.events[eventCount - 1]?.timestamp,
    } satisfies AttemptSummary;
  });
  return { exam: live, attempts };
}
