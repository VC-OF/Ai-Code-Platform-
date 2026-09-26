'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { StatusIndicator, type AgentStatus } from '../StatusIndicator';
import { TimelineEvent } from '../TimelineEvent';
import MessageInput from './MessageInput';
import Markdown from './Markdown';
import ContextReport, { type ContextReportData } from './ContextReport';
import SkillsReport, { type SkillsReportItem } from './SkillsReport';
import {
  customCommandDefinitions,
  findSlashCommand,
  parseSlashCommand,
  SLASH_COMMANDS,
  type CustomCommandInfo,
  type ExportableMessage,
  type SlashCommandDefinition,
} from '@/lib/slashCommands';
import {
  getOutputStyle,
  runSlashCommand,
  STATUSLINE_STORAGE_KEY,
  type SlashContext,
} from './slashHandlers';

type Role = 'user' | 'assistant';

interface Message {
  role:    Role;
  content: string;
}

interface PlanTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** NDJSON event from the agent stream / replayed history */
interface TimelineItem {
  type: string;
  ts: number;
  role?: string;
  content?: string;
  plan?: string;
  delta?: string;
  status?: string;
  toolCallId?: string;
  reason?: string;
  filesChanged?: string[];
  [key: string]: unknown;
}

interface MessageAttachment {
  name: string;
  type: string;
  content: string;
}

// Inner event types worth keeping on a sub-agent card (deltas are dropped
// server-side; status only updates the header)
const SUBAGENT_INNER_TYPES = new Set([
  'tool_start', 'tool_end', 'tool_error', 'text_done', 'error', 'plan', 'verification', 'checkpoint', 'compaction', 'hook',
]);

function upsertSubagent(
  t: TimelineItem[],
  toolCallId: string,
  patch: (item: TimelineItem) => TimelineItem,
  seed: () => TimelineItem
): TimelineItem[] {
  const idx = t.findIndex((item) => item.type === 'subagent' && item.toolCallId === toolCallId);
  if (idx === -1) return [...t, patch(seed())];
  const next = t.slice();
  next[idx] = patch(t[idx]);
  return next;
}

/** spawn_agent tool events open/close the card instead of adding plain rows. */
function applySubagentToolEvent(t: TimelineItem[], event: TimelineItem): TimelineItem[] {
  const toolCallId = String(event.toolCallId ?? '');
  const args = (event.args ?? {}) as Record<string, unknown>;
  const seed = (): TimelineItem => ({
    type: 'subagent',
    toolCallId,
    ts: event.ts,
    label: String(args.label ?? `${args.kind ?? 'sub'} agent`),
    kind: String(args.kind ?? 'agent'),
    task: String(args.task ?? '').slice(0, 600),
    events: [],
    status: 'planning',
    done: false,
  });
  if (event.type === 'tool_start') return upsertSubagent(t, toolCallId, (item) => item, seed);
  if (event.type === 'tool_end') {
    const result = event.result as { success?: boolean; summary?: string; subagent?: unknown } | undefined;
    return upsertSubagent(t, toolCallId, (item) => ({
      ...item, done: true, success: result?.success !== false, summary: result?.summary, subagent: result?.subagent,
    }), seed);
  }
  return upsertSubagent(t, toolCallId, (item) => ({
    ...item, done: true, success: false, error: event.error,
  }), seed);
}

/** Nest a sub-agent's forwarded event under its card. */
function mergeSubagentEvent(t: TimelineItem[], event: TimelineItem): TimelineItem[] {
  const toolCallId = String(event.toolCallId ?? '');
  const inner = event.event as TimelineItem | undefined;
  if (!toolCallId || !inner) return t;
  const seed = (): TimelineItem => ({
    type: 'subagent', toolCallId, ts: event.ts,
    label: String(event.label ?? 'sub-agent'), kind: String(event.kind ?? 'agent'),
    events: [], status: 'planning', done: false,
  });
  return upsertSubagent(t, toolCallId, (item) => {
    if (inner.type === 'status') return { ...item, status: inner.status };
    if (!SUBAGENT_INNER_TYPES.has(inner.type)) return item;
    const events = (item.events as TimelineItem[] | undefined) ?? [];
    const dup = inner.toolCallId
      ? events.some((e) => e.type === inner.type && e.toolCallId === inner.toolCallId)
      : events.some((e) => e.type === inner.type && e.ts === inner.ts);
    return dup ? item : { ...item, events: [...events, inner] };
  }, seed);
}

// Real prompt templates (the old pills inserted fake "/build"-style slash
// commands that no backend feature ever interpreted)
const PROMPT_TEMPLATES: { label: string; hint: string; prompt: string }[] = [
  {
    label: 'Build',
    hint: 'Scaffold a new feature or app',
    prompt: 'Build the following, then run lint to verify it compiles: ',
  },
  {
    label: 'Fix',
    hint: 'Debug and fix an issue',
    prompt: 'Find and fix this bug, then verify the fix with lint/tests: ',
  },
  {
    label: 'Test',
    hint: 'Add or run tests',
    prompt: 'Write tests for the following and run them until they pass: ',
  },
  {
    label: 'Refactor',
    hint: 'Improve existing code without changing behavior',
    prompt: 'Refactor the following without changing behavior, verifying with lint and existing tests: ',
  },
  {
    label: 'Explain',
    hint: 'Explain how something works',
    prompt: 'Read the relevant files and explain how this works: ',
  },
  {
    label: 'Compact',
    hint: 'Compact working context (2M token limit)',
    prompt: '/compact',
  },
  {
    label: 'Context',
    hint: 'Inspect context metrics (2M token limit)',
    prompt: '/context',
  },
  {
    label: 'Skills',
    hint: 'Inspect active project skills',
    prompt: '/skills',
  },
  {
    label: 'Artifacts',
    hint: 'Review or generate project architecture artifacts',
    prompt: 'List or create persistent architecture artifacts for this project using create_artifact.',
  },
  {
    label: 'Knowledge',
    hint: 'Inspect or record repository Knowledge Items',
    prompt: 'Check active Knowledge Items and verify against our established repository patterns.',
  },
  {
    label: 'Docker',
    hint: 'Inspect Docker engine and sandbox status',
    prompt: '/docker',
  },
  {
    label: 'Mode',
    hint: 'Switch execution mode: auto, manual, or plan',
    prompt: '/mode',
  },
];

