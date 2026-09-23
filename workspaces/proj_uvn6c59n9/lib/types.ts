export type ExamLevel = "N5" | "N4" | "N3" | "N2" | "N1";
export type SectionType =
  "kanji" | "vocabulary" | "grammar" | "reading" | "listening" | "mcq";

export type MCQ = {
  id: string;
  type: "mcq";
  level: ExamLevel;
  section: SectionType;
  prompt: string;
  promptJa?: string;
  options: string[];
  answer: number;
  points: number;
};

export type ReadingQ = {
  id: string;
  type: "reading";
  level: ExamLevel;
  section: "reading";
  passage: string;
  questions: {
    id: string;
    prompt: string;
    options: string[];
    answer: number;
  }[];
  points: number;
};

export type ListeningQ = {
  id: string;
  type: "listening";
  level: ExamLevel;
  section: "listening";
  audioText: string; // simulated audio
  prompt: string;
  options: string[];
  answer: number;
  points: number;
};

export type Question = MCQ | ReadingQ | ListeningQ;

export type Exam = {
  id: string;
  name: string;
  level: ExamLevel;
  durationMinutes: number;
  scheduledAt: string;
  status: "scheduled" | "live" | "ended";
  sections: { name: string; type: SectionType; questionIds: string[] }[];
  antiCheat: {
    maxTabSwitches: number;
    maxFullscreenExits: number;
    maxCopyPasteAttempts: number;
    autoTerminateOnLimit: boolean;
    disableClipboard: boolean;
    enforceFullscreen: boolean;
    disableRightClick: boolean;
  };
};

export type CandidateStatus =
  | "registered"
  | "waiting"
  | "in_progress"
  | "completed"
  | "disconnected"
  | "terminated"
  | "suspicious";

export type Candidate = {
  id: string;
  name: string;
  email: string;
  regNo: string;
  status: CandidateStatus;
  examId?: string;
  startedAt?: string;
  finishedAt?: string;
  score?: number;
  ip: string;
  location: string;
  device: string;
};

export type ViolationType =
  | "tab_switch"
  | "fullscreen_exit"
  | "copy_attempt"
  | "paste_attempt"
  | "cut_attempt"
  | "right_click"
  | "devtools"
  | "external_site"
  | "app_open"
  | "search"
  | "face_missing"
  | "multiple_faces"
  | "disconnect";

export type Violation = {
  id: string;
  candidateId: string;
  examId: string;
  type: ViolationType;
  detail: string;
  url?: string;
  query?: string;
  timestamp: string;
  severity: "low" | "medium" | "high";
};

export type WebsiteVisit = {
  candidateId: string;
  website: string;
  url: string;
  openedAt: string;
  durationSec: number;
  visits: number;
};

export type SearchEntry = {
  candidateId: string;
  engine:
    | "Google"
    | "ChatGPT"
    | "Gemini"
    | "Claude"
    | "DeepSeek"
    | "Bing"
    | "YouTube"
    | "Other";
  query: string;
  url: string;
  timestamp: string;
};

export type AppOpen = {
  candidateId: string;
  app: string;
  openedAt: string;
  durationSec: number;
  count: number;
};

export type ExamResult = {
  candidateId: string;
  examId: string;
  startTime: string;
  endTime: string;
  durationSec: number;
  score: number;
  total: number;
  correct: number;
  incorrect: number;
  percentage: number;
  passed: boolean;
  security: {
    tabSwitches: number;
    fullscreenExits: number;
    copyPasteAttempts: number;
    devtoolsAttempts: number;
    externalSites: number;
    appsOpened: number;
    suspiciousEvents: number;
    warnings: number;
  };
  finalStatus: "Valid" | "Under Review" | "Invalidated";
  severity: "None" | "Low" | "Medium" | "High";
  recommendation: string;
};
