import { runAgentLoop } from '@/lib/agentLoop';
import { streamRegistry } from '@/lib/cancellation';
import { workspaceLocks } from '@/lib/workspaceLock';
import { EventEmitter, type AgentStatus } from '@/lib/events';
import { projectDb, messageDb, planDb } from '@/lib/db';
import { getModel, LLMMessage, type LLMTool } from '@/lib/llmClient';
import { composeSystemPrompt, type OutputStyle } from '@/lib/promptComposer';
import { TOOL_SCHEMAS } from '@/lib/tools';
import { buildPromptParts } from '@/lib/contextBreakdown';

export interface RunningAgent {
  projectId: string;
  events: string[]; // JSON string lines of events emitted
  status: AgentStatus;
  controllers: Set<ReadableStreamDefaultController>;
  promise?: Promise<unknown>;
  /** User messages sent while the agent runs — injected before the next step */
  queuedMessages: string[];
  /** Resolver for a pending ask_user question, if the loop is waiting */
  pendingInput?: { question: string; resolve: (answer: string) => void };
}

// Run state lives on globalThis so a module re-evaluation (dev HMR, or a
// route bundle with its own copy) still sees agents that are running — a
// fresh Map forgot them while their workspace locks stayed held. Only the
// state is shared, not the instance, so code edits still take effect.
const sharedState = globalThis as unknown as { __ocActiveAgents?: Map<string, RunningAgent> };

class AgentManager {
  private activeAgents = (sharedState.__ocActiveAgents ??= new Map<string, RunningAgent>());

  getRunningAgent(projectId: string): RunningAgent | undefined {
    return this.activeAgents.get(projectId);
  }

  isRunning(projectId: string): boolean {
    const agent = this.activeAgents.get(projectId);
    return !!agent;
  }

  /** Queue a user message into a running agent's next step. */
  queueUserMessage(projectId: string, content: string): boolean {
    const agent = this.activeAgents.get(projectId);
    if (!agent) return false;
    agent.queuedMessages.push(content);
    return true;
  }

  /** Deliver the user's answer to a pending ask_user question. */
  provideUserInput(projectId: string, answer: string): boolean {
    const agent = this.activeAgents.get(projectId);
    if (!agent?.pendingInput) return false;
    const { resolve } = agent.pendingInput;
    agent.pendingInput = undefined;
    resolve(answer);
    return true;
  }

  getStatus(projectId: string): AgentStatus {
    const agent = this.activeAgents.get(projectId);
    return agent ? agent.status : 'done';
  }

  subscribeClient(projectId: string): ReadableStream<Uint8Array> {
    const agent = this.activeAgents.get(projectId);
    if (!agent) {
      // Return an empty, immediately closed stream if not found
      return new ReadableStream({
        start(controller) {
          controller.close();
        }
      });
    }

    let activeController: ReadableStreamDefaultController | null = null;

    return new ReadableStream<Uint8Array>({
      start(controller) {
        activeController = controller;
        agent.controllers.add(controller);
        // Replay all events that happened so far
        for (const line of agent.events) {
          try {
            controller.enqueue(new TextEncoder().encode(line + '\n'));
          } catch (err) {
            console.error('Error replaying event to controller:', err);
          }
        }
      },
      cancel() {
        if (activeController) {
          agent.controllers.delete(activeController);
        }
        // Note: Do NOT cancel the agent loop when client disconnects!
      }
    });
  }

