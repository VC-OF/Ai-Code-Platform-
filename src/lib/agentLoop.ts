import { execSync } from 'child_process';
import {
  callLLM,
  callLLMStream,
  getContextWindow,
  type LLMConfig,
  type LLMMessage,
  type LLMTool,
} from './llmClient';
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
import { CancellationSource, CancelledError } from './cancellation';
import { trackUsage } from './usageTracker';
import { messageDb, checkpointDb, toolLogDb, projectDb, type PlanTask } from './db';
import { executeTool, createTurnContext } from './tools';
import { validateTool } from './toolValidator';
import crypto from 'crypto';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_STEPS    = 25;
const MAX_DURATION = 5 * 60_000;   // 5 minutes total
const STEP_TIMEOUT = 60_000;       // 60s per LLM call
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

  const startTime    = Date.now();
  const ctx          = createTurnContext();
  const filesChanged: string[] = [];
  let totalTokens    = 0;
  let stepIndex      = 0;
  let finalMessage   = '';
  let checkpointed   = false;
  let pausedMs       = 0;   // Time spent waiting on ask_user — excluded from the duration cap

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

  // Per-request context rides in an ephemeral tail message (never persisted,
  // never stale in history) so the system+history prefix stays byte-stable
  // for provider-side prompt caching
  const incompletePlan =
    opts.currentPlan?.some((t) => t.status !== 'completed') ?? false;
  if (incompletePlan) {
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

    const needsPlan = (lastUserMsg?.toString() ?? '').length > 40;

    if (needsPlan) {
      cancellation.token.throwIfCancelled();

      const planResponse = await callWithTimeout(
        callLLM(llmConfig, messages as LLMMessage[], undefined, {
          toolChoice: 'none',
          signal: cancellation.token.signal,
        }),
        STEP_TIMEOUT
      );

      const planText = planResponse.content ?? '';

      if (planText) {
        emitter.plan(0, planText);
        messages.push({ role: 'assistant', content: planText });
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
    for (stepIndex = 1; stepIndex <= MAX_STEPS; stepIndex++) {
      // ── Safety checks ────────────────────────────────────────────────────
      cancellation.token.throwIfCancelled();

      const elapsed = Date.now() - startTime - pausedMs;
      if (elapsed >= MAX_DURATION) {
        emitter.error(stepIndex, `Agent timeout after ${Math.round(elapsed / 1000)}s`, false);
        return buildResult('timeout', stepIndex, filesChanged, totalTokens, startTime);
      }

      // ── Mid-run steering: inject messages the user queued ────────────────
      const queued = opts.drainQueuedMessages?.() ?? [];
      for (const text of queued) {
        messages.push({ role: 'user', content: text } as ContextMessage);
      }

      // ── Context compaction ────────────────────────────────────────────────
      if (shouldCompact(messages, { model: llmConfig.model, targetRatio: COMPACT_AT })) {
        emitter.status(stepIndex, 'compacting');

        const before = {
          messages: messages.length,
          tokens:   messages.reduce((s, m) => s + estimateMessageTokens(m), 0),
        };

        // Preferred: replace the old span with a real LLM-written summary so
        // the agent keeps usable memory of what it read, built, and decided
        const split = splitForCompaction(messages, 8);
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

        if (!summarized) {
          // Placeholder compaction preserves length/order but clones some
          // message objects — re-mark persisted membership positionally so
          // clones of already-saved history aren't saved again
          const wasPersisted = messages.map((m) => alreadyPersisted.has(m));
          const result = compactMessages(messages, {
            model:         llmConfig.model,
            targetRatio:   COMPACT_AT,
            minRatio:      COMPACT_TO,
            preserveLastN: 8,
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
      }

      // ── LLM call ──────────────────────────────────────────────────────────
      let textContent = '';

      try {
        // Stream text for better UX
        let toolCalls:
          | { id: string; type: 'function'; function: { name: string; arguments: string } }[]
          | null = null;
        let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

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

          if (chunk.type === 'delta' && chunk.delta) {
            textContent += chunk.delta;
            emitter.textDelta(stepIndex, chunk.delta);
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
            if (chunk.usage) {
              usage = {
                prompt_tokens:     chunk.usage.prompt_tokens,
                completion_tokens: chunk.usage.completion_tokens,
                total_tokens:      chunk.usage.prompt_tokens + chunk.usage.completion_tokens,
              };
            }
          }
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

        // If no tool calls = agent is done
        if (!toolCalls || toolCalls.length === 0) {
          // Enforce verification before finishing
          if (ctx.hasEdits && !ctx.hasRunLint && !ctx.hasRunTests) {
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

          finalMessage = textContent;
          break;
        }

        // Add assistant message with tool calls
        messages.push({
          role:       'assistant',
          content:    textContent || null,
          tool_calls: toolCalls,
        } as ContextMessage);

        // ── Execute tool calls ─────────────────────────────────────────────
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
                `Received: ${snippet}\nRe-issue the tool call with valid JSON arguments.`,
            } as ContextMessage);
            emitter.toolError(
              stepIndex, toolCallId, toolName,
              'Tool arguments were not valid JSON', true,
              'The model will retry with corrected JSON'
            );
            continue;
          }

          // Validate args with Zod
          const validation = validateTool(toolName, toolArgs);
          if (!validation.ok) {
            messages.push({
              role:        'tool' as const,
              tool_call_id: toolCallId,
              tool_name:   toolName,
              content:     `Validation error: ${validation.error}`,
            } as ContextMessage);
            emitter.toolError(stepIndex, toolCallId, toolName, validation.error!, true);
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

          // Git checkpoint before first edit
          if (!checkpointed && (
            toolName === 'edit_file' ||
            toolName === 'create_file' ||
            toolName === 'delete_file' ||
            toolName === 'replace_lines'
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

          // Execute tool
          emitter.toolStart(stepIndex, toolCallId, toolName, toolArgs);
          emitter.status(stepIndex, toolStatusFor(toolName));

          const toolStart = Date.now();
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
              toolResult.error ?? 'Unknown error',
              true,
              toolResult.suggestion
            );
          }

          // Add tool result to messages
          messages.push({
            role:         'tool' as const,
            tool_call_id: toolCallId,
            tool_name:    toolName,
            content:      toolResult.output,
          } as ContextMessage);
        }

        emitter.status(stepIndex, 'planning');

      } catch (err) {
        if (err instanceof CancelledError) {
          emitter.status(stepIndex, 'done');
          return buildResult('user_cancelled', stepIndex, filesChanged, totalTokens, startTime);
        }
        throw err;
      }
    }

    // ── Final checkpoint ───────────────────────────────────────────────────
    if (ctx.hasEdits) {
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

    // ── Persist messages to DB ─────────────────────────────────────────────
    persistMessages(
      projectId,
      messages.filter((m) => !alreadyPersisted.has(m)),
      turnIndex
    );
    projectDb.touch(projectId);

    const reason: DoneReason =
      stepIndex > MAX_STEPS ? 'max_steps' : 'completed';

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
    list_files:   'reading',
    glob_files:   'reading',
    grep_files:   'reading',
    web_search:   'reading',
    fetch_url:    'reading',
    create_file:  'writing',
    edit_file:    'writing',
    delete_file:  'writing',
    replace_lines: 'writing',
    generate_image: 'writing',
    run_lint:     'linting',
    run_tests:    'testing',
    run_command:  'running',
    read_preview_logs: 'reading',
    fetch_preview: 'reading',
    check_preview: 'testing',
    update_plan:  'planning',
    deploy_app:   'running',
    ask_user:     'waiting',
  };
  return map[toolName] ?? 'planning';
}

function gitCheckpoint(workspace: string, turnIndex: number, phase = 'start'): string {
  // Explicit identity so checkpoints work without global git config
  const identity =
    '-c user.name="Open Code Agent" -c user.email="agent@opencode.local"';
  execSync('git add -A', { cwd: workspace, stdio: 'pipe' });
  execSync(
    `git ${identity} commit -m "checkpoint: turn ${turnIndex} ${phase}" --allow-empty`,
    { cwd: workspace, stdio: 'pipe' }
  );
  return execSync('git rev-parse HEAD', { cwd: workspace }).toString().trim();
}

function persistMessages(
  projectId: string,
  messages: ContextMessage[],
  turnIndex: number
): void {
  const rows = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      id:           crypto.randomUUID(),
      project_id:   projectId,
      role:         m.role,
      content:      m.content ?? '',
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
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Call timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}