interface ChatPanelProps {
  projectId:       string;
  activeFilePath?: string;
  onFilesChanged:  (files: string[]) => void;
  onFileSelect:    (path: string) => void;
  selectedModel?:  string;
  /** Lets /model switch the model; omitted where the picker isn't available */
  onModelChange?:  (model: string) => void;
  projectName?:    string;
  onStatusChange?: (status: AgentStatus) => void;
  /** Fired when a turn completes; filesChanged comes from the agent's done event */
  onAgentDone?:    (info: { reason: string; filesChanged: string[] }) => void;
  initialPrompt?:  string | null;
  onClearInitialPrompt?: () => void;
  isFullWidth?:    boolean;
}

export default function ChatPanel({
  projectId,
  activeFilePath,
  onFilesChanged,
  onFileSelect,
  selectedModel,
  onModelChange,
  projectName,
  onStatusChange,
  onAgentDone,
  initialPrompt,
  onClearInitialPrompt,
  isFullWidth = false,
}: ChatPanelProps) {
  const [history,       setHistory]       = useState<Message[]>([]);
  const [timeline,      setTimeline]      = useState<TimelineItem[]>([]);
  const [agentStatus,   setAgentStatus]   = useState<AgentStatus>('done');
  const [loading,       setLoading]       = useState(false);
  const [input,         setInput]         = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState<{
    ts: number; question: string; options?: string[];
  } | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const [plan, setPlan] = useState<PlanTask[]>([]);
  const [planCollapsed, setPlanCollapsed] = useState(false);
  const [lastDoneReason, setLastDoneReason] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentToolInfo, setCurrentToolInfo] = useState<{ name: string; detail?: string } | null>(null);

  const [executionMode, setExecutionMode] = useState<'auto' | 'manual' | 'plan'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('oc-execution-mode');
      if (saved === 'manual' || saved === 'plan' || saved === 'auto') return saved;
    }
    return 'auto';
  });

  // /statusline toggles the mode/context row under the timeline
  const [statuslineVisible, setStatuslineVisible] = useState(true);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        setStatuslineVisible(localStorage.getItem(STATUSLINE_STORAGE_KEY) !== 'true');
      } catch {}
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const handleModeChange = (mode: 'auto' | 'manual' | 'plan') => {
    setExecutionMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('oc-execution-mode', mode);
    }
  };

  const [contextInfo, setContextInfo] = useState<{
    tokens: number;
    limit: number;
    ratio: number;
    messageCount: number;
  }>({ tokens: 0, limit: 2_000_000, ratio: 0, messageCount: 0 });

  const loadContextInfo = useCallback(async () => {
    if (!projectId || projectId === 'default') return;
    try {
      const res = await fetch(`/api/chat/context?projectId=${encodeURIComponent(projectId)}&model=${encodeURIComponent(selectedModel || '')}`);
      if (res.ok) {
        const data = await res.json();
        setContextInfo({
          tokens: Number(data.currentTokens || 0),
          limit: Number(data.windowSize || 2_000_000),
          ratio: Number(data.ratio || 0),
          messageCount: Number(data.messageCount || 0),
        });
      }
    } catch {}
  }, [projectId, selectedModel]);

  useEffect(() => {
    loadContextInfo();
  }, [loadContextInfo, historyReloadKey, timeline.length]);

  // Live timer while agent is executing
  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      setCurrentToolInfo(null);
      return;
    }
    const t0 = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - t0) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [loading]);

  // Restore the persisted plan when opening a project
  useEffect(() => {
    if (!projectId || projectId === 'default') {
      setPlan([]);
      return;
    }
    fetch(`/api/plan?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d) => setPlan(d.tasks || []))
      .catch(() => setPlan([]));
  }, [projectId, historyReloadKey]);

  // Checkpoint revert rewound the DB history — refetch it
  useEffect(() => {
    const onRewound = () => {
      setTimeline([]);
      setHistory([]);
      setHistoryReloadKey((k) => k + 1);
    };
    window.addEventListener('oc-history-rewound', onRewound);
    return () => window.removeEventListener('oc-history-rewound', onRewound);
  }, []);

  // Listen for editor code selection bridge injection
  useEffect(() => {
    const handleInjectPrompt = (e: Event) => {
      const customEvent = e as CustomEvent<{ prompt?: string }>;
      if (customEvent.detail?.prompt) {
        setInput((prev) => (prev ? `${prev.trim()}\n\n${customEvent.detail?.prompt}` : (customEvent.detail?.prompt || '')));
        setTimeout(() => {
          const textarea = document.querySelector('.input-textarea') as HTMLTextAreaElement;
          if (textarea) {
            textarea.focus();
            textarea.scrollTop = textarea.scrollHeight;
          }
        }, 50);
      }
    };
    window.addEventListener('oc-inject-prompt', handleInjectPrompt);
    return () => window.removeEventListener('oc-inject-prompt', handleInjectPrompt);
  }, []);

  const endRef = useRef<HTMLDivElement>(null);

  // Live "thinking" text from reasoning models (never part of the reply)
  const [streamingReasoning, setStreamingReasoning] = useState('');

  // Project slash commands (.claude/commands/*.md) — served per project
  const [customCommands, setCustomCommands] = useState<SlashCommandDefinition[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      // Welcome screen: the panel is mounted before a project is open
      setCustomCommands([]);
      return;
    }
    fetch(`/api/commands?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? r.json() : { commands: [] }))
      .then((data: { commands?: CustomCommandInfo[] }) => {
        if (!cancelled) setCustomCommands(customCommandDefinitions(data.commands ?? []));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  const updateStatus = (status: AgentStatus) => {
    setAgentStatus(status);
    onStatusChange?.(status);
  };

  const processStream = async (resPromise: Promise<Response>) => {
    let sawError = false;
    try {
      const res = await resPromise;
      if (!res.ok || !res.body) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: TimelineItem;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === 'status') {
            updateStatus(event.status as AgentStatus);
          } else if (event.type === 'text_delta') {
            setStreamingText((s) => s + (event.delta ?? ''));
          } else if (event.type === 'reasoning_delta') {
            setStreamingReasoning((s) => s + (event.delta ?? ''));
          } else if (event.type === 'reasoning_done') {
            setStreamingReasoning('');
            setTimeline((t) => {
              const exists = t.some((item) => item.type === 'reasoning' && item.ts === event.ts);
              return exists ? t : [...t, { ...event, type: 'reasoning' }];
            });
          } else if (event.type === 'hook') {
            setTimeline((t) => (t.some((item) => item.type === 'hook' && item.ts === event.ts) ? t : [...t, event]));
          } else if (event.type === 'subagent_event') {
            setTimeline((t) => mergeSubagentEvent(t, event));
          } else if (event.type === 'text_done') {
            setStreamingText('');
            setStreamingReasoning('');
            const doneContent = event.content ?? '';
            setHistory((h) => {
              const exists = h.some((m) => m.role === 'assistant' && m.content === doneContent);
              if (exists) return h;
              return [...h, { role: 'assistant', content: doneContent }];
            });
            setTimeline((t) => {
              const exists = t.some((item) => item.type === 'message' && item.role === 'assistant' && item.content === event.content);
              if (exists) return t;
              return [
                ...t,
                { type: 'message', role: 'assistant', content: event.content, ts: Date.now() },
              ];
            });
          } else if (event.type === 'done') {
            setTimeline((t) => {
              const exists = t.some((item) => item.type === 'done' && item.ts === event.ts);
              if (exists) return t;
              return [...t, event];
            });
            const files: string[] = event.filesChanged ?? [];
            if (files.length > 0) onFilesChanged(files);
            setLastDoneReason(event.reason ?? 'completed');
            onAgentDone?.({ reason: event.reason ?? 'completed', filesChanged: files });
          } else if (event.type === 'plan_update') {
            if (Array.isArray(event.tasks)) {
              setPlan(event.tasks as PlanTask[]);
              setPlanCollapsed(false);
            }
          } else if (event.type === 'user_input_request') {
            setTimeline((t) => {
              const exists = t.some((item) => item.type === 'user_input_request' && item.ts === event.ts);
              return exists ? t : [...t, event];
            });
            setPendingQuestion({
              ts: event.ts,
              question: String(event.question ?? ''),
              options: Array.isArray(event.options) ? (event.options as string[]) : undefined,
            });
          } else if (event.type === 'error') {
            sawError = true;
            setTimeline((t) => [...t, event]);
          } else if (
            ['message', 'tool_start', 'tool_end', 'tool_error', 'checkpoint', 'compaction', 'verification', 'plan'].includes(event.type)
          ) {
            if (event.type === 'tool_start') {
              const toolEvt = event as unknown as { toolName?: string; args?: Record<string, unknown> };
              const toolName = toolEvt.toolName ?? 'tool';
              const args = toolEvt.args || {};
              const detail = (args.path || args.file || args.command || args.query || args.question || '') as string;
              setCurrentToolInfo({
                name: toolName,
                detail: detail ? String(detail).slice(0, 50) : undefined,
              });
            } else if (event.type === 'tool_end' || event.type === 'tool_error') {
              setCurrentToolInfo(null);
            }

            // Delegations get a nested card instead of plain tool rows
            if (
              event.toolName === 'spawn_agent' &&
              (event.type === 'tool_start' || event.type === 'tool_end' || event.type === 'tool_error')
            ) {
              setTimeline((t) => applySubagentToolEvent(t, event));
              continue;
            }

            setTimeline((t) => {
              if (event.type === 'message') {
                const exists = t.some((item) => item.type === 'message' && item.role === event.role && item.content === event.content);
                if (exists) return t;
              }
              if (event.type === 'plan') {
                const exists = t.some((item) => item.type === 'plan' && item.plan === event.plan);
                if (exists) return t;
              }
              if (event.toolCallId) {
                const exists = t.some((item) => item.toolCallId === event.toolCallId && item.type === event.type);
                if (exists) return t;
              }
              return [...t, event];
            });
            // Question answered (possibly from another tab) — hide the card
            if (event.type === 'tool_end' && event.toolName === 'ask_user') {
              setPendingQuestion(null);
            }
          }
        }
      }
    } catch (err) {
      sawError = true;
      setTimeline((t) => [
        ...t,
        {
          type:    'error',
          message: err instanceof Error ? err.message : String(err),
          ts:      Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
      setStreamingText('');
      setStreamingReasoning('');
      setPendingQuestion(null);
      setCurrentToolInfo(null);
      updateStatus(sawError ? 'error' : 'done');
    }
  };

  const answerQuestion = async (answer: string) => {
    const text = answer.trim();
    if (!text) return;
    setPendingQuestion(null);
    setAnswerText('');
    setTimeline((t) => [
      ...t,
      { type: 'message', role: 'user', content: text, ts: Date.now() },
    ]);
    try {
      await fetch('/api/chat/input', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId, answer: text }),
      });
    } catch {}
  };

  const reconnectStream = async () => {
    setLoading(true);
    updateStatus('planning');
    const resPromise = fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        projectId,
      }),
    });
    await processStream(resPromise);
  };

  const executePrompt = async (text: string, baseHistory: Message[] = []) => {
    setInput('');
    setLoading(true);
    setLastDoneReason(null);
    updateStatus('planning');

    const content = JSON.stringify({ text, attachments: [] });
    const nextHistory = [...baseHistory, { role: 'user' as const, content }];
    setHistory(nextHistory);
    setTimeline((t) => [
      ...t,
      { type: 'message', role: 'user', content, ts: Date.now() },
    ]);

    const resPromise = fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: nextHistory,
        projectId,
        activeFilePath,
        model: selectedModel,
        mode: executionMode,
        outputStyle: getOutputStyle(projectId),
      }),
    });

    await processStream(resPromise);
  };

  useEffect(() => {
    if (!projectId || projectId === 'default') {
      setHistory([]);
      setTimeline([]);
      updateStatus('done');
      return;
    }

    setLoading(true);
    let loadedHistory: Message[] = [];
    fetch(`/api/projects?id=${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.project?.chatHistory) {
          loadedHistory = (data.project.chatHistory as Message[]).filter(
            (m) => m.role === 'user' || m.role === 'assistant'
          );
          setHistory(loadedHistory);
          setTimeline(
            loadedHistory.map((m) => ({
              type:    'message',
              role:    m.role,
              content: m.content,
              ts:      Date.now(),
            }))
          );
        }

        // Check active running agent status
        return fetch(`/api/chat/status?projectId=${projectId}`);
      })
      .then((res) => {
        if (res && res.ok) return res.json();
        return null;
      })
      .then((statusData) => {
        if (statusData && statusData.running) {
          reconnectStream();
        } else {
          setLoading(false);
          if (initialPrompt && loadedHistory.length === 0) {
            onClearInitialPrompt?.();
            executePrompt(initialPrompt, []);
          }
        }
      })
      .catch((err) => {
        console.error('Error loading project status/history:', err);
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, historyReloadKey, initialPrompt]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline, streamingText, agentStatus, loading]);

  // "Clear Chat Timeline" from the command palette
  useEffect(() => {
    const clear = () => {
      setTimeline([]);
      setHistory([]);
    };
    window.addEventListener('oc-clear-chat', clear);
    return () => window.removeEventListener('oc-clear-chat', clear);
  }, []);

  // Element picked in the preview's Inspect mode → prefill an edit prompt
  useEffect(() => {
    const onPick = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        selector: string; tag: string; classes: string; text: string;
      };
      const label = d.text ? ` containing "${d.text}"` : '';
      setInput(
        `Edit the <${d.tag}> element${label} (CSS selector: ${d.selector}): `
      );
      (document.querySelector('.input-textarea') as HTMLTextAreaElement)?.focus();
    };
    window.addEventListener('oc-element-picked', onPick);
    return () => window.removeEventListener('oc-element-picked', onPick);
  }, []);

  const cancelRun = async () => {
    try {
      await fetch('/api/chat/cancel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId }),
      });
    } catch {}
  };

  const say = (content: string) => {
    setTimeline((t) => [...t, { type: 'message', role: 'assistant', content, ts: Date.now() }]);
  };

  const getTranscript = (): ExportableMessage[] =>
    timeline
      .filter((item) => item.type === 'message' && (item.role === 'user' || item.role === 'assistant'))
      .map((item) => {
        let text = item.content ?? '';
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') text = parsed.text;
        } catch {}
        return { role: item.role as string, text, ts: item.ts };
      });

  const slashContext = (): SlashContext => ({
    projectId,
    projectName,
    selectedModel,
    onModelChange,
    executionMode,
    setExecutionMode: handleModeChange,
    agentStatus,
    loading,
    statuslineVisible,
    setStatuslineVisible,
    say,
    push: (item) => setTimeline((t) => [...t, { ts: Date.now(), ...item } as TimelineItem]),
    getTranscript,
  });

  /** `override` lets chips and badges run a command without touching the composer */
  const send = async (attachments: MessageAttachment[] = [], override?: string) => {
    let text = (override ?? input).trim();
    if (!text && attachments.length === 0) return;

    const slash = parseSlashCommand(text);
    if (slash) {
      const command = findSlashCommand(slash.name, customCommands.length ? [...SLASH_COMMANDS, ...customCommands] : SLASH_COMMANDS);
      setInput('');

      if (!command) {
        setTimeline((t) => [
          ...t,
          {
            type: 'message',
            role: 'assistant',
            content: `Unknown command /${slash.name}. Type /help to see available commands.`,
            ts: Date.now(),
          },
        ]);
        return;
      }

      if (command.name === 'clear') {
        setTimeline([]);
        setHistory([]);
        window.dispatchEvent(new CustomEvent('oc-clear-chat'));
        return;
      }

      if (command.name === 'context') {
        try {
          const res = await fetch(`/api/chat/context?projectId=${encodeURIComponent(projectId)}&model=${encodeURIComponent(selectedModel || '')}`);
          const data = await res.json();
          if (!res.ok || data.error || !Array.isArray(data.categories)) {
            throw new Error(data.error || `HTTP ${res.status}`);
          }
          setTimeline((t) => [...t, { type: 'context_report', data, ts: Date.now() }]);
        } catch (err) {
          say(`Couldn't load context usage: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      if (command.name === 'compact') {
        try {
          setTimeline((t) => [
            ...t,
            { type: 'message', role: 'assistant', content: 'Compacting working context into memory brief…', ts: Date.now() },
          ]);
          const res = await fetch('/api/chat/compact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, model: selectedModel, instructions: slash.args }),
          });
          const data = await res.json();
          if (data.compacted) {
            setTimeline((t) => [
              ...t.filter((m) => m.content !== 'Compacting working context into memory brief…'),
              {
                type: 'compaction',
                before: data.before,
                after: data.after,
                ts: Date.now(),
              } as TimelineItem,
              {
                type: 'message',
                role: 'assistant',
                content: `**Context successfully compacted!**\n• Messages: \`${data.before.messages} → ${data.after.messages}\`\n• Tokens: \`${Number(data.before.tokens).toLocaleString()} → ${Number(data.after.tokens).toLocaleString()} tokens\`\n• Limit: \`${Number(data.windowSize || 2_000_000).toLocaleString()} tokens\` (2M limit)\n${data.summary ? `\n> **Summary Memory:**\n> ${data.summary}` : ''}`,
                ts: Date.now(),
              },
            ]);
            setHistoryReloadKey((k) => k + 1);
            loadContextInfo();
          } else {
            setTimeline((t) => [
              ...t.filter((m) => m.content !== 'Compacting working context into memory brief…'),
              {
                type: 'message',
                role: 'assistant',
                content: data.error
                  ? `Couldn't compact the context: ${data.error}. Nothing was changed.`
                  : `${data.message || 'Context is already compact and does not need compaction.'}`,
                ts: Date.now(),
              },
            ]);
          }
        } catch (err) {
          setTimeline((t) => [
            ...t.filter((m) => m.content !== 'Compacting working context into memory brief…'),
            {
              type: 'message',
              role: 'assistant',
              content: `Failed to compact context: ${err instanceof Error ? err.message : String(err)}`,
              ts: Date.now(),
            },
          ]);
        }
        return;
      }

      const result = await runSlashCommand(command, slash.args, slashContext());
      if (result.type === 'handled') return;
      if (result.type === 'prompt') {
        text = result.text;
        if (!text.trim()) return;
      } else {
        text = command.prompt?.(slash.args) ?? slash.args;
        if (!text.trim()) {
          say(`Usage: \`/${command.name}${command.args ? ` ${command.args}` : ''}\``);
          return;
        }
      }
    }

    // Agent already running → steer it: queue the message for its next step
    if (loading) {
      if (!text) return;
      setInput('');
      // If the agent is waiting on ask_user, treat the message as the answer
      if (pendingQuestion) {
        await answerQuestion(text);
        return;
      }
      setTimeline((t) => [
        ...t,
        { type: 'message', role: 'user', content: text, ts: Date.now() },
      ]);
      try {
        await fetch('/api/chat/queue', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ projectId, content: text }),
        });
      } catch {}
      return;
    }

    setInput('');
    setLoading(true);
    setLastDoneReason(null);
    updateStatus('planning');

    const content = JSON.stringify({ text, attachments });

    const nextHistory = [...history, { role: 'user' as const, content }];
    setHistory(nextHistory);
    setTimeline((t) => [
      ...t,
      { type: 'message', role: 'user', content, ts: Date.now() },
    ]);

    const resPromise = fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        messages: nextHistory,
        projectId,
        activeFilePath,
        model: selectedModel,
        mode: executionMode,
        outputStyle: getOutputStyle(projectId),
      }),
    });

    await processStream(resPromise);
  };

  const nextPlanTask = plan.find((t) => t.status === 'in_progress') || plan.find((t) => t.status === 'pending');
  const completedCount = plan.filter((t) => t.status === 'completed').length;

  return (
    <div className={`chat-panel ${isFullWidth ? 'chat-panel--full' : ''}`}>
      <div className="chat-timeline">
          {timeline.length === 0 && !loading && (
            <div className="chat-empty-state">
              <h2 className="chat-empty-title">What should we build or solve?</h2>
              <p className="chat-empty-desc">Describe a feature, a bug, a question about the code — or a problem to work through: a derivation, a simulation, a data analysis.</p>
            </div>
          )}
          {timeline.map((item, i) => {
            if (item.type === 'message') {
              const isUser = item.role === 'user';
              let textContent = item.content;
              let attachments: MessageAttachment[] = [];
              try {
                const parsed = JSON.parse(item.content ?? '');
                if (parsed && typeof parsed === 'object' && 'text' in parsed) {
                  textContent = parsed.text;
                  attachments = parsed.attachments || [];
                }
              } catch {}

              return (
                <div key={i} className={`timeline-msg ${isUser ? 'timeline-msg--user' : 'timeline-msg--assistant'}`}>
                  <div className="msg-bubble">
                    {attachments.length > 0 && (
                      <div className="msg-attachments">
                        {attachments.map((att, idx) => (
                          <div key={idx} className="msg-attachment-item">
                            {att.type.startsWith('image/') ? (
                              // eslint-disable-next-line @next/next/no-img-element -- inline data URL
                              <img src={att.content} alt={att.name} className="msg-attachment-thumb" />
                            ) : (
                              <svg className="msg-attachment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14} aria-hidden="true">
                                <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" />
                              </svg>
                            )}
                            <span className="msg-attachment-name">{att.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {isUser ? (
                      <span className="msg-text">{textContent}</span>
                    ) : (
                      <Markdown text={textContent ?? ''} projectId={projectId} />
                    )}
                  </div>
                </div>
              );
            }
            if (item.type === 'context_report') {
              return <ContextReport key={i} data={item.data as ContextReportData} />;
            }
            if (item.type === 'skills_report') {
              return <SkillsReport key={i} skills={(item.skills as SkillsReportItem[]) ?? []} />;
            }
            return <TimelineEvent key={i} event={item} projectId={projectId} />;
          })}

          {/* Live thinking from reasoning models */}
          {streamingReasoning && (
            <div className="timeline-msg timeline-msg--assistant">
              <div className="msg-bubble reasoning-live">
                <span className="reasoning-live-label">Thinking</span>
                <span className="reasoning-live-text">{streamingReasoning.slice(-600)}</span>
              </div>
            </div>
          )}

          {/* Live token stream from the current step */}
          {streamingText && (
            <div className="timeline-msg timeline-msg--assistant">
              <div className="msg-bubble">
                <span className="msg-text">{streamingText}</span>
                <span className="stream-caret" />
              </div>
            </div>
          )}

          {/* Live agent activity while a turn is running */}
          {loading && (
            <div className="agent-live-row" role="status">
              <span className="agent-live-dot" aria-hidden="true" />
              <StatusIndicator status={agentStatus} elapsedSeconds={elapsedSeconds} />
              <span className="agent-live-desc">
                {currentToolInfo ? (
                  <>
                    <span className="agent-live-tool">{currentToolInfo.name}</span>
                    {currentToolInfo.detail && <span className="agent-live-detail">{currentToolInfo.detail}</span>}
                  </>
                ) : (
                  agentStatus === 'planning' ? 'Planning the next step…'
                    : agentStatus === 'writing' ? 'Writing changes…'
                    : agentStatus === 'reading' ? 'Reading files…'
                    : agentStatus === 'linting' ? 'Running the linter…'
                    : agentStatus === 'testing' ? 'Running tests…'
                    : agentStatus === 'compacting' ? 'Compacting context…'
                    : agentStatus === 'waiting' ? 'Waiting for your answer…'
                    : 'Working…'
                )}
              </span>
              <button
                type="button"
                className="agent-live-stop-btn"
                onClick={cancelRun}
                title="Stop (Esc)"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width={9} height={9} aria-hidden="true">
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
                Stop
              </button>
            </div>
          )}

          {/* Agent plan (persists across turns, scrolls with the feed) */}
          {plan.length > 0 && (
            <div className="plan-card">
              <button
                type="button"
                className="plan-header"
                onClick={() => setPlanCollapsed((c) => !c)}
                aria-expanded={!planCollapsed}
              >
                <span className="plan-title">Plan</span>
                <span className="plan-count">{completedCount} of {plan.length} done</span>
                <svg className={`plan-toggle ${planCollapsed ? '' : 'plan-toggle--open'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={12} aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
              {!planCollapsed && (
                <div className="plan-tasks">
                  {plan.map((t) => (
                    <div key={t.id} className={`plan-task plan-task--${t.status}`}>
                      <span className="plan-task-mark" aria-hidden="true">
                        {t.status === 'completed' ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={12} height={12}>
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        ) : t.status === 'in_progress' ? (
                          loading ? (
                            <svg className="plan-spinner" viewBox="0 0 16 16" fill="none" width={12} height={12}>
                              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
                              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <span className="plan-dot plan-dot--paused" />
                          )
                        ) : (
                          <span className="plan-dot" />
                        )}
                      </span>
                      <span className="plan-task-title">{t.title}</span>
                      {t.status === 'in_progress' && (
                        <span className="plan-task-tag">{loading ? 'Running' : 'Paused'}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Plan continuation (paused/stopped with uncompleted tasks) */}
          {!loading && plan.length > 0 && plan.some((t) => t.status !== 'completed') && (
            <div className="plan-continue-card">
              <div className="plan-continue-top">
                <span className="plan-continue-status">
                  {lastDoneReason === 'max_steps' || lastDoneReason === 'timeout'
                    ? 'Turn limit reached'
                    : 'Paused'}
                </span>
                <span className="plan-continue-count">{completedCount} of {plan.length} tasks done</span>
              </div>

              {nextPlanTask && (
                <div className="plan-continue-next-row">
                  <span className="plan-continue-next-label">Next:</span>
                  <span className="plan-continue-next-title">{nextPlanTask.title}</span>
                </div>
              )}

              <div className="plan-continue-btn-row">
                <button
                  type="button"
                  className="plan-continue-btn plan-continue-btn--primary"
                  onClick={() => {
                    setLastDoneReason(null);
                    const nextInstruction = nextPlanTask
                      ? `Continue executing the plan. Next task is: "${nextPlanTask.title}". Please proceed with implementing and verifying.`
                      : 'Continue working through the remaining tasks in the plan until complete.';
                    executePrompt(nextInstruction, history);
                  }}
                >
                  Continue
                </button>
                <button
                  type="button"
                  className="plan-continue-btn"
                  onClick={() => {
                    setInput(nextPlanTask ? `Regarding task "${nextPlanTask.title}": ` : 'Continue: ');
                    (document.querySelector('.input-textarea') as HTMLTextAreaElement)?.focus();
                  }}
                >
                  Give instructions
                </button>
              </div>
            </div>
          )}

          {/* Plan completed */}
          {!loading && plan.length > 0 && plan.every((t) => t.status === 'completed') && (
            <div className="plan-completed-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={12} height={12} aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>All {plan.length} plan tasks are done.</span>
            </div>
          )}

          {/* Continue banner after an interrupted turn (fallback when no plan) */}
          {!loading && plan.length === 0 && (lastDoneReason === 'max_steps' || lastDoneReason === 'timeout') && (
            <div className="continue-banner">
              <span>
                The turn hit its {lastDoneReason === 'timeout' ? 'time' : 'step'} limit.
              </span>
              <button
                type="button"
                className="continue-btn"
                onClick={() => {
                  setLastDoneReason(null);
                  setInput('Continue from where you left off.');
                  (document.querySelector('.input-textarea') as HTMLTextAreaElement)?.focus();
                }}
              >
                Continue
              </button>
            </div>
          )}

          {/* ask_user question card */}
          {pendingQuestion && (
            <div className="ask-question-card" role="region" aria-label="The agent needs your input">
              <div className="ask-question-header">
                <span className="ask-question-dot" aria-hidden="true" />
                <span className="ask-question-title">The agent needs your input</span>
              </div>

              <p className="ask-question-prompt">{pendingQuestion.question}</p>

              {pendingQuestion.options && pendingQuestion.options.length > 0 && (
                <div className="ask-question-options">
                  {pendingQuestion.options.map((option, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`ask-question-option-btn ${answerText === option ? 'ask-question-option-btn--selected' : ''}`}
                      onClick={() => setAnswerText(option)}
                      onDoubleClick={() => answerQuestion(option)}
                      aria-pressed={answerText === option}
                      title="Click to choose, double-click to send"
                    >
                      <span className="ask-question-option-num">{idx + 1}</span>
                      <span className="ask-question-option-text">{option}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="ask-question-input-row">
                <input
                  type="text"
                  className="ask-question-input"
                  aria-label="Your answer"
                  placeholder={
                    pendingQuestion.options?.length
                      ? 'Choose an option or type your own answer'
                      : 'Type your answer'
                  }
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (answerText.trim()) answerQuestion(answerText);
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="ask-question-submit-btn"
                  disabled={!answerText.trim()}
                  onClick={() => answerQuestion(answerText)}
                >
                  Send answer
                </button>
              </div>
              <div className="ask-question-hint">Double-click an option to send it right away, or press Enter.</div>
            </div>
          )}

          <div ref={endRef} />
      </div>

      {/* Bottom dock: controls and composer */}
      <div className="chat-bottom-dock">
        {statuslineVisible && (
        <div className="chat-utility-bar">
          <div className="mode-toggle-group" role="group" aria-label="Execution mode">
            <button
              type="button"
              className={`mode-toggle-btn ${executionMode === 'auto' ? 'mode-toggle-btn--active' : ''}`}
              title="Auto: runs without pausing"
              aria-pressed={executionMode === 'auto'}
              onClick={() => handleModeChange('auto')}
            >
              Auto
            </button>
            <button
              type="button"
              className={`mode-toggle-btn ${executionMode === 'manual' ? 'mode-toggle-btn--active' : ''}`}
              title="Manual: asks before editing files or running commands"
              aria-pressed={executionMode === 'manual'}
              onClick={() => handleModeChange('manual')}
            >
              Manual
            </button>
            <button
              type="button"
              className={`mode-toggle-btn ${executionMode === 'plan' ? 'mode-toggle-btn--active' : ''}`}
              title="Plan: writes a plan before editing"
              aria-pressed={executionMode === 'plan'}
              onClick={() => handleModeChange('plan')}
            >
              Plan
            </button>
          </div>

          <button
            type="button"
            className="context-badge-pill"
            title={`Context usage: ${contextInfo.tokens.toLocaleString()} / 2,000,000 tokens (${((contextInfo.tokens / (contextInfo.limit || 2_000_000)) * 100).toFixed(2)}%)`}
            onClick={() => send([], '/context')}
          >
            {contextInfo.tokens >= 1000 ? `${(contextInfo.tokens / 1000).toFixed(1)}k` : contextInfo.tokens} / 2.0M tokens
          </button>
        </div>
        )}

        <div className="prompt-chips-track">
          {PROMPT_TEMPLATES.map((tpl) => (
            <button
              type="button"
              key={tpl.label}
              className="prompt-chip-btn"
              title={tpl.hint}
              onClick={() => {
                if (tpl.prompt.startsWith('/')) {
                  send([], tpl.prompt);
                } else {
                  setInput(tpl.prompt);
                  (document.querySelector('.input-textarea') as HTMLTextAreaElement)?.focus();
                }
              }}
            >
              {tpl.label}
            </button>
          ))}
        </div>

        <MessageInput
          extraCommands={customCommands}
          value={input}
          onChange={setInput}
          onSend={(attachments) => send(attachments)}
          onCancel={cancelRun}
          isStreaming={loading}
          activeFile={activeFilePath}
        />
      </div>

      <style jsx>{`
        .chat-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          position: relative;
          background: var(--bg-base);
          font-family: var(--font-sans);
          font-size: 13px;
          color: var(--text-primary);
        }

        .chat-panel--full {
          max-width: 820px;
          margin: 0 auto;
          width: 100%;
        }

        /* Feed */
        .chat-timeline {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 16px 16px 12px;
        }

        /* Empty state */
        .chat-empty-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 8px;
          padding: 32px 16px;
        }
        .chat-empty-title {
          font-family: var(--font-serif);
          font-size: 26px;
          font-weight: 400;
          line-height: 1.25;
          color: var(--text-primary);
          margin: 0;
        }
        .chat-empty-desc {
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.5;
          max-width: 320px;
          margin: 0;
        }

        /* Messages */
        .timeline-msg {
          display: flex;
          margin: 6px 0;
        }
        .timeline-msg--user {
          justify-content: flex-end;
        }
        .timeline-msg--user .msg-bubble {
          max-width: 85%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 8px 12px;
          color: var(--text-primary);
        }
        .timeline-msg--assistant .msg-bubble {
          width: 100%;
          padding: 2px 0;
          color: var(--text-primary);
        }
        .msg-bubble {
          font-size: 13.5px;
          line-height: 1.6;
          overflow-wrap: anywhere;
        }
        .msg-text {
          white-space: pre-wrap;
        }
        .msg-attachments {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 8px;
        }
        .msg-attachment-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 8px 4px 4px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }
        .msg-attachment-thumb {
          width: 36px;
          height: 36px;
          object-fit: cover;
          border-radius: 4px;
          border: 1px solid var(--border-subtle);
        }
        .msg-attachment-icon {
          color: var(--text-muted);
          margin-left: 4px;
          flex-shrink: 0;
        }
        .msg-attachment-name {
          font-family: var(--font-mono);
          font-size: 11.5px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 220px;
        }

        .stream-caret {
          display: inline-block;
          width: 7px;
          height: 14px;
          margin-left: 2px;
          vertical-align: text-bottom;
          background: var(--text-muted);
          animation: caret-blink 1s steps(2, start) infinite;
        }
        @keyframes caret-blink {
          to { visibility: hidden; }
        }

        /* Live agent activity */
        .agent-live-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          font-size: 12.5px;
          color: var(--text-secondary);
          min-width: 0;
        }
        .agent-live-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent);
          flex-shrink: 0;
          animation: working-pulse 1.6s ease-in-out infinite;
        }
        @keyframes working-pulse {
          50% { opacity: 0.35; }
        }
        .agent-live-desc {
          display: flex;
          align-items: baseline;
          gap: 6px;
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .agent-live-tool {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-primary);
        }
        .agent-live-detail {
          font-family: var(--font-mono);
          font-size: 11.5px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .agent-live-stop-btn {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          flex-shrink: 0;
          padding: 3px 9px;
          font-size: 12px;
          color: var(--text-secondary);
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .agent-live-stop-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        /* Plan */
        .plan-card {
          margin: 6px 0;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          overflow: hidden;
          flex-shrink: 0;
        }
        .plan-header {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          color: var(--text-primary);
        }
        .plan-header:hover {
          background: var(--bg-hover);
        }
        .plan-title {
          font-size: 12.5px;
          font-weight: 600;
        }
        .plan-count {
          font-size: 12px;
          color: var(--text-muted);
        }
        .plan-toggle {
          margin-left: auto;
          color: var(--text-muted);
          transition: transform var(--transition-fast);
        }
        .plan-toggle--open {
          transform: rotate(90deg);
        }
        .plan-tasks {
          display: flex;
          flex-direction: column;
          padding: 2px 12px 10px;
          border-top: 1px solid var(--border-subtle);
        }
        .plan-task {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 4px 0;
          font-size: 12.5px;
          line-height: 1.45;
          color: var(--text-secondary);
        }
        .plan-task--completed .plan-task-title {
          color: var(--text-muted);
          text-decoration: line-through;
          text-decoration-color: var(--border-strong);
        }
        .plan-task--in_progress .plan-task-title {
          color: var(--text-primary);
        }
        .plan-task-mark {
          width: 14px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: var(--text-muted);
        }
        .plan-task--completed .plan-task-mark {
          color: var(--success);
        }
        .plan-task--in_progress .plan-task-mark {
          color: var(--accent);
        }
        .plan-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          border: 1.5px solid var(--border-strong);
        }
        .plan-dot--paused {
          border-color: var(--warning);
          background: var(--warning);
        }
        .plan-spinner {
          animation: plan-spin 0.9s linear infinite;
        }
        @keyframes plan-spin {
          to { transform: rotate(360deg); }
        }
        .plan-task-title {
          flex: 1;
          min-width: 0;
        }
        .plan-task-tag {
          flex-shrink: 0;
          font-size: 11px;
          color: var(--text-muted);
          padding: 0 7px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-full);
        }

        .plan-continue-card {
          margin: 6px 0;
          padding: 12px;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-shrink: 0;
        }
        .plan-continue-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-size: 12px;
        }
        .plan-continue-status {
          font-weight: 600;
          color: var(--text-primary);
        }
        .plan-continue-count {
          color: var(--text-muted);
        }
        .plan-continue-next-row {
          display: flex;
          gap: 6px;
          font-size: 12.5px;
          line-height: 1.45;
        }
        .plan-continue-next-label {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .plan-continue-next-title {
          color: var(--text-primary);
        }
        .plan-continue-btn-row {
          display: flex;
          gap: 6px;
        }
        .plan-continue-btn {
          padding: 5px 12px;
          font-size: 12.5px;
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background var(--transition-fast);
        }
        .plan-continue-btn:hover {
          background: var(--bg-hover);
        }
        .plan-continue-btn--primary {
          background: var(--accent);
          border-color: var(--accent);
          color: #fff;
        }
        .plan-continue-btn--primary:hover {
          background: var(--accent-dim);
        }

        .plan-completed-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          font-size: 12.5px;
          color: var(--success);
        }

        .continue-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin: 6px 0;
          padding: 8px 12px;
          font-size: 12.5px;
          color: var(--text-secondary);
          background: var(--warning-dim);
          border-radius: var(--radius-md);
        }
        .continue-btn {
          padding: 4px 10px;
          font-size: 12px;
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          cursor: pointer;
        }
        .continue-btn:hover {
          background: var(--bg-hover);
        }

        /* ask_user card */
        .ask-question-card {
          margin: 8px 0;
          padding: 14px;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex-shrink: 0;
        }
        .ask-question-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ask-question-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--warning);
          flex-shrink: 0;
        }
        .ask-question-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .ask-question-prompt {
          margin: 0;
          font-size: 13.5px;
          line-height: 1.55;
          color: var(--text-primary);
          white-space: pre-wrap;
        }
        .ask-question-options {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .ask-question-option-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--border-subtle);
          text-align: left;
          font-size: 13px;
          color: var(--text-primary);
          cursor: pointer;
          transition: background var(--transition-fast);
        }
        .ask-question-option-btn:last-child {
          border-bottom: none;
        }
        .ask-question-option-btn:hover {
          background: var(--bg-hover);
        }
        .ask-question-option-btn--selected,
        .ask-question-option-btn--selected:hover {
          background: var(--bg-overlay);
          box-shadow: inset 0 0 0 1px var(--border-strong);
        }
        .ask-question-option-num {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          border: 1px solid var(--border-base);
          border-radius: 4px;
        }
        .ask-question-option-text {
          flex: 1;
          min-width: 0;
          line-height: 1.45;
        }
        .ask-question-input-row {
          display: flex;
          gap: 6px;
        }
        .ask-question-input {
          flex: 1;
          min-width: 0;
          padding: 6px 10px;
          font-family: var(--font-sans);
          font-size: 13px;
          color: var(--text-primary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          outline: none;
        }
        .ask-question-input::placeholder {
          color: var(--text-muted);
        }
        .ask-question-input:focus-visible {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent);
        }
        .ask-question-submit-btn {
          flex-shrink: 0;
          padding: 6px 12px;
          font-size: 12.5px;
          font-weight: 500;
          color: #fff;
          background: var(--accent);
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background var(--transition-fast), opacity var(--transition-fast);
        }
        .ask-question-submit-btn:hover:not(:disabled) {
          background: var(--accent-dim);
        }
        .ask-question-submit-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .ask-question-hint {
          font-size: 11.5px;
          color: var(--text-muted);
        }

        /* Bottom dock */
        .chat-bottom-dock {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 6px 12px 12px;
          background: var(--bg-base);
          z-index: 20;
        }
        .chat-utility-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .mode-toggle-group {
          display: inline-flex;
          gap: 2px;
          padding: 2px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }
        .mode-toggle-btn {
          padding: 2px 10px;
          font-size: 12px;
          color: var(--text-muted);
          background: transparent;
          border: 1px solid transparent;
          border-radius: 4px;
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .mode-toggle-btn:hover {
          color: var(--text-primary);
        }
        .mode-toggle-btn--active {
          color: var(--text-primary);
          background: var(--bg-surface);
          border-color: var(--border-strong);
        }
        .context-badge-pill {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          background: none;
          border: none;
          padding: 2px 6px;
          border-radius: var(--radius-md);
          cursor: pointer;
        }
        .context-badge-pill:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }
        .prompt-chips-track {
          display: flex;
          gap: 4px;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .prompt-chips-track::-webkit-scrollbar {
          display: none;
        }
        .prompt-chip-btn {
          flex-shrink: 0;
          padding: 2px 10px;
          font-size: 12px;
          color: var(--text-secondary);
          background: transparent;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-full);
          cursor: pointer;
          white-space: nowrap;
          transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
        }
        .prompt-chip-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
          border-color: var(--border-base);
        }

        /* Focus */
        .plan-header:focus-visible,
        .plan-continue-btn:focus-visible,
        .continue-btn:focus-visible,
        .agent-live-stop-btn:focus-visible,
        .ask-question-option-btn:focus-visible,
        .ask-question-submit-btn:focus-visible,
        .mode-toggle-btn:focus-visible,
        .context-badge-pill:focus-visible,
        .prompt-chip-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        .ask-question-option-btn:focus-visible {
          outline-offset: -2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .stream-caret { animation: none; }
          .plan-spinner { animation-duration: 2.4s; }
          .agent-live-dot { animation-duration: 3s; }
          .plan-toggle { transition: none; }
        }
      `}</style>
    </div>
  );
}
