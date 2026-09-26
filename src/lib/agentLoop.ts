import { APPROVAL_REQUIRED_TOOLS } from './permissions';
import { execSync } from 'child_process';
import {
  callLLM,
  callLLMStream,
  getContextWindow,
  parseContextLengthError,
  type LLMConfig,
  type LLMMessage,
  type LLMTool,
} from './llmClient';
import { recordContextWindow } from './models';
import { EventEmitter, type AgentStatus, type DoneReason } from './events';
import {
  compactMessages,
  shouldCompact,
  estimateTokens,
  estimateMessageTokens,
  splitForCompaction,
  serializeForSummary,
  SUMMARIZE_SYSTEM_PROMPT,
  type ContextMessage,
} from './contextManager';
import { CancellationSource, CancelledError, cancellableSleep } from './cancellation';
import { trackUsage } from './usageTracker';
import { messageDb, checkpointDb, toolLogDb, projectDb, type PlanTask } from './db';
import { executeTool, createTurnContext } from './tools';
import { validateTool } from './toolValidator';
import { normalizeToolArgs } from './toolArgNormalize';
import { loadHooks, runHooks, summarizeHookResults, EMPTY_HOOKS, type HookConfig, type HookRunResult } from './hooks';
import { runSubagent, subagentEdits, type SubagentRunResult, type SubagentKind } from './subagents';
import { supportsVision } from './models';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────
function envPositiveInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
// Per-turn limits; hitting either ends the turn in the paused state
// ('max_steps' / 'timeout') so the user can press Continue.
const MAX_STEPS    = envPositiveInt('AGENT_MAX_STEPS', 150);
const MAX_DURATION = envPositiveInt('AGENT_MAX_DURATION_MIN', 60) * 60_000;
const STEP_TIMEOUT = 300_000;      // 5 min per LLM call (prevents premature timeout on reasoning models)
const MAX_TRUNCATIONS = 3;         // consecutive cut-off replies before giving up
const MAX_LLM_RETRIES = 5;         // transient model/provider failures retried per step (2s…32s backoff)
const MAX_CONTEXT_RETRIES = 3;     // "prompt too long" → compact and retry, this many times per step
const MAX_VERIFY_NUDGES = 2;       // times we ask for run_lint/run_tests before letting the turn end
const PLAN_INSTRUCTION =
  '[Planning step — tools are disabled for this reply.] Write a short numbered plan (at most ~10 lines) of the ' +
  'steps and files you will create or change to fulfil the request above. Do not write code, do not simulate ' +
  'tool output, and do not claim anything has been done yet.';
const EXECUTE_PLAN_INSTRUCTION =
  'Nothing from that plan has been executed yet. Carry it out now using tool calls, then verify with run_lint/run_tests.';
const MAX_NO_ACTION_NUDGES = 1;     // times we challenge a "done" reply from a turn that ran no tools
const MAX_TEXT_TOOL_NUDGES = 3;    // times we correct tool calls written as plain text
const MAX_STOP_HOOK_NUDGES = 2;    // times a Stop hook (exit 2) may send the agent back to work
const MAX_SUBAGENT_DEPTH = 1;      // sub-agents cannot spawn sub-agents
const BUDGET_WARNING_STEPS = 5;    // steps before the cap at which the model is told to wrap up
const COMPACT_AT   = 0.60;         // Compact at 60% context
const COMPACT_TO   = 0.40;         // Compact down to 40%

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AgentLoopOptions {
  projectId: string;
  workspaceRoot: string;
  messages: LLMMessage[];
  /** How many of `messages` are already persisted in the DB (loaded history).
   *  Only messages after this count are saved at the end of the turn. */
  persistedCount?: number;
  llmConfig: LLMConfig;
  tools: LLMTool[];
  systemPrompt: string;
  agentsMemory?: string;       // AGENTS.md content
  activeFilePath?: string;     // Currently open file
  turnIndex: number;
  emitter: EventEmitter;
  cancellation: CancellationSource;
  /** Blocks until the user answers an ask_user question (agentManager wires
   *  this to the /api/chat/input endpoint). Absent = non-interactive run. */
  waitForUserInput?: (question: string, options?: string[]) => Promise<string>;
  /** Returns and clears user messages queued while the agent was running,
   *  injected before the next LLM step so the user can steer mid-run. */
  drainQueuedMessages?: () => string[];
  /** Persisted task plan from earlier turns — injected as context so the
   *  agent resumes interrupted work instead of starting over. */
  currentPlan?: PlanTask[];
  /** Execution mode: 'auto' (autonomous), 'manual' (step approval), or 'plan' (architect) */
  executionMode?: 'auto' | 'manual' | 'plan';
  /** Set when this loop is a sub-agent spawned by another turn: no plan
   *  step, no persistence, no git checkpoints, its own step/time budget. */
  nested?: {
    depth: number;
    label: string;
    kind: SubagentKind;
    maxSteps?: number;
    maxDurationMs?: number;
  };
}

export interface AgentLoopResult {
  success: boolean;
  reason: DoneReason;
  stepsCompleted: number;
  filesChanged: string[];
  totalTokens: number;
  durationMs: number;
  finalMessage?: string;
}

