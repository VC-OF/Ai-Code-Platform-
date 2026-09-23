// Server-only store helpers. Imported only from API routes & server components.
import "server-only";
export {
  authenticate,
  buildReport,
  createExam,
  findUserByRegistration,
  getAttempt,
  getCandidates,
  getCurrentSession,
  getExam,
  getOrCreateAttempt,
  getQuestion,
  getUserById,
  listAllAttempts,
  listExams,
  listQuestionsForExam,
  liveDashboard,
  pushEvent,
  recordAppActivity,
  recordSearch,
  recordWebsiteVisit,
  closeOpenWebsiteVisits,
  saveAnswers,
  setStatus,
  startAttempt,
  subscribe,
  updateExam,
  finalizeAttempt,
  addQuestionToBank,
} from "./store";

import { readSession } from "./session";
export async function getCurrentSession() {
  return readSession();
}
