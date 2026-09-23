export type AgentEventType =
  | 'plan'
  | 'tool_start'
  | 'tool_end'
  | 'tool_error'
  | 'text_delta'
  | 'text_done'
  | 'checkpoint'
  | 'compaction'
  | 'verification'
  | 'user_input_request'
  | 'plan_update'
  | 'error'
  | 'done'
  | 'status'
  | 'usage';

export type AgentStatus = 'planning' | 'reading' | 'writing' | 'linting' | 'testing' | 'running' | 'waiting' | 'done' | 'error' | 'compacting';

export type DoneReason = 'completed' | 'timeout' | 'max_steps' | 'user_cancelled' | 'error';

export interface BaseEvent {
  type: AgentEventType;
  ts: number;
  stepIndex: number;
}

export interface TextDeltaEvent extends BaseEvent {
  type: 'text_delta';
  delta: string;
}

export interface ToolStartEvent extends BaseEvent {
  type: 'tool_start';
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
}

export interface ToolEndEvent extends BaseEvent {
  type: 'tool_end';
  toolCallId: string;
  toolName: string;
  durationMs: number;
  result: {
    success: boolean;
    summary: string;
    diff?: string;
    linesChanged?: number;
  };
}

export interface CheckpointEvent extends BaseEvent {
  type: 'checkpoint';
  sha: string;
  message: string;
}

export interface VerificationEvent extends BaseEvent {
  type: 'verification';
  tool: 'run_lint' | 'run_tests';
  passed: boolean;
  errorCount: number;
  warningCount: number;
  summary: string;
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  message: string;
  recoverable: boolean;
}

export type AgentEvent =
  | TextDeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | CheckpointEvent
  | VerificationEvent
  | ErrorEvent
  | BaseEvent;

export class EventEmitter {
  constructor(private controller: ReadableStreamDefaultController) {}

  emit(event: Record<string, unknown>) {
    try {
      const line = JSON.stringify({ ...event, ts: Date.now() }) + '\n';
      this.controller.enqueue(new TextEncoder().encode(line));
    } catch {}
  }

  status(stepIndex: number, status: AgentStatus) {
    this.emit({ type: 'status', stepIndex, status });
  }

  plan(stepIndex: number, plan: string) {
    this.emit({ type: 'plan', stepIndex, plan });
  }

  usage(
    stepIndex: number,
    model: string,
    usage: { prompt: number; completion: number },
    contextWindow: number,
    costUsd?: number
  ) {
    this.emit({
      type: 'usage',
      stepIndex,
      model,
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
      contextWindow,
      costUsd,
    });
  }

  textDelta(stepIndex: number, delta: string) {
    this.emit({ type: 'text_delta', stepIndex, delta });
  }

  textDone(stepIndex: number, content: string) {
    this.emit({ type: 'text_done', stepIndex, content });
  }

  toolStart(
    stepIndex: number,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>
  ) {
    this.emit({ type: 'tool_start', stepIndex, toolCallId, toolName, args });
  }

  toolEnd(
    stepIndex: number,
    toolCallId: string,
    toolName: string,
    durationMs: number,
    success: boolean,
    summary: string,
    extra?: Record<string, unknown>
  ) {
    this.emit({
      type: 'tool_end',
      stepIndex,
      toolCallId,
      toolName,
      durationMs,
      result: { success, summary, ...extra },
    });
  }

  toolError(
    stepIndex: number,
    toolCallId: string,
    toolName: string,
    error: string,
    recoverable: boolean,
    suggestion?: string
  ) {
    this.emit({
      type: 'tool_error',
      stepIndex,
      toolCallId,
      toolName,
      error,
      recoverable,
      suggestion,
    });
  }

  checkpoint(stepIndex: number, sha: string, filesChanged: number) {
    this.emit({ type: 'checkpoint', stepIndex, sha, filesChanged });
  }

  compaction(
    stepIndex: number,
    before: { messages: number; tokens: number },
    after: { messages: number; tokens: number }
  ) {
    this.emit({ type: 'compaction', stepIndex, before, after });
  }

  done(
    stepIndex: number,
    reason: DoneReason,
    durationMs: number,
    filesChanged: string[],
    totalTokens: number
  ) {
    this.emit({ type: 'done', stepIndex, reason, durationMs, filesChanged, totalTokens });
  }

  error(stepIndex: number, message: string, recoverable: boolean) {
    this.emit({ type: 'error', stepIndex, message, recoverable });
  }
}