// ─── Main agent loop ──────────────────────────────────────────────────────────
export async function runAgentLoop(
  opts: AgentLoopOptions
): Promise<AgentLoopResult> {
  const {
    projectId,
    workspaceRoot,
    llmConfig,
    tools,
    systemPrompt,
    agentsMemory,
    activeFilePath,
    turnIndex,
    emitter,
    cancellation,
  } = opts;

  const nested       = opts.nested;
  const depth        = nested?.depth ?? 0;
  const maxSteps     = nested?.maxSteps ?? MAX_STEPS;
  const maxDuration  = nested?.maxDurationMs ?? MAX_DURATION;
  const startTime    = Date.now();
  const ctx          = createTurnContext();
  const filesChanged: string[] = [];
  let hooks: HookConfig = EMPTY_HOOKS;
  let stopHookNudges = 0;
  let totalTokens    = 0;
  let stepIndex      = 0;
  let finalMessage   = '';
  let checkpointed   = false;
  let pausedMs       = 0;   // Time spent waiting on ask_user — excluded from the duration cap
  let llmRetries     = 0;   // consecutive failed model calls (reset on success)
  let textToolNudges = 0;
  let noActionNudges = 0;
  let toolsExecuted  = 0;   // real tool executions this turn
  const toolNames = tools.map((t) => (t as { function?: { name?: string } }).function?.name ?? '').filter(Boolean);

  // ── Build initial message list ───────────────────────────────────────────
  let messages: ContextMessage[] = buildInitialMessages(
    systemPrompt,
    agentsMemory,
    opts.messages
  );

  // Track which message objects are already persisted (system prompt +
  // loaded history) by identity — compaction can change array indices, so
  // index-based slicing would mis-persist. Anything not in this set at the
  // end of the turn is new and gets saved.
  const alreadyPersisted = new WeakSet<object>();
  messages
    .slice(0, 1 + (opts.persistedCount ?? 0))
    .forEach((m) => alreadyPersisted.add(m));

  // Save what this turn has produced so far: called after every step and
  // when the turn ends early (cancel / error), so a server restart mid-turn
  // loses at most the step in flight and a follow-up "continue" sees the
  // work done so far
  const persistPartial = () => {
    if (nested) return; // a sub-agent's transcript is never chat history
    try {
      const fresh = messages.filter((m) => !alreadyPersisted.has(m));
      persistMessages(projectId, closeDanglingToolCalls(fresh), turnIndex);
      fresh.forEach((m) => alreadyPersisted.add(m));
      projectDb.touch(projectId);
    } catch {}
  };

  // Per-request context rides in an ephemeral tail message (never persisted,
  // never stale in history) so the system+history prefix stays byte-stable
  // for provider-side prompt caching
  const incompletePlan =
    opts.currentPlan?.some((t) => t.status !== 'completed') ?? false;
  if (!nested && incompletePlan) {
    const planText = opts.currentPlan!
      .map((t) => `- [${t.status === 'completed' ? 'x' : t.status === 'in_progress' ? '~' : ' '}] ${t.title} (${t.id})`)
      .join('\n');
    const planMsg = {
      role: 'user',
      content:
        `[Context: your persisted task plan from earlier turns has unfinished items — ` +
        `continue from it (update statuses via update_plan as you go):]\n${planText}`,
    } as ContextMessage;
    alreadyPersisted.add(planMsg);
    messages.push(planMsg);
  }

  if (activeFilePath) {
    const contextMsg = {
      role: 'user',
      content: `[Context: the user currently has ${activeFilePath} open in the editor.]`,
    } as ContextMessage;
    alreadyPersisted.add(contextMsg);
    messages.push(contextMsg);
  }

  emitter.status(0, 'planning');

  try {
    // ── Step 0: Forced planning (no tools) ────────────────────────────────
    const lastUserMsg = opts.messages
      .filter((m) => m.role === 'user')
      .at(-1)?.content ?? '';

    const needsPlan = !nested && (lastUserMsg?.toString() ?? '').length > 40;

    // Hooks from .claude/settings.json — the same config /hooks reports
    hooks = await loadHooks(workspaceRoot).catch(() => EMPTY_HOOKS);
    for (const e of hooks.errors) emitter.error(0, `Hook config: ${e}`, true);

    if (!nested && hooks.hooks.length > 0) {
      const promptText = typeof lastUserMsg === 'string' ? lastUserMsg : JSON.stringify(lastUserMsg ?? '');
      const promptHooks = await runHooks(
        hooks,
        { event: 'UserPromptSubmit', projectId, workspace: workspaceRoot, prompt: promptText },
        { signal: cancellation.token.signal }
      );
      emitHookResults(emitter, 0, promptHooks);
      const verdict = summarizeHookResults(promptHooks);
      if (verdict.blocked) {
        emitter.error(0, `Blocked by a UserPromptSubmit hook: ${verdict.reason}`, false);
        emitter.status(0, 'error');
        return buildResult('error', 0, filesChanged, totalTokens, startTime);
      }
    }

    if (needsPlan) {
      cancellation.token.throwIfCancelled();

      // The upfront plan is an optimisation — a failed/slow call must not
      // sink the whole turn; the execution loop has its own retries
      let planResponse: Awaited<ReturnType<typeof callLLM>> | null = null;
      try {
        planResponse = await callWithTimeout(
          // Without an explicit planning instruction a tool-less reply is just
          // an answer — models then narrate fake work ("created files, tests
          // pass") that the loop mistook for a finished turn
          callLLM(llmConfig, [...messages, { role: 'user', content: PLAN_INSTRUCTION }] as LLMMessage[], undefined, {
            toolChoice: 'none',
            signal: cancellation.token.signal,
          }),
          STEP_TIMEOUT
        );
      } catch (err) {
        if (err instanceof CancelledError || cancellation.isCancelled) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        emitter.error(0, `Planning call failed (${msg.slice(0, 300)}) — continuing without an upfront plan`, true);
      }

      const planText = planResponse?.content ?? '';

      // A "plan" that is really tool calls written as text would teach the
      // model to keep writing calls as text — keep it out of the history
      if (planResponse && planText && !looksLikeTextToolCall(planText, toolNames)) {
        emitter.plan(0, planText);
        messages.push({ role: 'assistant', content: planText });
        messages.push({ role: 'user', content: EXECUTE_PLAN_INSTRUCTION } as ContextMessage);
        totalTokens += planResponse.usage.total_tokens;

        // Track usage
        trackUsage({
          projectId,
          model:             llmConfig.model,
          promptTokens:     planResponse.usage.prompt_tokens,
          completionTokens: planResponse.usage.completion_tokens,
          turnIndex,
        });

        emitter.usage(
          0,
          llmConfig.model,
          { prompt: planResponse.usage.prompt_tokens, completion: planResponse.usage.completion_tokens },
          getContextWindow(llmConfig.model)
        );
      }
    }

    // ── Main execution loop ────────────────────────────────────────────────
    // Replies cut off by the output-token cap: count in a row, and text
    // carried over so a continued answer is shown whole
    let truncations = 0;
    let carriedText = '';

    let hitTimeLimit = false;
    let verifyNudges = 0;
    let contextRetries = 0;

    /**
     * Shrink the working context. Preferred: replace the oldest span with an
     * LLM-written summary so the agent keeps usable memory of what it read,
     * built and decided; fallback: placeholder compaction of bulky tool
     * output. `force` (after a provider "prompt too long" rejection) keeps
     * fewer recent messages verbatim and applies both passes if needed.
     * Returns true when the estimated size actually went down.
     */
    const compactContext = async (force: boolean): Promise<boolean> => {
      emitter.status(stepIndex, 'compacting');
      const before = {
        messages: messages.length,
        tokens:   messages.reduce((s, m) => s + estimateMessageTokens(m), 0),
      };

      const split = splitForCompaction(messages, force ? 4 : 8);
      let summarized = false;

      if (split) {
        try {
          const summaryResp = await callWithTimeout(
            callLLM(
              llmConfig,
              [
                { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
                { role: 'user', content: serializeForSummary(split.evicted) },
              ],
              undefined,
              { toolChoice: 'none', signal: cancellation.token.signal }
            ),
            STEP_TIMEOUT
          );

          const summary = summaryResp.content?.trim();
          if (summary) {
            const summaryMsg = {
              role: 'user',
              content:
                '[Context summary — earlier conversation was compacted. ' +
                'This brief is your memory of that span:]\n\n' + summary,
            } as ContextMessage;
            // Ephemeral working memory — the originals are already in the
            // DB, so the summary itself must not be persisted as history
            alreadyPersisted.add(summaryMsg);
            messages = [...split.head, summaryMsg, ...split.preserved];
            summarized = true;

            totalTokens += summaryResp.usage.total_tokens;
            trackUsage({
              projectId,
              model:            llmConfig.model,
              promptTokens:     summaryResp.usage.prompt_tokens,
              completionTokens: summaryResp.usage.completion_tokens,
              turnIndex,
            });
          }
        } catch (err) {
          if (err instanceof CancelledError) throw err;
          // Fall through to placeholder compaction below
        }
      }

      const stillTooBig = () =>
        shouldCompact(messages, { model: llmConfig.model, targetRatio: force ? COMPACT_TO : COMPACT_AT });
      if (!summarized || (force && stillTooBig())) {
        // Placeholder compaction preserves length/order but clones some
        // message objects — re-mark persisted membership positionally so
        // clones of already-saved history aren't saved again
        const wasPersisted = messages.map((m) => alreadyPersisted.has(m));
        const result = compactMessages(messages, {
          model:         llmConfig.model,
          targetRatio:   COMPACT_AT,
          minRatio:      COMPACT_TO,
          preserveLastN: force ? 4 : 8,
        });
        messages = result.messages;
        messages.forEach((m, i) => {
          if (wasPersisted[i]) alreadyPersisted.add(m);
        });
      }

      const after = {
        messages: messages.length,
        tokens:   messages.reduce((s, m) => s + estimateMessageTokens(m), 0),
      };
      emitter.compaction(stepIndex, before, after);
      emitter.status(stepIndex, 'planning');
      return after.tokens < before.tokens;
    };

    for (stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
      // ── Safety checks ────────────────────────────────────────────────────
      cancellation.token.throwIfCancelled();

      const elapsed = Date.now() - startTime - pausedMs;
      if (elapsed >= maxDuration) {
        // End in the paused state (not an error) so the UI offers Continue
        hitTimeLimit = true;
        break;
      }

      // ── Mid-run steering: inject messages the user queued ────────────────
      const queued = opts.drainQueuedMessages?.() ?? [];
      for (const text of queued) {
        messages.push({ role: 'user', content: text } as ContextMessage);
      }

      // ── Step budget warning: wrap up instead of running into the cap ──────
      if (stepIndex === maxSteps - BUDGET_WARNING_STEPS + 1) {
        const warning = nested
          ? `[Budget: ${BUDGET_WARNING_STEPS} steps left for this sub-agent. Stop exploring now and write your final report with what you have — a partial report is far more useful than none.]`
          : `[Budget: ${BUDGET_WARNING_STEPS} steps left in this turn. Bring the work to a safe point: update_plan with accurate statuses and summarize what is done and what remains; the next turn resumes from the plan.]`;
        const msg = { role: 'user', content: warning } as ContextMessage;
        alreadyPersisted.add(msg); // loop bookkeeping, not conversation
        messages.push(msg);
        emitter.emit({ type: 'budget_warning', stepIndex, stepsLeft: BUDGET_WARNING_STEPS, nested: Boolean(nested) });
      }

      // ── Context compaction ────────────────────────────────────────────────
      if (shouldCompact(messages, { model: llmConfig.model, targetRatio: COMPACT_AT })) {
        await compactContext(false);
      }

      // ── LLM call ──────────────────────────────────────────────────────────
      let textContent = '';
      let reasoningText = '';   // thinking tokens: shown in the UI, never sent back
      let inLLMCall = false;

      try {
        // Stream text for better UX
        let toolCalls:
          | { id: string; type: 'function'; function: { name: string; arguments: string } }[]
          | null = null;
        let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        let finishReason: string | null = null;

        inLLMCall = true;
        const stream = callLLMStream(
          llmConfig,
          messages as LLMMessage[],
          tools,
          {
            toolChoice: 'auto',
            signal:     cancellation.token.signal,
          }
        );

        const toolCallAccumulators: Record<number, {
          id: string; name: string; args: string;
        }> = {};

        for await (const chunk of stream) {
          cancellation.token.throwIfCancelled();

          if (chunk.type === 'fallback') {
            emitter.error(
              stepIndex,
              `${llmConfig.model} failed (${chunk.reason}); this step uses fallback model ${chunk.model}`,
              true
            );
          }

          if (chunk.type === 'delta' && chunk.delta) {
            textContent += chunk.delta;
            emitter.textDelta(stepIndex, chunk.delta);
          }

          if (chunk.type === 'reasoning_delta' && chunk.delta) {
            reasoningText += chunk.delta;
            emitter.emit({ type: 'reasoning_delta', stepIndex, delta: chunk.delta });
          }

          if (chunk.type === 'tool_call_delta' && chunk.tool_call) {
            const { index, id, name, args } = chunk.tool_call;
            if (!toolCallAccumulators[index]) {
              toolCallAccumulators[index] = { id: id ?? '', name: name ?? '', args: '' };
            }
            if (id)   toolCallAccumulators[index].id   = id;
            if (name) toolCallAccumulators[index].name = name;
            if (args) toolCallAccumulators[index].args += args;
          }

          if (chunk.type === 'done') {
            finishReason = chunk.finishReason ?? null;
            if (chunk.usage) {
              usage = {
                prompt_tokens:     chunk.usage.prompt_tokens,
                completion_tokens: chunk.usage.completion_tokens,
                total_tokens:      chunk.usage.prompt_tokens + chunk.usage.completion_tokens,
              };
            }
          }
        }

        inLLMCall = false;
        llmRetries = 0;

        if (reasoningText) {
          emitter.emit({ type: 'reasoning_done', stepIndex, content: reasoningText });
        }

        // Assemble tool calls
        const accumulatedCalls = Object.values(toolCallAccumulators);
        if (accumulatedCalls.length > 0) {
          toolCalls = accumulatedCalls.map((tc) => ({
            id:   tc.id,
            type: 'function',
            function: {
              name:      tc.name,
              arguments: tc.args,
            },
          }));
        }

        if (textContent) {
          emitter.textDone(stepIndex, textContent);
        }

        // Fallback: some OpenAI-compatible servers don't report streaming
        // usage — estimate so cost/context tracking is never silently zero
        if (usage.total_tokens === 0) {
          const promptEst = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
          const completionEst =
            estimateTokens(textContent) +
            Object.values(toolCallAccumulators).reduce(
              (s, tc) => s + estimateTokens(tc.args), 0);
          usage = {
            prompt_tokens:     promptEst,
            completion_tokens: completionEst,
            total_tokens:      promptEst + completionEst,
          };
        }

        totalTokens += usage.total_tokens;

        // Track usage
        const { costUsd } = trackUsage({
          projectId,
          model:             llmConfig.model,
          promptTokens:     usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          turnIndex,
        });

        emitter.usage(
          stepIndex,
          llmConfig.model,
          { prompt: usage.prompt_tokens, completion: usage.completion_tokens },
          getContextWindow(llmConfig.model),
          costUsd
        );

        // ── Output cut off by the token cap ─────────────────────────────────
        if (finishReason === 'length') {
          truncations++;
          if (truncations > MAX_TRUNCATIONS) {
            throw new Error(
              `The model's reply was cut off by the output-token limit ${truncations} times in a row. ` +
              'Raise LLM_MAX_OUTPUT_TOKENS, pick a model with a larger output limit, or ask for smaller changes.'
            );
          }

          if (toolCalls && toolCalls.length > 0) {
            // Truncated tool arguments are incomplete — never execute them
            const names = toolCalls.map((tc) => tc.function.name).join(', ');
            for (const tc of toolCalls) {
              emitter.toolError(
                stepIndex, tc.id, tc.function.name,
                'Reply was cut off by the output-token limit before this call finished', true,
                'Retrying in smaller parts'
              );
            }
            messages.push({ role: 'assistant', content: textContent || null } as ContextMessage);
            messages.push({
              role: 'user' as const,
              content:
                `Your last reply was cut off by the output-token limit while writing ${names}, so nothing was applied. ` +
                'Write large files in parts: create_file with the first ~300 lines, then append_file for each further part ' +
                '(each under ~300 lines). For edits, use smaller edit_file or replace_lines calls.',
            } as ContextMessage);
          } else {
            carriedText += textContent;
            messages.push({ role: 'assistant', content: textContent || null } as ContextMessage);
            messages.push({
              role: 'user' as const,
              content: 'Your reply was cut off by the output-token limit. Continue exactly where you stopped, without repeating anything.',
            } as ContextMessage);
          }
          continue;
        }
        truncations = 0;

        // Tool calls written as plain text (some models/servers fall back to
        // this) would otherwise end the turn as if it were the final answer
        if ((!toolCalls || toolCalls.length === 0) &&
            textToolNudges < MAX_TEXT_TOOL_NUDGES &&
            looksLikeTextToolCall(textContent, toolNames)) {
          textToolNudges++;
          messages.push({ role: 'assistant', content: textContent || null } as ContextMessage);
          messages.push({
            role: 'user' as const,
            content:
              'Your last reply wrote tool calls as plain text, so nothing was executed and no files changed. ' +
              'Invoke tools through the function-calling interface (a real tool call), one or more per reply — ' +
              'do not describe or print them.',
          } as ContextMessage);
          emitter.toolError(
            stepIndex, `text-tool-${stepIndex}`, 'text_tool_call',
            'Model wrote tool calls as plain text; asking it to use real tool calls', true
          );
          continue;
        }

        // A "finished" reply from a turn that never ran a tool yet claims to
        // have created/run things is a hallucinated completion
        if ((!toolCalls || toolCalls.length === 0) &&
            needsPlan && toolsExecuted === 0 &&
            noActionNudges < MAX_NO_ACTION_NUDGES &&
            claimsCompletedWork(textContent)) {
          noActionNudges++;
          messages.push({ role: 'assistant', content: textContent || null } as ContextMessage);
          messages.push({
            role: 'user' as const,
            content:
              'No tool has been executed in this turn, so no files exist and nothing has been run — ' +
              'the work you describe has not happened. Do it now with real tool calls ' +
              '(create_file, run_command, run_tests, …). If the request needs no changes, say so plainly.',
          } as ContextMessage);
          continue;
        }

        // If no tool calls = agent is done
        if (!toolCalls || toolCalls.length === 0) {
          // Enforce verification before finishing
          if (ctx.hasEdits && !ctx.hasRunLint && !ctx.hasRunTests && verifyNudges < MAX_VERIFY_NUDGES) {
            verifyNudges++;
            messages.push({
              role:    'assistant',
              content: textContent || null,
            } as ContextMessage);

            messages.push({
              role:    'user' as const,
              content:
                '⚠️ You made file changes but did not run verification. ' +
                'Please run run_lint or run_tests before finishing.',
            } as ContextMessage);

            continue; // Force another step
          }

          // Stop hooks: exit 2 sends the agent back to work with the feedback
          if (hooks.hooks.length > 0 && stopHookNudges < MAX_STOP_HOOK_NUDGES) {
            const stopResults = await runHooks(
              hooks,
              {
                event: nested ? 'SubagentStop' : 'Stop',
                projectId,
                workspace: workspaceRoot,
                finalMessage: carriedText + textContent,
              },
              { signal: cancellation.token.signal }
            );
            emitHookResults(emitter, stepIndex, stopResults);
            const verdict = summarizeHookResults(stopResults);
            if (verdict.blocked) {
              stopHookNudges++;
              messages.push({ role: 'assistant', content: textContent || null } as ContextMessage);
              messages.push({
                role: 'user' as const,
                content: `[A Stop hook blocked finishing (exit 2). Address this before you finish:]\n${verdict.reason}`,
              } as ContextMessage);
              continue;
            }
          }

          finalMessage = carriedText + textContent;
          // Keep the reply in history — without it the next turn's model never
          // saw its own summary (truncation parts were pushed already)
          if (textContent) {
            messages.push({ role: 'assistant', content: textContent } as ContextMessage);
          }
          break;
        }

        // Add assistant message with tool calls
        messages.push({
          role:       'assistant',
          content:    textContent || null,
          tool_calls: toolCalls,
        } as ContextMessage);

        // ── Execute tool calls ─────────────────────────────────────────────
        // spawn_agent calls start immediately and run concurrently; their
        // reports are filled into placeholder tool messages after the batch
        const pendingSubagents: {
          msg: ContextMessage;
          promise: Promise<SubagentRunResult>;
          toolCallId: string;
          started: number;
          args: Record<string, unknown>;
        }[] = [];
        // view_image attachments go after ALL tool results: a user message
        // between tool results would break the tool_calls/tool pairing
        const attachedImages: ContextMessage[] = [];

        for (const tc of toolCalls) {
          cancellation.token.throwIfCancelled();

          const toolName  = tc.function.name;
          const toolCallId = tc.id;
          let toolArgs: Record<string, unknown>;

          try {
            toolArgs = JSON.parse(tc.function.arguments);
          } catch {
            // Feed the parse failure back so the model re-issues the call —
            // silently running with {} produced confusing downstream errors
            const snippet = String(tc.function.arguments ?? '').slice(0, 300);
            messages.push({
              role:        'tool' as const,
              tool_call_id: toolCallId,
              tool_name:   toolName,
              content:
                `Error: the arguments for ${toolName} were not valid JSON. ` +
                `Received: ${snippet}\nRe-issue the tool call with valid JSON arguments. ` +
                'If the content is large, it was probably cut off by the output limit: ' +
                'split it into create_file with the first part, then append_file for the rest.',
            } as ContextMessage);
            emitter.toolError(
              stepIndex, toolCallId, toolName,
              'Tool arguments were not valid JSON', true,
              'The model will retry with corrected JSON'
            );
            continue;
          }

          // Repair unambiguous alias/shape slips (e.g. TodoWrite's `content`)
          toolArgs = normalizeToolArgs(toolName, toolArgs) as Record<string, unknown>;

          // Validate args with Zod
          const validation = validateTool(toolName, toolArgs);
          if (!validation.ok) {
            // Echo the argument keys so the model (and the timeline) can see
            // which shape was sent, not just which field was missing
            const sent = `Sent keys: ${Object.keys(toolArgs).join(', ') || '(none)'}`;
            messages.push({
              role:        'tool' as const,
              tool_call_id: toolCallId,
              tool_name:   toolName,
              content:     `Validation error: ${validation.error}. ${sent}. Re-issue the call with the documented parameters.`,
            } as ContextMessage);
            emitter.toolError(stepIndex, toolCallId, toolName, `${validation.error} (${sent})`, true);
            continue;
          }

          // A sub-agent only has its kind's tool set — a hallucinated call to
          // anything else (e.g. create_file from an explore agent) is refused
          if (nested && !toolNames.includes(toolName)) {
            messages.push({
              role:        'tool' as const,
              tool_call_id: toolCallId,
              tool_name:   toolName,
              content:     `Error: ${toolName} is not available to this ${nested.kind} sub-agent. Available tools: ${toolNames.join(', ')}`,
            } as ContextMessage);
            emitter.toolError(stepIndex, toolCallId, toolName, `Not available to a ${nested.kind} sub-agent`, true);
            continue;
          }

          // ── ask_user: pause the loop until the user answers ─────────────
          if (toolName === 'ask_user') {
            const question = String(toolArgs.question ?? '');
            const options = Array.isArray(toolArgs.options)
              ? (toolArgs.options as unknown[]).map(String).slice(0, 4)
              : undefined;

            emitter.toolStart(stepIndex, toolCallId, toolName, toolArgs);
            emitter.status(stepIndex, 'waiting');
            emitter.emit({
              type: 'user_input_request',
              stepIndex,
              toolCallId,
              question,
              options,
              ts: Date.now(),
            });

            const waitStart = Date.now();
            const answer = opts.waitForUserInput
              ? await opts.waitForUserInput(question, options)
              : '[Interactive input is unavailable in this run — choose a sensible default and continue.]';
            pausedMs += Date.now() - waitStart;

            cancellation.token.throwIfCancelled();

            emitter.toolEnd(
              stepIndex, toolCallId, toolName,
              Date.now() - waitStart, true,
              `User answered: ${answer.slice(0, 80)}`
            );

            messages.push({
              role:         'tool' as const,
              tool_call_id: toolCallId,
              tool_name:    toolName,
              content:      `User's answer: ${answer}`,
            } as ContextMessage);

            emitter.status(stepIndex, 'planning');
            continue;
          }

          // Git checkpoint before first edit (sub-agents share the parent's)
          if (!nested && !checkpointed && (
            toolName === 'edit_file' ||
            toolName === 'create_file' ||
            toolName === 'append_file' ||
            toolName === 'delete_file' ||
            toolName === 'replace_lines' ||
            toolName === 'notebook_edit' ||
            toolName === 'execute_code' ||
            (toolName === 'spawn_agent' && subagentEdits(String(toolArgs.kind)))
          )) {
            try {
              const sha = gitCheckpoint(workspaceRoot, turnIndex);
              checkpointed = true;

              checkpointDb.insert({
                sha,
                project_id:    projectId,
                message:       `Turn ${turnIndex} start`,
                files_changed: 0,
                insertions:    0,
                deletions:     0,
                // Restoring the pre-turn workspace should also drop this
                // turn's chat, keeping conversation and files in sync
                keep_messages_through_turn: turnIndex - 1,
              });

              emitter.checkpoint(stepIndex, sha, 0);
            } catch {
              // Not fatal if checkpoint fails
            }
          }

          // Manual execution mode: require approval before running mutating actions
          const MUTATING_TOOLS = new Set<string>(APPROVAL_REQUIRED_TOOLS);

          if (opts.executionMode === 'manual' && MUTATING_TOOLS.has(toolName) && opts.waitForUserInput) {
            let targetSummary = '';
            if (typeof toolArgs.path === 'string') targetSummary = `file "${toolArgs.path}"`;
            else if (typeof toolArgs.command === 'string') targetSummary = `command "${(toolArgs.command as string).slice(0, 80)}"`;
            else targetSummary = JSON.stringify(toolArgs).slice(0, 80);

            const question = `🛡️ [Manual Approval Required]\nAllow tool \`${toolName}\` on ${targetSummary}?\n\nArguments:\n\`\`\`json\n${JSON.stringify(toolArgs, null, 2).slice(0, 600)}\n\`\`\``;
            const pauseStart = Date.now();
            const answer = await opts.waitForUserInput(question, ['Approve', 'Skip Tool', 'Cancel Run']);
            pausedMs += Date.now() - pauseStart;

            if (answer && answer.toLowerCase().includes('skip')) {
              const skippedResult = {
                success: false,
                output: `Action '${toolName}' was skipped by user in Manual Mode. Please provide an alternative approach or report to the user.`,
                summary: `Action '${toolName}' skipped by user`,
              };
              emitter.toolStart(stepIndex, toolCallId, toolName, toolArgs);
              emitter.toolEnd(stepIndex, toolCallId, toolName, 0, false, skippedResult.summary);
              messages.push({
                role: 'tool',
                content: skippedResult.output,
                tool_call_id: toolCallId,
                tool_name: toolName,
              });
              continue;
            } else if (answer && answer.toLowerCase().includes('cancel')) {
              cancellation.cancel();
              return {
                success: false,
                reason: 'user_cancelled',
                stepsCompleted: stepIndex,
                filesChanged: [...ctx.filesCreated, ...ctx.filesEdited],
                totalTokens,
                durationMs: Date.now() - startTime - pausedMs,
                finalMessage: 'Turn cancelled by user during manual tool approval.',
              };
            }
          }

          // PreToolUse hooks: exit 2 vetoes the call; its feedback goes to the model
          if (hooks.hooks.length > 0) {
            const pre = await runHooks(
              hooks,
              { event: 'PreToolUse', projectId, workspace: workspaceRoot, toolName, toolInput: toolArgs },
              { signal: cancellation.token.signal }
            );
            emitHookResults(emitter, stepIndex, pre);
            const verdict = summarizeHookResults(pre);
            if (verdict.blocked) {
              emitter.toolStart(stepIndex, toolCallId, toolName, toolArgs);
              emitter.toolError(
                stepIndex, toolCallId, toolName,
                `Blocked by a PreToolUse hook: ${verdict.reason.slice(0, 300)}`, true
              );
              messages.push({
                role:         'tool' as const,
                tool_call_id: toolCallId,
                tool_name:    toolName,
                content:      `Blocked by a PreToolUse hook (exit 2). Hook feedback:\n${verdict.reason}\nAdjust your approach accordingly.`,
              } as ContextMessage);
              continue;
            }
          }

          // ── spawn_agent: nested loop, run concurrently with sibling spawns ──
          if (toolName === 'spawn_agent') {
            emitter.toolStart(stepIndex, toolCallId, toolName, toolArgs);
            emitter.status(stepIndex, 'running');
            toolsExecuted++;
            const placeholder = {
              role: 'tool' as const,
              tool_call_id: toolCallId,
              tool_name: toolName,
              content: '',
            } as ContextMessage;
            messages.push(placeholder);
            const request = {
              kind:    toolArgs.kind as SubagentKind,
              task:    String(toolArgs.task),
              context: typeof toolArgs.context === 'string' ? toolArgs.context : undefined,
              label:   typeof toolArgs.label === 'string' ? toolArgs.label : undefined,
            };
            const name = request.label ?? request.kind;
            const promise = depth >= MAX_SUBAGENT_DEPTH
              ? Promise.resolve(failedSubagent(name, 'Sub-agents cannot spawn further sub-agents — do the work directly.'))
              : runSubagent(request, {
                  projectId, workspaceRoot, llmConfig, tools, systemPrompt, emitter, cancellation,
                  turnIndex, parentStep: stepIndex, toolCallId, depth,
                }).catch((err: unknown) =>
                  failedSubagent(name, err instanceof Error ? err.message : String(err))
                );
            pendingSubagents.push({ msg: placeholder, promise, toolCallId, started: Date.now(), args: toolArgs });
            continue;
          }

          // Execute tool
          emitter.toolStart(stepIndex, toolCallId, toolName, toolArgs);
          emitter.status(stepIndex, toolStatusFor(toolName));

          const toolStart = Date.now();
          toolsExecuted++;
          const toolResult = await executeTool(
            toolName,
            toolArgs,
            workspaceRoot,
            ctx,
            cancellation.token.signal
          );
          const toolDuration = Date.now() - toolStart;

          // Log to DB
          toolLogDb.insert({
            project_id:  projectId,
            tool_name:   toolName,
            args:        toolArgs,
            result:      { success: toolResult.success, summary: toolResult.summary },
            success:     toolResult.success,
            duration_ms: toolDuration,
            turn_index:  turnIndex,
          });

          // Any verification attempt counts (skipped "no tooling" or failed
          // runs included) so the finish gate can never loop on it
          if (toolName === 'run_lint') ctx.hasRunLint = true;
          if (toolName === 'run_tests') ctx.hasRunTests = true;

          if (toolResult.success) {
            emitter.toolEnd(
              stepIndex,
              toolCallId,
              toolName,
              toolDuration,
              true,
              toolResult.summary,
              toolResult.extra
            );

            // Track changed files
            if (toolResult.changedFile) {
              if (!filesChanged.includes(toolResult.changedFile)) {
                filesChanged.push(toolResult.changedFile);
              }
              ctx.hasEdits = true;
            }

            if (toolName === 'update_plan' && toolResult.structured?.tasks) {
              emitter.emit({
                type: 'plan_update',
                stepIndex,
                tasks: toolResult.structured.tasks,
                ts: Date.now(),
              });
            }

            if (toolName === 'run_lint')  {
              ctx.hasRunLint  = true;
              if (toolResult.structured) {
                emitter.emit({
                  type:       'verification',
                  stepIndex,
                  tool:       'run_lint',
                  passed:     toolResult.structured.passed,
                  errorCount: toolResult.structured.errorCount ?? 0,
                  warningCount: toolResult.structured.warningCount ?? 0,
                  summary:    toolResult.summary,
                  ts:         Date.now(),
                });
              }
            }

            if (toolName === 'run_tests') {
              ctx.hasRunTests = true;
              if (toolResult.structured) {
                emitter.emit({
                  type:       'verification',
                  stepIndex,
                  tool:       'run_tests',
                  passed:     toolResult.structured.passed,
                  errorCount: toolResult.structured.failed ?? 0,
                  warningCount: 0,
                  summary:    toolResult.summary,
                  ts:         Date.now(),
                });
              }
            }

          } else {
            emitter.toolError(
              stepIndex,
              toolCallId,
              toolName,
              // Failed commands carry their exit info in summary, not error
              toolResult.error ?? toolResult.summary ?? 'Unknown error',
              true,
              toolResult.suggestion
            );
          }

          let toolContent = toolResult.output;

          // PostToolUse hooks: exit 2 feedback rides along with the tool result
          if (hooks.hooks.length > 0) {
            const post = await runHooks(
              hooks,
              { event: 'PostToolUse', projectId, workspace: workspaceRoot, toolName, toolInput: toolArgs, toolOutput: toolResult.output },
              { signal: cancellation.token.signal }
            );
            emitHookResults(emitter, stepIndex, post);
            const verdict = summarizeHookResults(post);
            if (verdict.blocked) toolContent += `\n\n[PostToolUse hook feedback (exit 2)]\n${verdict.reason}`;
          }

          // view_image: multimodal models get the picture itself
          if (toolResult.attachImage) {
            if (supportsVision(llmConfig.model)) {
              toolContent += '\nThe image is attached to the conversation below — inspect it before drawing conclusions.';
              attachedImages.push({
                role: 'user',
                content: [
                  { type: 'text', text: `[Image ${String(toolArgs.path ?? '')} attached by view_image]` },
                  { type: 'image_url', image_url: { url: toolResult.attachImage } },
                ],
              } as ContextMessage);
            } else {
              toolContent +=
                `\nThe current model (${llmConfig.model}) is not marked as multimodal, so the image was not attached ` +
                '(set LLM_VISION=1 if it does accept images). Judge the result from numbers instead — e.g. print ' +
                'statistics or sampled values with execute_code.';
            }
          }

          // Add tool result to messages
          messages.push({
            role:         'tool' as const,
            tool_call_id: toolCallId,
            tool_name:    toolName,
            content:      toolContent,
          } as ContextMessage);
        }

        // Sub-agents started in this batch ran concurrently — collect their
        // reports in call order so every tool_call gets its result
        for (const p of pendingSubagents) {
          const r = await p.promise;
          const duration = Date.now() - p.started;
          totalTokens += r.totalTokens;
          for (const f of r.filesChanged) {
            if (!filesChanged.includes(f)) filesChanged.push(f);
          }
          if (r.filesChanged.length > 0) ctx.hasEdits = true;

          toolLogDb.insert({
            project_id:  projectId,
            tool_name:   'spawn_agent',
            args:        { kind: p.args.kind, label: p.args.label, task: String(p.args.task ?? '').slice(0, 300) },
            result:      { success: r.success, summary: r.summary },
            success:     r.success,
            duration_ms: duration,
            turn_index:  turnIndex,
          });
          emitter.toolEnd(stepIndex, p.toolCallId, 'spawn_agent', duration, r.success, r.summary, {
            subagent: {
              reason:       r.reason,
              steps:        r.steps,
              toolCalls:    r.toolCalls,
              tokens:       r.totalTokens,
              filesChanged: r.filesChanged,
              report:       r.output.slice(0, 6_000),
            },
          });
          p.msg.content = r.output;
        }

        for (const img of attachedImages) messages.push(img);

        // Every tool call in this batch is answered — checkpoint the transcript
        persistPartial();

        emitter.status(stepIndex, 'planning');

      } catch (err) {
        // An aborted provider request after Stop surfaces as an SDK abort
        // error, not CancelledError — it is still a user cancellation
        if (err instanceof CancelledError || cancellation.isCancelled) {
          persistPartial();
          emitter.status(stepIndex, 'done');
          return buildResult('user_cancelled', stepIndex, filesChanged, totalTokens, startTime);
        }
        // "Prompt too long" is not transient: learn the provider's real
        // limit (registries and CONTEXT_WINDOW guesses are often wrong),
        // compact, and retry the same step
        const contextLimit = inLLMCall ? parseContextLengthError(err) : null;
        if (contextLimit !== null && contextRetries < MAX_CONTEXT_RETRIES) {
          contextRetries++;
          const assumed = getContextWindow(llmConfig.model);
          if (contextLimit > 0) recordContextWindow(llmConfig.model, contextLimit);
          emitter.error(
            stepIndex,
            `The model rejected the prompt as too long` +
              (contextLimit > 0 ? ` (its limit is ${contextLimit.toLocaleString('en-US')} tokens; the platform assumed ${assumed.toLocaleString('en-US')})` : '') +
              ` — compacting the conversation and retrying (${contextRetries}/${MAX_CONTEXT_RETRIES})`,
            true
          );
          const shrank = await compactContext(true);
          if (!shrank) {
            throw new Error(
              'The conversation does not fit the model\'s context window even after compaction. ' +
              'Start a new turn with /clear or /compact, or pick a model with a larger context.'
            );
          }
          continue;
        }

        // Transient provider failures (rate limits, dropped/stalled streams)
        // happen before anything from this step is recorded — retry it
        if (inLLMCall && llmRetries < MAX_LLM_RETRIES) {
          llmRetries++;
          const msg = err instanceof Error ? err.message : String(err);
          emitter.error(
            stepIndex,
            `Model call failed (${msg.slice(0, 300)}) — retrying (${llmRetries}/${MAX_LLM_RETRIES})`,
            true
          );
          await cancellableSleep(2_000 * 2 ** (llmRetries - 1), cancellation.token);
          continue;
        }
        throw err;
      }
    }

    // ── Final checkpoint ───────────────────────────────────────────────────
    if (!nested && ctx.hasEdits) {
      try {
        const sha = gitCheckpoint(workspaceRoot, turnIndex, 'end');
        checkpointDb.insert({
          sha,
          project_id:    projectId,
          message:       `Turn ${turnIndex} complete`,
          files_changed: filesChanged.length,
          insertions:    0,
          deletions:     0,
          keep_messages_through_turn: turnIndex,
        });
        emitter.checkpoint(stepIndex, sha, filesChanged.length);
      } catch {}
    }

    // ── Persist messages to DB (a sub-agent's transcript is not history) ───
    if (!nested) {
      persistMessages(
        projectId,
        messages.filter((m) => !alreadyPersisted.has(m)),
        turnIndex
      );
      projectDb.touch(projectId);
    }

    const reason: DoneReason =
      hitTimeLimit ? 'timeout' : stepIndex > maxSteps ? 'max_steps' : 'completed';

    emitter.status(stepIndex, 'done');
    emitter.done(
      stepIndex,
      reason,
      Date.now() - startTime,
      filesChanged,
      totalTokens
    );

    return buildResult(reason, stepIndex, filesChanged, totalTokens, startTime, finalMessage);

  } catch (err) {
    // Cancellation during planning/compaction lands here, not in the step catch
    if (err instanceof CancelledError || cancellation.isCancelled) {
      persistPartial();
      emitter.status(stepIndex, 'done');
      return buildResult('user_cancelled', stepIndex, filesChanged, totalTokens, startTime);
    }
    persistPartial();
    const msg = err instanceof Error ? err.message : String(err);
    emitter.error(stepIndex, msg, true);
    emitter.status(stepIndex, 'error');

    return buildResult('error', stepIndex, filesChanged, totalTokens, startTime);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildInitialMessages(
  systemPrompt: string,
  agentsMemory: string | undefined,
  userMessages: LLMMessage[]
): ContextMessage[] {
  // Keep the system prompt byte-stable across requests: providers cache the
  // longest unchanged message prefix, so per-request state (the active file)
  // is appended to the NEWEST user message instead of the system prompt.
  const system = [
    systemPrompt,
    agentsMemory ? `\n\n## Project Memory (AGENTS.md)\n${agentsMemory}` : '',
  ].filter(Boolean).join('');

  return [
    { role: 'system', content: system },
    ...userMessages,
  ] as ContextMessage[];
}

function toolStatusFor(toolName: string): AgentStatus {
  const map: Record<string, AgentStatus> = {
    read_file:    'reading',
    load_skill:   'reading',
    list_files:   'reading',
    glob_files:   'reading',
    grep_files:   'reading',
    web_search:   'reading',
    fetch_url:    'reading',
    create_file:  'writing',
    append_file:  'writing',
    edit_file:    'writing',
    delete_file:  'writing',
    replace_lines: 'writing',
    generate_image: 'writing',
    create_artifact: 'writing',
    run_lint:     'linting',
    run_tests:    'testing',
    run_command:  'running',
    read_preview_logs: 'reading',
    fetch_preview: 'reading',
    check_preview: 'testing',
    browser_open: 'testing', browser_snapshot: 'reading', browser_click: 'testing',
    browser_type: 'testing', browser_press: 'testing', browser_select: 'testing',
    browser_scroll: 'reading', browser_wait: 'testing', browser_console: 'reading',
    browser_screenshot: 'testing', browser_close: 'testing',
    update_plan:  'planning',
    deploy_app:   'running',
    ask_user:     'waiting',
    execute_code: 'running',
    view_image:   'reading',
    notebook_edit: 'writing',
    run_notebook: 'running',
    save_memory:  'writing',
    spawn_agent:  'running',
    http_request: 'running',
    query_data:   'reading',
    plot_data:    'writing',
    review_changes: 'reading',
  };
  return map[toolName] ?? 'planning';
}

function emitHookResults(emitter: EventEmitter, stepIndex: number, results: HookRunResult[]): void {
  for (const r of results) {
    emitter.emit({
      type: 'hook',
      stepIndex,
      event: r.event,
      command: r.command,
      source: r.source,
      exitCode: r.exitCode,
      blocked: r.blocked,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
      output: r.feedback.slice(0, 2_000),
      error: r.error,
    });
  }
}

function failedSubagent(label: string, message: string): SubagentRunResult {
  return {
    success: false,
    output: `[Sub-agent "${label}" could not run: ${message}]`,
    summary: `${label}: failed to start`,
    reason: 'error',
    filesChanged: [],
    totalTokens: 0,
    steps: 0,
    toolCalls: 0,
    durationMs: 0,
  };
}

/** Build output, dependency and cache dirs never belong in checkpoints —
 *  `git add -A` on target/, node_modules/ or .venv/ made every checkpoint
 *  slow and bloated the repo. Uses .git/info/exclude (local-only), so the
 *  project's own .gitignore is left untouched. */
export const CHECKPOINT_EXCLUDES = [
  'node_modules/', '.npm-cache/', '.next/', 'dist/', 'build/', 'coverage/',
  'target/', '.venv/', 'venv/', '__pycache__/', '.pytest_cache/', '.ruff_cache/',
  '.mypy_cache/', '*.egg-info/', '.local/', '.cache/', '.gradle/', '*.class',
  '.open-code/',
];
const EXCLUDE_MARKER = '# open-code checkpoint excludes';

export function ensureCheckpointExcludes(workspace: string): void {
  try {
    const file = path.join(workspace, '.git', 'info', 'exclude');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (current.includes(EXCLUDE_MARKER)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, `${current}${sep}${EXCLUDE_MARKER}\n${CHECKPOINT_EXCLUDES.join('\n')}\n`);
  } catch {
    // Not fatal: the checkpoint just includes more files
  }
}

function gitCheckpoint(workspace: string, turnIndex: number, phase = 'start'): string {
  // Explicit identity so checkpoints work without global git config
  const identity =
    '-c user.name="Open Code Agent" -c user.email="agent@opencode.local"';
  ensureCheckpointExcludes(workspace);
  execSync('git add -A', { cwd: workspace, stdio: 'pipe' });
  execSync(
    `git ${identity} commit -m "checkpoint: turn ${turnIndex} ${phase}" --allow-empty`,
    { cwd: workspace, stdio: 'pipe' }
  );
  return execSync('git rev-parse HEAD', { cwd: workspace }).toString().trim();
}

/** Heuristic: does `text` contain tool invocations written as plain text
 *  (e.g. `<tool_call>`, `<function=create_file>`, `## create_file ##`, or a
 *  JSON object naming a known tool) instead of native tool calls? */
export function looksLikeTextToolCall(text: string, toolNames: string[]): boolean {
  if (!text) return false;
  if (/<tool_call>|<\/tool_call>|<function=|<\|tool_call|\[TOOL_CALLS\]/i.test(text)) return true;
  if (!toolNames.length) return false;
  const names = toolNames.filter((n) => /^[\w-]+$/.test(n)).join('|');
  if (!names) return false;
  const patterns = [
    new RegExp(`^\\s*#{1,3}\\s*(${names})\\s*#{1,3}\\s*$`, 'm'),
    new RegExp(`"(?:tool|name|tool_name|function)"\\s*:\\s*"(${names})"`),
  ];
  return patterns.some((re) => re.test(text));
}

/** Does a final reply claim work was done (files written, tests run)? */
export function claimsCompletedWork(text: string): boolean {
  return /\b(created|wrote|written|added|implemented|updated|built|generated|ran|executed|tests?\s+(?:all\s+)?pass(?:ed|es)?)\b/i.test(text);
}

/** Providers reject a history where an assistant tool call has no matching
 *  tool result. A turn cut short mid-tool-batch leaves such calls — answer
 *  them with a placeholder so the saved history stays valid. */
export function closeDanglingToolCalls(messages: ContextMessage[]): ContextMessage[] {
  const out: ContextMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    out.push(m);
    const calls = m.tool_calls as { id: string; function?: { name?: string } }[] | undefined;
    if (m.role !== 'assistant' || !Array.isArray(calls) || calls.length === 0) continue;
    const answered = new Set<string>();
    let j = i + 1;
    while (j < messages.length && messages[j].role === 'tool') {
      answered.add(String(messages[j].tool_call_id));
      out.push(messages[j]);
      j++;
    }
    for (const tc of calls) {
      if (!answered.has(tc.id)) {
        out.push({
          role: 'tool',
          tool_call_id: tc.id,
          tool_name: tc.function?.name,
          content: '[Not run: the turn ended before this tool call executed]',
        } as ContextMessage);
      }
    }
    i = j - 1;
  }
  return out;
}

function persistMessages(
  projectId: string,
  messages: ContextMessage[],
  turnIndex: number
): void {
  // The turn is saved in several batches (one per step) — continue the
  // sequence so the history reads back in order
  const base = messageDb.getMaxSeq(projectId, turnIndex) + 1;
  const rows = messages
    .filter((m) => m.role !== 'system')
    .map((m, i) => ({
      id:           crypto.randomUUID(),
      seq:          base + i,
      project_id:   projectId,
      role:         m.role,
      // Multimodal parts (view_image attachments) are stored as JSON
      content:      typeof m.content === 'string' ? m.content : m.content == null ? '' : JSON.stringify(m.content),
      tool_calls:   m.tool_calls ? JSON.stringify(m.tool_calls) : null,
      tool_call_id: m.tool_call_id ?? null,
      tool_name:    m.tool_name ?? null,
      turn_index:   turnIndex,
      tokens_used:  null,
    }));

  messageDb.insertMany(rows);
}

function buildResult(
  reason: DoneReason,
  steps: number,
  filesChanged: string[],
  totalTokens: number,
  startTime: number,
  finalMessage?: string
): AgentLoopResult {
  return {
    success:        reason === 'completed',
    reason,
    stepsCompleted: steps,
    filesChanged,
    totalTokens,
    durationMs:     Date.now() - startTime,
    finalMessage,
  };
}

async function callWithTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Call timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
