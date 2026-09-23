/**
 * Lightweight token usage & prompt tracer.
 * Each entry is written to the console as structured JSON so it can be
 * ingested by any log aggregator (Datadog, Langfuse, etc.) later.
 */

export type LogEntry = {
  timestamp: string;
  projectId: string;
  model: string;
  step: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs: number;
  toolCalls?: string[];
  error?: string;
};

let _sessionEntries: LogEntry[] = [];

export function logStep(entry: Omit<LogEntry, "timestamp">): void {
  const full: LogEntry = { ...entry, timestamp: new Date().toISOString() };
  _sessionEntries.push(full);
  // Pretty-print to server console for easy development debugging
  console.log(
    `[AI-TRACE] step=${full.step} model=${full.model} tokens=${full.totalTokens ?? "?"} duration=${full.durationMs}ms project=${full.projectId}`
  );
  if (full.toolCalls?.length) {
    console.log(`[AI-TRACE]   tools=${full.toolCalls.join(", ")}`);
  }
  if (full.error) {
    console.error(`[AI-TRACE]   error=${full.error}`);
  }
}

export function getSessionLog(): LogEntry[] {
  return [..._sessionEntries];
}

export function clearSessionLog(): void {
  _sessionEntries = [];
}
