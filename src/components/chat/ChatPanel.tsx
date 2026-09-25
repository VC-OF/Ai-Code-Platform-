'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { StatusIndicator, type AgentStatus } from '../StatusIndicator';
import { TimelineEvent } from '../TimelineEvent';
import MessageInput from './MessageInput';
import {
  findSlashCommand,
  formatSlashHelp,
  parseSlashCommand,
} from '@/lib/slashCommands';

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
    hint: 'Inspect active Antigravity & project skills',
    prompt: '/skills',
  },
  {
    label: 'Docker',
    hint: 'Inspect Docker engine and sandbox status',
    prompt: '/docker',
  },
  {
    label: 'Mode',
    hint: 'Switch execution mode: Auto / Manual / Plan',
    prompt: '/mode',
  },
];

interface ChatPanelProps {
  projectId:       string;
  activeFilePath?: string;
  onFilesChanged:  (files: string[]) => void;
  onFileSelect:    (path: string) => void;
  selectedModel?:  string;
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
          } else if (event.type === 'text_done') {
            setStreamingText('');
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

  const send = async (attachments: MessageAttachment[] = []) => {
    let text = input.trim();
    if (!text && attachments.length === 0) return;

    const slash = parseSlashCommand(text);
    if (slash) {
      const command = findSlashCommand(slash.name);
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

      if (command.name === 'help') {
        setTimeline((t) => [
          ...t,
          { type: 'message', role: 'assistant', content: formatSlashHelp(), ts: Date.now() },
        ]);
        return;
      }

      if (command.name === 'clear') {
        setTimeline([]);
        setHistory([]);
        window.dispatchEvent(new CustomEvent('oc-clear-chat'));
        return;
      }

      if (command.name === 'status' || command.name === 'model') {
        const content = command.name === 'status'
          ? `Agent status: ${agentStatus}${loading ? ' (running)' : ''}`
          : `Selected model: ${selectedModel || 'default'}`;
        setTimeline((t) => [
          ...t,
          { type: 'message', role: 'assistant', content, ts: Date.now() },
        ]);
        return;
      }

      if (command.name === 'context') {
        try {
          const res = await fetch(`/api/chat/context?projectId=${encodeURIComponent(projectId)}&model=${encodeURIComponent(selectedModel || '')}`);
          const data = await res.json();
          const tokensFmt = Number(data.currentTokens || 0).toLocaleString();
          const windowFmt = Number(data.windowSize || 2_000_000).toLocaleString();
          const pct = ((data.ratio || 0) * 100).toFixed(2);
          const thresholdFmt = Number(data.compactThreshold || 1_200_000).toLocaleString();

          const content = `📊 **Context Window Metrics (2M Limit Active)**\n` +
            `• **Context Window Limit**: \`${windowFmt} tokens\` (2 Million tokens)\n` +
            `• **Current Context Usage**: \`${tokensFmt} tokens\` (${pct}%)\n` +
            `• **Message Count**: \`${data.messageCount ?? timeline.length} messages\`\n` +
            `• **Compaction Threshold**: \`${thresholdFmt} tokens\` (60%)\n` +
            `• **Status**: ${Number(data.currentTokens) > Number(data.compactThreshold) ? '⚠️ Near auto-compaction threshold' : '🟢 Healthy (plenty of room for deep reasoning)'}\n\n` +
            `💡 *Type \`/compact\` or click the Compact pill to summarize and compress working memory.*`;

          setTimeline((t) => [
            ...t,
            { type: 'message', role: 'assistant', content, ts: Date.now() },
          ]);
        } catch {
          setTimeline((t) => [
            ...t,
            {
              type: 'message',
              role: 'assistant',
              content: `📊 **Context Window**: 2,000,000 tokens limit. Working messages: ${timeline.length}.`,
              ts: Date.now(),
            },
          ]);
        }
        return;
      }

      if (command.name === 'compact') {
        try {
          setTimeline((t) => [
            ...t,
            { type: 'message', role: 'assistant', content: '⏳ Compacting working context into memory brief…', ts: Date.now() },
          ]);
          const res = await fetch('/api/chat/compact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, model: selectedModel }),
          });
          const data = await res.json();
          if (data.compacted) {
            setTimeline((t) => [
              ...t.filter((m) => m.content !== '⏳ Compacting working context into memory brief…'),
              {
                type: 'compaction',
                before: data.before,
                after: data.after,
                ts: Date.now(),
              } as any,
              {
                type: 'message',
                role: 'assistant',
                content: `✨ **Context successfully compacted!**\n• Messages: \`${data.before.messages} → ${data.after.messages}\`\n• Tokens: \`${Number(data.before.tokens).toLocaleString()} → ${Number(data.after.tokens).toLocaleString()} tokens\`\n• Limit: \`${Number(data.windowSize || 2_000_000).toLocaleString()} tokens\` (2M limit)\n${data.summary ? `\n> **Summary Memory:**\n> ${data.summary}` : ''}`,
                ts: Date.now(),
              },
            ]);
            setHistoryReloadKey((k) => k + 1);
            loadContextInfo();
          } else {
            setTimeline((t) => [
              ...t.filter((m) => m.content !== '⏳ Compacting working context into memory brief…'),
              {
                type: 'message',
                role: 'assistant',
                content: `ℹ️ ${data.message || 'Context is already compact and does not need compaction.'}`,
                ts: Date.now(),
              },
            ]);
          }
        } catch (err) {
          setTimeline((t) => [
            ...t.filter((m) => m.content !== '⏳ Compacting working context into memory brief…'),
            {
              type: 'message',
              role: 'assistant',
              content: `❌ Failed to compact context: ${err instanceof Error ? err.message : String(err)}`,
              ts: Date.now(),
            },
          ]);
        }
        return;
      }

      if (command.name === 'skills') {
        try {
          const res = await fetch(`/api/skills?projectId=${encodeURIComponent(projectId)}`);
          const data = await res.json();
          if (data.skills && data.skills.length > 0) {
            const list = data.skills
              .map(
                (s: any) =>
                  `• **\`${s.name}\`**: ${s.description}\n  *(Source: \`${s.source}\`)*`
              )
              .join('\n\n');
            setTimeline((t) => [
              ...t,
              {
                type: 'message',
                role: 'assistant',
                content: `🛠️ **Active Skills (${data.count} available in context):**\n\n${list}\n\n*These skills are automatically injected into the agent loop and applied when matching your coding tasks.*`,
                ts: Date.now(),
              },
            ]);
          } else {
            setTimeline((t) => [
              ...t,
              {
                type: 'message',
                role: 'assistant',
                content: 'ℹ️ No skills currently discovered. Add skills to `.opencode/skills/` or root `skills/`.',
                ts: Date.now(),
              },
            ]);
          }
        } catch (err) {
          setTimeline((t) => [
            ...t,
            {
              type: 'message',
              role: 'assistant',
              content: `❌ Failed to load skills: ${err instanceof Error ? err.message : String(err)}`,
              ts: Date.now(),
            },
          ]);
        }
        return;
      }

      if (command.name === 'docker') {
        try {
          const res = await fetch('/api/docker/status?containers=true&refresh=true');
          const data = await res.json();
          if (data.available) {
            const containerList =
              data.containers && data.containers.length > 0
                ? '\n\n**Active Containers:**\n' +
                  data.containers
                    .slice(0, 5)
                    .map((c: any) => `• \`${c.names || c.id.slice(0, 10)}\` (${c.image}) - *${c.status}*`)
                    .join('\n')
                : '\n\n*No running project containers.*';

            setTimeline((t) => [
              ...t,
              {
                type: 'message',
                role: 'assistant',
                content: `🐳 **Docker Engine Integrated & Active!**\n\n• **Engine Version**: \`${data.version || 'Online'}\` (${data.osType || 'Linux'})\n• **Sandbox Mode**: \`${data.sandboxModeActive ? 'Active (Isolated Containers)' : 'Available'}\`\n• **Default Sandbox Image**: \`${data.defaultImage}\`\n• **Engine Resources**: \`${data.cpus || 12} CPUs, ${data.memoryGiB || 6.4} GiB RAM allocated\`\n• **Containers**: \`${data.containersRunning} running / ${data.containersTotal} total\` (Images: \`${data.imagesCount}\`)${containerList}\n\n💡 *All agent build, test, and shell executions are safely containerized in throwaway Linux sandboxes.*`,
                ts: Date.now(),
              },
            ]);
          } else {
            setTimeline((t) => [
              ...t,
              {
                type: 'message',
                role: 'assistant',
                content: `⚠️ **Docker Daemon Offline:** ${data.error || 'Please ensure Docker Desktop is running.'}\n\n*Agent will use host execution until Docker Desktop is started.*`,
                ts: Date.now(),
              },
            ]);
          }
        } catch (err) {
          setTimeline((t) => [
            ...t,
            {
              type: 'message',
              role: 'assistant',
              content: `❌ Failed to inspect Docker: ${err instanceof Error ? err.message : String(err)}`,
              ts: Date.now(),
            },
          ]);
        }
        return;
      }

      if (command.name === 'mode') {
        const arg = (slash.args || '').toLowerCase().trim();
        let newMode: 'auto' | 'manual' | 'plan' = executionMode;
        if (arg.includes('manual') || arg === 'm') {
          newMode = 'manual';
        } else if (arg.includes('plan') || arg === 'p') {
          newMode = 'plan';
        } else if (arg.includes('auto') || arg === 'a') {
          newMode = 'auto';
        }

        if (arg && newMode !== executionMode) {
          handleModeChange(newMode);
          setTimeline((t) => [
            ...t,
            {
              type: 'message',
              role: 'assistant',
              content: `⚙️ **Execution Mode switched to \`${newMode.toUpperCase()}\`**\n\n${
                newMode === 'manual'
                  ? '🛡️ **Manual (Supervised)**: Agent will request your explicit approval before modifying files, running shell commands, or executing docker containers.'
                  : newMode === 'plan'
                  ? '📋 **Plan-First (Architect)**: Agent will analyze the codebase and construct a structured plan before making file changes.'
                  : '⚡ **Auto (Autonomous)**: Agent will autonomously read, plan, edit, and verify tasks to completion without interruptions.'
              }`,
              ts: Date.now(),
            },
          ]);
        } else {
          setTimeline((t) => [
            ...t,
            {
              type: 'message',
              role: 'assistant',
              content: `⚙️ **Current Execution Mode**: \`${executionMode.toUpperCase()}\`\n\n• \`/mode auto\` — ⚡ **Autonomous**: Full-speed agent loop without interactive pauses.\n• \`/mode manual\` — 🛡️ **Supervised**: Prompts for approval on every file edit and command execution.\n• \`/mode plan\` — 📋 **Architect**: Formulates structured multi-step plan before making edits.\n\n*You can also switch modes anytime using the Mode toggle above the prompt box.*`,
              ts: Date.now(),
            },
          ]);
        }
        return;
      }

      text = command.prompt?.(slash.args) ?? slash.args;
      if (!text.trim()) return;
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
      }),
    });

    await processStream(resPromise);
  };

  return (
    <div className={`chat-panel ${isFullWidth ? 'chat-panel--full' : ''}`}>



      {/* ── CHAT / LLM interaction panel ─────────────────────────────────── */}
      <div className="chat-timeline">
          {timeline.length === 0 && !loading && (
            <div className="chat-empty-state">
              <div className="chat-empty-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={28} height={28}>
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
              </div>
              <p className="chat-empty-title">No messages yet</p>
              <p className="chat-empty-desc">Send a prompt below to start interacting with the agent.</p>

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
                      <div className="msg-attachments" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                        {attachments.map((att, idx) => (
                          <div key={idx} className="msg-attachment-item" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                            {att.type.startsWith('image/') ? (
                              <img src={att.content} alt={att.name} style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-subtle)' }} />
                            ) : (
                              <span style={{ fontSize: '14px' }}>📄</span>
                            )}
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>{att.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <span style={{ whiteSpace: 'pre-wrap' }}>{textContent}</span>
                  </div>
                </div>
              );
            }
            return <TimelineEvent key={i} event={item} />;
          })}

          {/* Live token stream from the current step */}
          {streamingText && (
            <div className="timeline-msg timeline-msg--assistant">
              <div className="msg-bubble">
                <span style={{ whiteSpace: 'pre-wrap' }}>{streamingText}</span>
                <span className="stream-caret" />
              </div>
            </div>
          )}

          {/* Inline answer card for a pending ask_user question */}
          {pendingQuestion && (
            <div className="answer-card">
              <div className="answer-question">{pendingQuestion.question}</div>
              {pendingQuestion.options && pendingQuestion.options.length > 0 && (
                <div className="answer-options">
                  {pendingQuestion.options.map((opt) => (
                    <button
                      key={opt}
                      className="answer-option"
                      onClick={() => answerQuestion(opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              <div className="answer-input-row">
                <input
                  type="text"
                  className="answer-input"
                  placeholder="Type your answer…"
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && answerQuestion(answerText)}
                  autoFocus
                />
                <button
                  className="answer-send"
                  disabled={!answerText.trim()}
                  onClick={() => answerQuestion(answerText)}
                >
                  Answer
                </button>
              </div>
            </div>
          )}

          {/* Live agent status while a turn is running */}
          {loading && (
            <div className="agent-status-row">
              <StatusIndicator status={agentStatus} elapsedSeconds={elapsedSeconds} />
            </div>
          )}
          {/* ── Prominent Live Agent Activity Card (Visible whenever agent is running) ── */}
          {loading && (
            <div className="agent-live-card">
              <div className="agent-live-glow-beam" />
              <div className="agent-live-content">
                <div className="agent-live-logo-box">
                  <span className="agent-live-radar-ring" />
                  <svg viewBox="0 0 24 24" fill="none" width={16} height={16} className="agent-live-bolt">
                    <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" />
                  </svg>
                </div>
                <div className="agent-live-info">
                  <div className="agent-live-row-top">
                    <span className="agent-live-badge">AGENT ACTIVE</span>
                    <span className="agent-live-timer">
                      ⏱ {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
                    </span>
                    <span className="agent-live-status-pill">{agentStatus}</span>
                  </div>
                  <div className="agent-live-desc">
                    {currentToolInfo ? (
                      <span>
                        Executing <strong>{currentToolInfo.name}</strong>
                        {currentToolInfo.detail && <span className="agent-live-detail"> · {currentToolInfo.detail}</span>}
                      </span>
                    ) : (
                      <span>
                        {agentStatus === 'planning' ? 'Analyzing requirements and planning next action…'
                          : agentStatus === 'writing' ? 'Writing code modifications to workspace…'
                          : agentStatus === 'reading' ? 'Reading project workspace files…'
                          : agentStatus === 'linting' ? 'Verifying code syntax & running linter…'
                          : agentStatus === 'testing' ? 'Executing automated tests…'
                          : agentStatus === 'compacting' ? 'Compacting conversation context…'
                          : agentStatus === 'waiting' ? 'Waiting for your response…'
                          : 'Synthesizing response and executing steps…'}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="agent-live-stop-btn"
                  onClick={cancelRun}
                  title="Stop agent turn (Esc)"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width={10} height={10}>
                    <rect x="5" y="5" width="14" height="14" rx="2" />
                  </svg>
                  Stop
                </button>
              </div>
            </div>
          )}

          {/* ── Agent plan (persists across turns, scrolls with the feed) ── */}
          {plan.length > 0 && (
            <div className="plan-card">
              <button
                className="plan-header"
                onClick={() => setPlanCollapsed((c) => !c)}
              >
                <span className="plan-title">
                  Plan · {plan.filter((t) => t.status === 'completed').length}/{plan.length} done
                </span>
                <span className="plan-toggle">{planCollapsed ? '▸' : '▾'}</span>
              </button>
              {!planCollapsed && (
                <div className="plan-tasks">
                  {plan.map((t) => (
                    <div key={t.id} className={`plan-task plan-task--${t.status}`}>
                      <span className="plan-task-mark">
                        {t.status === 'completed' ? (
                          <span className="plan-check">✓</span>
                        ) : t.status === 'in_progress' ? (
                          loading ? (
                            <svg className="plan-spinner" viewBox="0 0 16 16" fill="none" width={12} height={12}>
                              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
                              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <span className="plan-paused-dot">●</span>
                          )
                        ) : (
                          <span className="plan-pending-circle">○</span>
                        )}
                      </span>
                      <span className="plan-task-title">{t.title}</span>
                      {t.status === 'in_progress' && (
                        <span className={`plan-task-tag ${loading ? 'plan-task-tag--running' : 'plan-task-tag--paused'}`}>
                          {loading ? 'RUNNING' : 'PAUSED'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Plan Continuation Card (When paused/stopped with uncompleted tasks) ── */}
          {!loading && plan.length > 0 && plan.some((t) => t.status !== 'completed') && (
            <div className="plan-continue-card">
              <div className="plan-continue-top">
                <div className="plan-continue-badge-wrap">
                  <span className="plan-continue-paused-dot" />
                  <span className="plan-continue-badge-text">
                    {lastDoneReason === 'max_steps' || lastDoneReason === 'timeout'
                      ? 'TURN LIMIT REACHED'
                      : 'PAUSED · READY FOR NEXT STEP'}
                  </span>
                </div>
                <span className="plan-continue-count">
                  {plan.filter((t) => t.status === 'completed').length}/{plan.length} TASKS DONE
                </span>
              </div>

              {(() => {
                const nextTask = plan.find((t) => t.status === 'in_progress') || plan.find((t) => t.status === 'pending');
                return nextTask ? (
                  <div className="plan-continue-next-row">
                    <span className="plan-continue-next-label">Next Task:</span>
                    <span className="plan-continue-next-title">{nextTask.title}</span>
                  </div>
                ) : null;
              })()}

              <div className="plan-continue-btn-row">
                <button
                  type="button"
                  className="plan-continue-btn plan-continue-btn--primary"
                  onClick={() => {
                    setLastDoneReason(null);
                    const nextTask = plan.find((t) => t.status === 'in_progress') || plan.find((t) => t.status === 'pending');
                    const nextInstruction = nextTask
                      ? `Continue executing the plan. Next task is: "${nextTask.title}". Please proceed with implementing and verifying.`
                      : 'Continue working through the remaining tasks in the plan until complete.';
                    executePrompt(nextInstruction, history);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width={12} height={12}>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Continue Next Task
                </button>
                <button
                  type="button"
                  className="plan-continue-btn plan-continue-btn--ghost"
                  onClick={() => {
                    const nextTask = plan.find((t) => t.status === 'in_progress') || plan.find((t) => t.status === 'pending');
                    setInput(nextTask ? `Regarding task "${nextTask.title}": ` : 'Continue: ');
                    (document.querySelector('.input-textarea') as HTMLTextAreaElement)?.focus();
                  }}
                >
                  Custom Instructions…
                </button>
              </div>
            </div>
          )}

          {/* ── Plan Completed Celebration Banner ── */}
          {!loading && plan.length > 0 && plan.every((t) => t.status === 'completed') && (
            <div className="plan-completed-banner">
              <span className="plan-completed-check">✓</span>
              <span className="plan-completed-text">All {plan.length} plan tasks completed successfully!</span>
            </div>
          )}

          {/* ── Continue banner after an interrupted turn (fallback when no plan) ── */}
          {!loading && plan.length === 0 && (lastDoneReason === 'max_steps' || lastDoneReason === 'timeout') && (
            <div className="continue-banner">
              <span>
                The turn hit its {lastDoneReason === 'timeout' ? 'time' : 'step'} limit.
              </span>
              <button
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

          <div ref={endRef} />
      </div>

      {/* ── Allocated Bottom Place for controls & prompt input ── */}
      <div className="chat-bottom-dock">
        {/* Tier 1 & 2: Mode Toggle, Context Pill, and Horizontal Quick Chips */}
        <div className="chat-controls-container">
          {/* Tier 1: Execution Mode & Context Counter */}
          <div className="chat-utility-bar">
            <div className="mode-toggle-group">
              <button
                type="button"
                className={`mode-toggle-btn ${executionMode === 'auto' ? 'mode-toggle-btn--active' : ''}`}
                title="Auto Mode: Autonomous execution without pauses"
                onClick={() => handleModeChange('auto')}
              >
                ⚡ Auto
              </button>
              <button
                type="button"
                className={`mode-toggle-btn ${executionMode === 'manual' ? 'mode-toggle-btn--active' : ''}`}
                title="Manual Mode: Requires human approval before running file edits and shell/docker commands"
                onClick={() => handleModeChange('manual')}
              >
                🛡️ Manual
              </button>
              <button
                type="button"
                className={`mode-toggle-btn ${executionMode === 'plan' ? 'mode-toggle-btn--active' : ''}`}
                title="Plan First Mode: Agent formulates architectural plan before editing"
                onClick={() => handleModeChange('plan')}
              >
                📋 Plan
              </button>
            </div>

            <div
              className="context-badge-pill"
              title={`Context Usage: ${contextInfo.tokens.toLocaleString()} / 2,000,000 tokens (${((contextInfo.tokens / (contextInfo.limit || 2_000_000)) * 100).toFixed(2)}%). 2M token limit active.`}
              onClick={() => executePrompt('/context', history)}
            >
              <span className="context-indicator-dot" />
              <span className="context-badge-text">
                {contextInfo.tokens >= 1000 ? `${(contextInfo.tokens / 1000).toFixed(1)}k` : contextInfo.tokens} / 2.0M tokens
              </span>
            </div>
          </div>

          {/* Tier 2: Single-Row Horizontal Action Chips */}
          <div className="prompt-chips-track">
            {PROMPT_TEMPLATES.map((tpl) => (
              <button
                key={tpl.label}
                className="prompt-chip-btn"
                title={tpl.hint}
                onClick={() => {
                  if (tpl.prompt.startsWith('/')) {
                    executePrompt(tpl.prompt, history);
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
        </div>

        {/* ── Message Input (Bottom prompt widget) ────────────────────────── */}
        <MessageInput
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
          gap: 0;
          overflow: hidden;
          position: relative;
        }

        .chat-panel--full {
          max-width: 920px;
          margin: 0 auto;
          width: 100%;
        }

        /* ── Only allocate bottom place for controls & input ── */
        .chat-bottom-dock {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 8px 4px 2px;
          background: var(--bg-base);
          border-top: 1px solid var(--border-subtle);
          z-index: 20;
        }

        .chat-panel--full .plan-continue-btn-row {
          max-width: 560px;
        }

        .chat-panel--full .plan-card {
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
        }

        /* ── View toggle bar ── */
        .view-toggle-bar {
          display: flex;
          gap: 2px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 3px;
          flex-shrink: 0;
        }
        .view-tab {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 500;
          color: var(--text-muted);
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: all var(--transition-fast);
          position: relative;
        }
        .view-tab:hover {
          color: var(--text-secondary);
          background: var(--bg-hover);
        }
        .view-tab--active {
          background: var(--bg-hover) !important;
          color: var(--text-primary) !important;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }
        .view-tab-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--brand);
          color: #fff;
          font-size: 8.5px;
          font-weight: 700;
          margin-left: 2px;
        }

        /* ── Overview panel ── */
        .overview-panel {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding-right: 2px;
        }

        /* ── Chat empty state ── */
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
        .chat-empty-icon {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          margin-bottom: 6px;
        }
        .chat-empty-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-primary);
          font-family: var(--font-brand);
        }
        .chat-empty-desc {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.5;
          max-width: 220px;
        }
        .chat-empty-cta {
          margin-top: 8px;
          font-size: 11px;
          color: var(--brand);
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          transition: background var(--transition-fast);
        }
        .chat-empty-cta:hover {
          background: rgba(0, 122, 255, 0.08);
        }

        /* Top Agent Status Widget */
        .agent-status-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          flex-shrink: 0;
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .project-avatar {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: var(--brand);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .project-info {
          display: flex;
          flex-direction: column;
          flex: 1;
        }

        .project-title {
          font-family: var(--font-brand);
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.2;
        }

        .project-subtitle {
          font-size: 10px;
          color: var(--text-muted);
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          font-weight: 500;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          padding: 3px 8px;
          border-radius: 20px;
          color: var(--text-secondary);
        }

        .status-badge-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--text-muted);
        }

        .status-label {
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          font-weight: 600;
          margin-bottom: 6px;
        }

        .ready-title {
          font-family: var(--font-brand);
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .ready-desc {
          font-size: 11px;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .card-footer {
          display: flex;
          align-items: center;
          gap: 8px;
          border-top: 1px solid var(--border-subtle);
          padding-top: 12px;
        }

        .badge-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10.5px;
          color: var(--text-secondary);
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 4px 8px;
        }

        .badge-icon {
          font-size: 10px;
        }

        /* Complete scrollable timeline area from top to bottom */
        .chat-timeline {
          flex: 1 1 0px;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 8px 10px 16px 4px;
          scroll-behavior: smooth;
        }

        .chat-timeline::-webkit-scrollbar {
          width: 6px;
        }
        .chat-timeline::-webkit-scrollbar-track {
          background: transparent;
        }
        .chat-timeline::-webkit-scrollbar-thumb {
          background: var(--border-subtle);
          border-radius: 4px;
        }
        .chat-timeline::-webkit-scrollbar-thumb:hover {
          background: var(--border-strong);
        }

        .timeline-msg {
          display: flex;
          width: 100%;
        }

        .timeline-msg--user {
          justify-content: flex-end;
        }

        .timeline-msg--assistant {
          justify-content: flex-start;
        }

        .msg-bubble {
          max-width: 85%;
          padding: 8px 12px;
          border-radius: var(--radius-md);
          font-size: 12px;
          line-height: 1.5;
          word-break: break-word;
        }

        .timeline-msg--user .msg-bubble {
          background: var(--brand);
          color: white;
          border-bottom-right-radius: 2px;
        }

        .timeline-msg--assistant .msg-bubble {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          border-bottom-left-radius: 2px;
          white-space: pre-wrap;
        }

        .stream-caret {
          display: inline-block;
          width: 6px;
          height: 12px;
          margin-left: 3px;
          vertical-align: text-bottom;
          background: var(--text-secondary);
          animation: caret-blink 1s steps(2) infinite;
        }

        @keyframes caret-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }

        .agent-status-row {
          display: flex;
          justify-content: flex-start;
          padding: 4px 0;
        }

        /* ── Plan card ── */
        .plan-card {
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          flex-shrink: 0;
          overflow: hidden;
        }

        .plan-header {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-primary);
        }

        .plan-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-secondary);
        }

        .plan-toggle { color: var(--text-muted); font-size: 11px; }

        .plan-tasks {
          padding: 2px 12px 8px;
          display: flex;
          flex-direction: column;
          gap: 3px;
          max-height: 125px;
          overflow-y: auto;
        }

        .plan-task {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          line-height: 1.4;
          padding: 4px 6px;
          border-radius: var(--radius-sm);
          transition: background var(--transition-fast);
        }

        .plan-task-mark {
          flex-shrink: 0;
          width: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .plan-check { color: var(--success); font-weight: bold; }
        .plan-paused-dot { color: var(--warning, #f59e0b); font-size: 13px; }
        .plan-pending-circle { color: var(--text-disabled); font-size: 12px; }

        .plan-spinner {
          animation: spin 0.85s linear infinite;
          color: var(--brand);
          flex-shrink: 0;
        }

        .plan-task-title {
          flex: 1;
        }

        .plan-task--completed .plan-task-title {
          color: var(--text-muted);
          text-decoration: line-through;
        }

        .plan-task--in_progress {
          background: rgba(255, 107, 0, 0.05);
          border: 1px solid rgba(255, 107, 0, 0.15);
        }

        .plan-task--in_progress .plan-task-title {
          color: var(--text-primary);
          font-weight: 600;
        }

        .plan-task--pending .plan-task-title {
          color: var(--text-secondary);
        }

        .plan-task-tag {
          font-size: 8.5px;
          font-weight: 700;
          letter-spacing: 0.06em;
          padding: 1px 6px;
          border-radius: 10px;
          flex-shrink: 0;
          text-transform: uppercase;
        }

        .plan-task-tag--running {
          background: var(--brand);
          color: #fff;
          box-shadow: 0 0 6px rgba(255, 107, 0, 0.4);
          animation: pulse-soft 1.2s infinite;
        }

        .plan-task-tag--paused {
          background: rgba(245, 158, 11, 0.18);
          color: var(--warning, #f59e0b);
          border: 1px solid rgba(245, 158, 11, 0.3);
        }

        /* ── Live Agent Activity Card ── */
        .agent-live-card {
          position: relative;
          background: var(--bg-surface);
          border: 1px solid var(--accent-border, rgba(255, 107, 0, 0.4));
          border-radius: var(--radius-md);
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12), 0 0 15px rgba(255, 107, 0, 0.12);
          flex-shrink: 0;
        }

        .agent-live-glow-beam {
          height: 2px;
          width: 100%;
          background: linear-gradient(90deg, transparent, var(--brand), #ff9800, transparent);
          background-size: 200% 100%;
          animation: live-beam-scan 2s linear infinite;
        }

        @keyframes live-beam-scan {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }

        .agent-live-content {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
        }

        .agent-live-logo-box {
          position: relative;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: var(--brand);
          color: #000;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 12px rgba(255, 107, 0, 0.4);
          flex-shrink: 0;
        }

        .agent-live-radar-ring {
          position: absolute;
          inset: -4px;
          border-radius: 12px;
          border: 1.5px solid var(--brand);
          opacity: 0;
          animation: radar-wave 1.8s cubic-bezier(0, 0.2, 0.8, 1) infinite;
        }

        @keyframes radar-wave {
          0% { transform: scale(0.9); opacity: 0.8; }
          100% { transform: scale(1.4); opacity: 0; }
        }

        .agent-live-bolt {
          animation: bolt-pulse 1.2s ease-in-out infinite alternate;
        }

        @keyframes bolt-pulse {
          0% { transform: scale(0.95); opacity: 0.9; }
          100% { transform: scale(1.1); opacity: 1; }
        }

        .agent-live-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }

        .agent-live-row-top {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .agent-live-title {
          font-family: var(--font-brand);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: var(--brand);
        }

        .agent-live-timer {
          font-family: var(--font-mono);
          font-size: 10.5px;
          font-weight: 600;
          color: var(--text-primary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          padding: 1px 6px;
          border-radius: 4px;
        }

        .agent-live-status-pill {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-secondary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          padding: 1px 6px;
          border-radius: 10px;
        }

        .agent-live-desc {
          font-size: 11.5px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .agent-live-tool-name {
          color: var(--brand);
          font-family: var(--font-mono);
        }

        .agent-live-detail {
          color: var(--text-muted);
          font-family: var(--font-mono);
          font-size: 10.5px;
        }

        .agent-live-stop-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          background: rgba(255, 69, 58, 0.12);
          color: var(--error, #ef4444);
          border: 1px solid rgba(255, 69, 58, 0.35);
          border-radius: var(--radius-sm);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
          flex-shrink: 0;
        }

        .agent-live-stop-btn:hover {
          background: var(--error, #ef4444);
          color: #fff;
          box-shadow: 0 0 10px rgba(255, 69, 58, 0.4);
        }

        /* ── Plan Continuation Card ── */
        .plan-continue-card {
          background: var(--bg-surface);
          border: 1px solid var(--accent-border, rgba(255, 107, 0, 0.35));
          border-radius: var(--radius-md);
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex-shrink: 0;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
        }

        .plan-continue-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .plan-continue-badge-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .plan-continue-paused-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--warning, #d97706);
          box-shadow: 0 0 6px var(--warning, #d97706);
        }

        .plan-continue-badge-text {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: var(--warning, #d97706);
        }

        .plan-continue-count {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-secondary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          padding: 2px 8px;
          border-radius: 10px;
        }

        .plan-continue-next-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-primary);
          background: var(--bg-elevated);
          padding: 7px 10px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-base);
        }

        .plan-continue-next-label {
          color: var(--brand);
          font-size: 10px;
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.05em;
          flex-shrink: 0;
        }

        .plan-continue-next-title {
          color: var(--text-primary);
          font-weight: 600;
        }

        .plan-continue-btn-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .plan-continue-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          border-radius: var(--radius-sm);
          padding: 7px 14px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .plan-continue-btn--primary {
          background: var(--brand);
          color: #fff;
          border: none;
          box-shadow: 0 0 12px rgba(255, 107, 0, 0.3);
          flex: 1.2;
        }

        .plan-continue-btn--primary:hover {
          filter: brightness(1.15);
          box-shadow: 0 0 18px rgba(255, 107, 0, 0.5);
        }

        .plan-continue-btn--ghost {
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-secondary);
          border: 1px solid var(--border-base);
          flex: 1;
        }

        .plan-continue-btn--ghost:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .plan-completed-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: rgba(48, 209, 88, 0.08);
          border: 1px solid rgba(48, 209, 88, 0.3);
          border-radius: var(--radius-md);
          color: var(--success);
          font-size: 12px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .plan-completed-check {
          font-size: 14px;
          font-weight: bold;
        }

        /* ── Continue banner ── */
        .continue-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 12px;
          background: rgba(0, 122, 255, 0.06);
          border: 1px solid rgba(0, 122, 255, 0.25);
          border-radius: var(--radius-md);
          font-size: 11.5px;
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        .continue-btn {
          padding: 5px 14px;
          background: var(--brand);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          flex-shrink: 0;
        }

        .continue-btn:hover { filter: brightness(1.1); }

        /* ── ask_user answer card ── */
        .answer-card {
          background: rgba(255, 159, 10, 0.05);
          border: 1px solid rgba(255, 159, 10, 0.3);
          border-radius: var(--radius-md);
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .answer-question {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.5;
        }

        .answer-options {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .answer-option {
          padding: 6px 12px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-full);
          color: var(--text-primary);
          font-size: 11.5px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .answer-option:hover {
          background: rgba(255, 159, 10, 0.12);
          border-color: rgba(255, 159, 10, 0.5);
        }

        .answer-input-row {
          display: flex;
          gap: 6px;
        }

        .answer-input {
          flex: 1;
          background: rgba(0,0,0,0.2);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          padding: 7px 10px;
          font-size: 12px;
          color: var(--text-primary);
          outline: none;
        }

        .answer-send {
          padding: 7px 14px;
          background: #ffffff;
          color: #000000;
          border: none;
          border-radius: var(--radius-md);
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .answer-send:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* Status badge variants */
        .status-badge--idle .status-badge-dot   { background: var(--text-muted); }
        .status-badge--active .status-badge-dot { background: var(--success); animation: pulse-soft 1.5s infinite; box-shadow: 0 0 6px var(--success); }
        .status-badge--error .status-badge-dot  { background: var(--error); }
        .status-badge--active { border-color: var(--success-border, rgba(48,209,88,0.3)) !important; color: var(--success) !important; }
        .status-badge--error  { border-color: var(--error-dim, rgba(255,69,58,0.2)) !important; color: var(--error) !important; }

        /* Telemetry strip */
        .telem-strip {
          display: flex;
          align-items: center;
          gap: 0;
          background: rgba(0,0,0,0.18);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          overflow: hidden;
          flex-shrink: 0;
        }
        .telem-item {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 7px 6px;
        }
        .telem-lbl {
          font-size: 7.5px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          font-weight: 700;
          margin-bottom: 2px;
        }
        .telem-val {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-primary);
          font-family: var(--font-mono);
        }
        .telem-sep {
          width: 1px;
          height: 28px;
          background: var(--border-subtle);
          flex-shrink: 0;
        }

        /* Quick actions */
        .qa-lbl {
          font-size: 8.5px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          font-weight: 700;
          padding: 0 2px;
        }
        .qa-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .qa-card {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 10px 12px;
          background: rgba(255,255,255,0.025);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all var(--transition-fast);
          text-align: left;
          position: relative;
          overflow: hidden;
        }
        .qa-card::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--brand), transparent);
          opacity: 0;
          transition: opacity 0.25s;
        }
        .qa-card:hover { background: rgba(255,255,255,0.045); border-color: var(--border-base); transform: translateY(-1px); }
        .qa-card:hover::after { opacity: 0.5; }
        .qa-icon  { font-size: 17px; margin-bottom: 5px; }
        .qa-title { font-size: 11.5px; font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
        .qa-desc  { font-size: 10px; color: var(--text-muted); }

        /* Slash reference table */
        .slash-tbl {
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .slash-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 7px 12px;
          border-bottom: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: background var(--transition-fast);
          width: 100%;
          text-align: left;
          background: none;
          border-left: none;
          border-right: none;
          border-top: none;
        }
        .slash-row:last-child { border-bottom: none; }
        .slash-row:hover { background: rgba(255,255,255,0.035); }
        .slash-cmd  { font-family: var(--font-mono); font-size: 11px; color: var(--brand); min-width: 90px; }
        .slash-desc { font-size: 11px; color: var(--text-muted); }

        /* ── Chat Controls: Tier 1 Utility Bar + Tier 2 Horizontal Chips ── */
        .chat-controls-container {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex-shrink: 0;
          width: 100%;
        }

        .chat-utility-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          width: 100%;
          min-height: 28px;
        }

        /* Execution Mode Switcher */
        .mode-toggle-group {
          display: inline-flex;
          align-items: center;
          background: rgba(255, 255, 255, 0.035);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-full);
          padding: 2px;
          gap: 2px;
          flex-shrink: 0;
        }
        .mode-toggle-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 10px;
          font-weight: 500;
          padding: 2.5px 7px;
          border-radius: var(--radius-full);
          cursor: pointer;
          transition: all var(--transition-fast);
          display: inline-flex;
          align-items: center;
          gap: 3px;
          user-select: none;
          white-space: nowrap;
        }
        .mode-toggle-btn:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.05);
        }
        .mode-toggle-btn--active {
          background: rgba(255, 107, 0, 0.16);
          color: #ff9d42;
          font-weight: 600;
          box-shadow: 0 0 8px rgba(255, 107, 0, 0.2);
        }

        .context-badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 9px;
          background: rgba(0, 229, 255, 0.05);
          border: 1px solid rgba(0, 229, 255, 0.2);
          border-radius: var(--radius-full);
          font-size: 9.5px;
          font-family: var(--font-mono);
          color: #00e5ff;
          cursor: pointer;
          transition: all var(--transition-fast);
          user-select: none;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .context-badge-pill:hover {
          background: rgba(0, 229, 255, 0.12);
          border-color: rgba(0, 229, 255, 0.4);
          box-shadow: 0 0 10px rgba(0, 229, 255, 0.15);
        }
        .context-indicator-dot {
          width: 5.5px;
          height: 5.5px;
          border-radius: 50%;
          background: #00e5ff;
          box-shadow: 0 0 6px #00e5ff;
          display: inline-block;
        }
        .context-badge-text {
          white-space: nowrap;
          letter-spacing: 0.02em;
        }

        /* Tier 2: Horizontal Prompt Action Chips */
        .prompt-chips-track {
          display: flex;
          align-items: center;
          gap: 5px;
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
          padding: 2px 2px;
          width: 100%;
          mask-image: linear-gradient(to right, transparent, black 6px, black calc(100% - 6px), transparent);
          -webkit-mask-image: linear-gradient(to right, transparent, black 6px, black calc(100% - 6px), transparent);
        }
        .prompt-chips-track::-webkit-scrollbar {
          display: none;
        }

        .prompt-chip-btn {
          padding: 3.5px 9px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-full);
          font-size: 10.5px;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: var(--font-mono);
          transition: all var(--transition-fast);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .prompt-chip-btn:hover {
          background: rgba(255, 255, 255, 0.07);
          border-color: var(--border-base);
          color: var(--text-primary);
        }
      `}</style>

    </div>
  );
}
