import crypto from "crypto";
import path from "path";
import { z } from "zod";
import type { ScienceToolResult } from "./scienceTools";

export type ScheduleToolResult = ScienceToolResult;

export interface ScheduledTimer {
  id: string;
  workspace: string;
  prompt: string;
  durationSeconds?: number;
  cronExpression?: string;
  timerCondition: string;
  createdAt: number;
  firesAt?: number;
  status: "pending" | "fired" | "cancelled";
  firedAt?: number;
  timeoutHandle?: NodeJS.Timeout;
}

export interface AgentMessage {
  id: string;
  sender: string;
  recipient: string;
  message: string;
  timestamp: number;
  read: boolean;
  workspace: string;
}

// Global registry for timers and peer messages across turns
const shared = globalThis as unknown as {
  __ocTimers?: Map<string, ScheduledTimer>;
  __ocMessages?: AgentMessage[];
};
const timerRegistry = (shared.__ocTimers ??= new Map<string, ScheduledTimer>());
const messageRegistry = (shared.__ocMessages ??= []);

function workspaceTimers(workspace: string): ScheduledTimer[] {
  const norm = path.resolve(workspace);
  return [...timerRegistry.values()].filter((t) => path.resolve(t.workspace) === norm);
}

function workspaceMessages(workspace: string, agentId?: string): AgentMessage[] {
  const norm = path.resolve(workspace);
  return messageRegistry.filter(
    (m) =>
      path.resolve(m.workspace) === norm &&
      (!agentId || m.recipient === agentId || m.sender === agentId)
  );
}

// ─── Schemas ───────────────────────────────────────────────────────────────────

const fn = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = []
) => ({
  type: "function" as const,
  function: {
    name,
    description,
    parameters: { type: "object", properties, required },
  },
});

export const SCHEDULE_TOOL_SCHEMAS = [
  fn(
    "schedule_timer",
    "Schedule a one-shot timer or recurring cron job that triggers a notification or agent wake-up prompt in the background.",
    {
      prompt: {
        type: "string",
        description: "The prompt or notification instruction to trigger when the timer fires",
      },
      duration_seconds: {
        type: "integer",
        description: "Duration in seconds for a one-shot timer (e.g. 30, 300, 3600)",
      },
      cron_expression: {
        type: "string",
        description: "Standard 5-field cron expression for recurring schedules (e.g. '*/5 * * * *')",
      },
      timer_condition: {
        type: "string",
        description: "Early cancellation condition: 'never' (default), 'any', or a specific subagent/task ID",
      },
    },
    ["prompt"]
  ),
  fn(
    "cancel_timer",
    "Cancel an active or pending timer.",
    {
      timer_id: {
        type: "string",
        description: "ID of the scheduled timer to cancel",
      },
    },
    ["timer_id"]
  ),
  fn("list_timers", "List all scheduled timers and recurring background crons for this workspace."),
  fn(
    "agent_send_message",
    "Send a message to another agent, sub-agent, or parent coordinator for multi-agent peer coordination.",
    {
      recipient: {
        type: "string",
        description: "Target agent ID, sub-agent ID, or 'parent'",
      },
      message: {
        type: "string",
        description: "Message content or instruction to send",
      },
      sender: {
        type: "string",
        description: "Sender ID (defaults to 'main')",
      },
    },
    ["recipient", "message"]
  ),
  fn(
    "agent_list_messages",
    "Retrieve messages sent between agents, sub-agents, and coordinators.",
    {
      agent_id: {
        type: "string",
        description: "Agent ID to filter messages for (default: 'main')",
      },
      unread_only: {
        type: "boolean",
        description: "Return only unread incoming messages (default: false)",
      },
    }
  ),
];

export const SCHEDULE_ZOD_SCHEMAS = {
  schedule_timer: z.object({
    prompt: z.string().min(1).max(2000),
    duration_seconds: z.number().int().min(1).max(86400).optional(),
    cron_expression: z.string().max(100).optional(),
    timer_condition: z.string().max(100).optional(),
  }),
  cancel_timer: z.object({
    timer_id: z.string().min(1).max(100),
  }),
  list_timers: z.object({}).optional(),
  agent_send_message: z.object({
    recipient: z.string().min(1).max(100),
    message: z.string().min(1).max(10000),
    sender: z.string().max(100).optional(),
  }),
  agent_list_messages: z.object({
    agent_id: z.string().max(100).optional(),
    unread_only: z.boolean().optional(),
  }),
};

const SCHEDULE_TOOL_NAMES = new Set(SCHEDULE_TOOL_SCHEMAS.map((s) => s.function.name));

export function isScheduleTool(name: string): boolean {
  return SCHEDULE_TOOL_NAMES.has(name);
}

// ─── Executor ──────────────────────────────────────────────────────────────────

