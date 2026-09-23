import type { CandidateStatus } from "./types";

export interface AttemptSummary {
  id: string;
  candidateId: string;
  candidateName: string;
  registrationNumber?: string;
  status: CandidateStatus;
  startedAt?: string;
  endedAt?: string;
  score?: number;
  percentage?: number;
  warnings: number;
  violations: number;
  lastEventType?: string;
  lastEventTime?: string;
}
