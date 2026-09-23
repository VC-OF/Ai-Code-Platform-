// Core domain types for the Japanese Exam Platform.
// These mirror the shape of records that would live in PostgreSQL.

export type UserRole = "admin" | "invigilator" | "candidate";

export type QuestionType =
  "mcq" | "reading" | "listening" | "vocabulary" | "grammar" | "kanji";

export type ExamLevel = "N5" | "N4" | "N3" | "N2" | "N1";

export interface User {
  id: string;
  email: string;
  passwordHash: string; // simulated
  fullName: string;
  fullNameJa?: string;
  registrationNumber?: string;
  role: UserRole;
  createdAt: string;
}

export interface Question {
  id: string;
  examId: string;
  type: QuestionType;
  section: string; // e.g. "文字・語彙", "文法", "読解", "聴解"
  level: ExamLevel;
  prompt: string; // English / instruction
  promptJa?: string; // Japanese prompt if applicable
  readingPassage?: string; // for reading
  audioUrl?: string; // for listening (mocked)
  imageUrl?: string;
  choices?: { id: string; text: string; textJa?: string }[];
  correctAnswer: string | string[];
  points: number;
  explanation?: string;
}

export interface Exam {
  id: string;
  title: string;
  titleJa: string;
  level: ExamLevel;
  description: string;
  durationMinutes: number;
  startWindowStart: string; // ISO
  startWindowEnd: string; // ISO
  totalPoints: number;
  passingScore: number;
  questionIds: string[];
  antiCheating: AntiCheatingPolicy;
  assignedCandidateIds: string[];
  status: "draft" | "scheduled" | "live" | "closed";
  createdAt: string;
}

export interface AntiCheatingPolicy {
  enforceFullscreen: boolean;
  blockCopyPaste: boolean;
  blockRightClick: boolean;
  blockDevTools: boolean;
  allowTabSwitch: boolean; // if false, terminate on first switch
  maxTabSwitches: number; // warnings before terminate
  maxFullscreenExits: number;
  maxCopyPasteAttempts: number;
  detectWebsites: boolean; // best effort in-browser
  requireWebcam: boolean;
  recordScreen: boolean;
}

export type CandidateStatus =
  | "not_started"
  | "in_progress"
  | "paused"
  | "completed"
  | "disconnected"
  | "terminated"
  | "suspicious";

export interface ExamAttempt {
  id: string;
  examId: string;
  candidateId: string;
  candidateName: string;
  registrationNumber?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds: number;
  answers: Record<string, string | string[]>;
  autoSavedAt?: string;
  status: CandidateStatus;
  score?: number;
  percentage?: number;
  passed?: boolean;
  events: SecurityEvent[];
  websiteActivity: WebsiteVisit[];
  searchHistory: SearchRecord[];
  applicationActivity: AppActivity[];
  warnings: number;
  violations: number;
  finalVerdict?: "clean" | "review" | "invalid";
}

export type SecurityEventType =
  | "tab_switch"
  | "fullscreen_exit"
  | "fullscreen_enter"
  | "copy_attempt"
  | "paste_attempt"
  | "cut_attempt"
  | "right_click"
  | "devtools_open"
  | "devtools_close"
  | "window_blur"
  | "window_focus"
  | "face_missing"
  | "multiple_faces"
  | "screenshot_attempt"
  | "idle_timeout"
  | "disconnected"
  | "reconnected"
  | "auto_submit"
  | "terminated"
  | "cheat_key";

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  timestamp: string;
  detail?: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface WebsiteVisit {
  id: string;
  website: string;
  url: string;
  category:
    | "search"
    | "ai"
    | "translation"
    | "video"
    | "dictionary"
    | "social"
    | "other";
  openedAt: string;
  closedAt?: string;
  durationSeconds?: number;
  visitCount: number;
}

export interface SearchRecord {
  id: string;
  engine: string;
  query: string;
  url: string;
  timestamp: string;
}

export interface AppActivity {
  id: string;
  appName: string;
  openedAt: string;
  closedAt?: string;
  durationSeconds?: number;
  detectionMethod: "visible" | "heartbeat" | "synthetic";
}

export interface Report {
  attemptId: string;
  candidate: {
    name: string;
    registrationNumber?: string;
    examTitle: string;
    examLevel: ExamLevel;
    startTime: string;
    endTime: string;
    durationSeconds: number;
  };
  result: {
    score: number;
    totalPoints: number;
    correctAnswers: number;
    incorrectAnswers: number;
    unanswered: number;
    percentage: number;
    passed: boolean;
  };
  security: {
    tabSwitches: number;
    fullscreenExits: number;
    copyPasteAttempts: number;
    devtoolsAttempts: number;
    externalWebsites: number;
    applicationsOpened: number;
    suspiciousEvents: number;
    warningsIssued: number;
  };
  websiteActivity: WebsiteVisit[];
  searchHistory: SearchRecord[];
  applicationActivity: AppActivity[];
  events: SecurityEvent[];
  violationSummary: {
    totalViolations: number;
    severityLevel: "none" | "low" | "medium" | "high" | "critical";
    recommendedAction: string;
    finalStatus: "valid" | "review" | "invalid";
  };
}