export async function executeScheduleTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string
): Promise<ScheduleToolResult> {
  switch (name) {
    case "schedule_timer": {
      const prompt = String(args.prompt);
      const durationSeconds = args.duration_seconds !== undefined ? Number(args.duration_seconds) : undefined;
      const cronExpression = args.cron_expression ? String(args.cron_expression) : undefined;
      const timerCondition = args.timer_condition ? String(args.timer_condition) : "never";

      if (!durationSeconds && !cronExpression) {
        return {
          success: false,
          output: "Error: Either 'duration_seconds' or 'cron_expression' must be specified.",
          summary: "Schedule timer failed: missing duration or cron",
          error: "Either duration_seconds or cron_expression required",
        };
      }

      const id = `timer-${crypto.randomBytes(4).toString("hex")}`;
      const now = Date.now();
      const firesAt = durationSeconds ? now + durationSeconds * 1000 : undefined;

      const timer: ScheduledTimer = {
        id,
        workspace,
        prompt,
        durationSeconds,
        cronExpression,
        timerCondition,
        createdAt: now,
        firesAt,
        status: "pending",
      };

      if (durationSeconds) {
        timer.timeoutHandle = setTimeout(() => {
          timer.status = "fired";
          timer.firedAt = Date.now();
        }, durationSeconds * 1000);
        // Do not prevent Node process exit
        timer.timeoutHandle.unref();
      }

      timerRegistry.set(id, timer);

      const targetDesc = durationSeconds
        ? `in ${durationSeconds} second(s) (at ${new Date(firesAt!).toLocaleTimeString()})`
        : `recurring on cron schedule '${cronExpression}'`;

      return {
        success: true,
        output:
          `Timer ${id} scheduled successfully.\n` +
          `Trigger: ${targetDesc}\n` +
          `Condition: ${timerCondition}\n` +
          `Prompt: "${prompt}"\n\n` +
          `The agent will be notified when this timer triggers.`,
        summary: `Scheduled timer ${id} (${durationSeconds ? `${durationSeconds}s` : cronExpression})`,
        extra: {
          timerId: id,
          durationSeconds,
          cronExpression,
          firesAt,
        },
      };
    }

    case "cancel_timer": {
      const id = String(args.timer_id);
      const timer = timerRegistry.get(id);

      if (!timer) {
        return {
          success: false,
          output: `Timer '${id}' not found.`,
          summary: `Timer not found: ${id}`,
          error: "Timer not found",
        };
      }

      if (timer.timeoutHandle) {
        clearTimeout(timer.timeoutHandle);
      }
      timer.status = "cancelled";

      return {
        success: true,
        output: `Timer ${id} has been cancelled.`,
        summary: `Cancelled timer ${id}`,
      };
    }

    case "list_timers": {
      const timers = workspaceTimers(workspace);
      if (timers.length === 0) {
        return {
          success: true,
          output: "No scheduled timers or cron jobs found for this workspace.",
          summary: "Timers: 0 active",
        };
      }

      const lines = timers.map((t) => {
        const timeInfo = t.durationSeconds
          ? `duration: ${t.durationSeconds}s, status: ${t.status}${t.firesAt ? `, fires at: ${new Date(t.firesAt).toLocaleTimeString()}` : ""}`
          : `cron: ${t.cronExpression}, status: ${t.status}`;
        return `• [${t.id}] ${timeInfo}\n  Prompt: "${t.prompt}" (condition: ${t.timerCondition})`;
      });

      return {
        success: true,
        output: `Scheduled Timers (${timers.length}):\n\n${lines.join("\n\n")}`,
        summary: `Timers: ${timers.filter((t) => t.status === "pending").length} pending`,
        extra: { timers },
      };
    }

    case "agent_send_message": {
      const recipient = String(args.recipient);
      const message = String(args.message);
      const sender = args.sender ? String(args.sender) : "main";

      const msgId = `msg-${crypto.randomBytes(4).toString("hex")}`;
      const newMsg: AgentMessage = {
        id: msgId,
        sender,
        recipient,
        message,
        timestamp: Date.now(),
        read: false,
        workspace,
      };

      messageRegistry.push(newMsg);

      return {
        success: true,
        output:
          `Message sent to agent '${recipient}' (ID: ${msgId}):\n\n` +
          `From: ${sender}\n` +
          `Content: ${message}`,
        summary: `Sent message to ${recipient}`,
        extra: { messageId: msgId, recipient, sender },
      };
    }

    case "agent_list_messages": {
      const agentId = args.agent_id ? String(args.agent_id) : "main";
      const unreadOnly = Boolean(args.unread_only);

      let msgs = workspaceMessages(workspace, agentId);
      if (unreadOnly) {
        msgs = msgs.filter((m) => !m.read && m.recipient === agentId);
      }

      // Mark retrieved incoming messages as read
      for (const m of msgs) {
        if (m.recipient === agentId) {
          m.read = true;
        }
      }

      if (msgs.length === 0) {
        return {
          success: true,
          output: `No ${unreadOnly ? "unread " : ""}messages found for agent '${agentId}'.`,
          summary: `Agent messages: 0`,
        };
      }

      const lines = msgs.map((m) => {
        const dateStr = new Date(m.timestamp).toLocaleTimeString();
        return `[${m.id}] ${dateStr} ${m.sender} ➔ ${m.recipient}:\n${m.message}`;
      });

      return {
        success: true,
        output: `Agent Message Inbox (${msgs.length}):\n\n${lines.join("\n---\n")}`,
        summary: `Agent messages: ${msgs.length} message(s)`,
        extra: { messages: msgs },
      };
    }

    default:
      return {
        success: false,
        output: `Unknown schedule tool: ${name}`,
        summary: `Unknown tool ${name}`,
        error: `Unknown tool ${name}`,
      };
  }
}