  startAgent(
    projectId: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    activeFilePath?: string,
    requestedModel?: string,
    executionMode: 'auto' | 'manual' | 'plan' = 'auto',
    outputStyle?: OutputStyle
  ): ReadableStream<Uint8Array> {
    // Atomic guard: if an agent is already running for this project,
    // subscribe to it instead of starting a second one
    if (this.activeAgents.has(projectId)) {
      return this.subscribeClient(projectId);
    }

    // 1. Create running agent record
    const agent: RunningAgent = {
      projectId,
      events: [],
      status: 'planning',
      controllers: new Set(),
      queuedMessages: [],
    };

    this.activeAgents.set(projectId, agent);

    // Add initial user message event if present so that it can be replayed to any reconnecting clients
    const lastMsg = messages[messages.length - 1];
    if (lastMsg) {
      const initialMsgEvent = {
        type: 'message',
        role: lastMsg.role,
        content: lastMsg.content,
        ts: Date.now(),
      };
      agent.events.push(JSON.stringify(initialMsgEvent));
    }

    // 2. Setup manager event emitter subclass
    class ManagerEventEmitter extends EventEmitter {
      constructor() {
        // The base emitter writes to a stream controller; this subclass
        // broadcasts to many, so no single controller exists
        super(null as unknown as ReadableStreamDefaultController);
      }
      override emit(event: Record<string, unknown>) {
        const eventWithTs = { ...event, ts: event.ts || Date.now() };
        const line = JSON.stringify(eventWithTs);
        agent.events.push(line);

        if (event.type === 'status') {
          agent.status = event.status as AgentStatus;
        }

        // Broadcast to all active controllers
        const encoder = new TextEncoder();
        const chunk = encoder.encode(line + '\n');
        for (const controller of agent.controllers) {
          try {
            controller.enqueue(chunk);
          } catch {
            // Remove closed/broken controller
            agent.controllers.delete(controller);
          }
        }
      }
    }

    const emitter = new ManagerEventEmitter();

    // 3. Register cancellation source (so `/api/chat/cancel` can cancel it)
    const cancellation = streamRegistry.register(projectId);

    // 4. Start agent loop in background
    agent.promise = (async () => {
      // Acquire inside the try so a lock failure still runs the cleanup below
      // (otherwise activeAgents keeps a dead entry and blocks every later turn)
      let releaseLock: (() => void) | undefined;
      try {
        releaseLock = await workspaceLocks.get(projectId).acquire('agent-chat-route');
        const project = projectDb.getById(projectId);
        if (!project) throw new Error('Project not found');

        // Get previous messages from DB (most recent history)
        const dbMessages = messageDb.getRecent(projectId, 300);
        const turnIndex = messageDb.getLatestTurnIndex(projectId) + 1;

        const convertToLLMContent = (contentStr: string) => {
          try {
            const parsed = JSON.parse(contentStr);
            // Multimodal parts persisted by the loop (view_image attachments)
            if (Array.isArray(parsed) && parsed.every((p) => p && typeof p === 'object' && typeof p.type === 'string')) {
              return parsed as unknown as string;
            }
            if (parsed && typeof parsed === 'object' && 'text' in parsed) {
              const text = parsed.text;
              const attachments = parsed.attachments || [];
              let fullText = text;
              const images = [];
              for (const att of attachments) {
                if (att.type.startsWith('image/')) {
                  images.push(att);
                } else {
                  fullText += `\n\n[Attached File: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\``;
                }
              }
              if (images.length > 0) {
                return [
                  { type: 'text', text: fullText },
                  ...images.map(img => ({
                    type: 'image_url',
                    image_url: { url: img.content }
                  }))
                ] as unknown as string; // multimodal content array for vision models
              }
              return fullText;
            }
          } catch {}
          return contentStr;
        };

        const history = dbMessages.map((m) => ({
          role:         m.role as "system" | "user" | "assistant" | "tool",
          content:      convertToLLMContent(m.content),
          tool_calls:   m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
          tool_call_id: m.tool_call_id ?? undefined,
          name:         m.tool_name ?? undefined,
        }) as LLMMessage);

        const newMessages = lastMsg ? [{ role: lastMsg.role, content: convertToLLMContent(lastMsg.content) } as LLMMessage] : [];

        // Persist the user's prompt before the background turn starts so a
        // browser refresh can restore the active request even before the
        // agent has produced its final checkpoint.
        if (lastMsg?.role === 'user') {
          messageDb.insert({
            id: crypto.randomUUID(),
            project_id: projectId,
            role: 'user',
            content: lastMsg.content,
            tool_calls: null,
            tool_call_id: null,
            tool_name: null,
            turn_index: turnIndex,
            tokens_used: null,
          });
        }

        const finalModel = requestedModel || getModel();

        // ask_user: the loop blocks here until /api/chat/input delivers an
        // answer; cancellation unblocks with a sentinel so the loop can exit
        const waitForUserInput = (question: string): Promise<string> =>
          new Promise<string>((resolve) => {
            let settled = false;
            const settle = (answer: string) => {
              if (settled) return;
              settled = true;
              unsubscribe();
              agent.pendingInput = undefined;
              resolve(answer);
            };
            const unsubscribe = cancellation.token.onCancel(() =>
              settle('[cancelled]')
            );
            agent.pendingInput = { question, resolve: settle };
          });

        // Same prompt parts /context reports on (shared helper, no drift)
        const { parts: promptParts, mcpTools } = await buildPromptParts(project, {
          mode: executionMode,
          outputStyle,
        });

        // Persisted plan from earlier turns → resume context
        const currentPlan = planDb.get(projectId);

        const systemPrompt = composeSystemPrompt(promptParts);

        await runAgentLoop({
          projectId,
          workspaceRoot: project.workspace,
          messages: [...history, ...newMessages],
          // History rows already live in the DB — only the new message(s)
          // and whatever the loop appends should be persisted this turn
          persistedCount: history.length + newMessages.length,
          llmConfig: { model: finalModel },
          tools: [
            ...(TOOL_SCHEMAS as unknown as LLMTool[]),
            ...(mcpTools as unknown as LLMTool[]),
          ],
          systemPrompt,
          // Project memory is already part of the composed, cached system prompt.
          agentsMemory: undefined,
          activeFilePath,
          turnIndex,
          emitter,
          cancellation,
          waitForUserInput,
          drainQueuedMessages: () => agent.queuedMessages.splice(0),
          currentPlan,
          executionMode,
        });

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        emitter.error(0, errMsg, false);
      } finally {
        releaseLock?.();
        streamRegistry.cleanup(projectId);
        // Close all subscriber controllers
        for (const controller of agent.controllers) {
          try {
            controller.close();
          } catch {}
        }
        agent.controllers.clear();
        this.activeAgents.delete(projectId);
      }
    })();

    // 5. Return a stream for the current request client
    return this.subscribeClient(projectId);
  }
}

export const agentManager = new AgentManager();
