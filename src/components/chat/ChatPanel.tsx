'use client';

import { useEffect, useRef, useState } from 'react';
import { StatusIndicator, type AgentStatus } from '../StatusIndicator';
import { TimelineEvent } from '../TimelineEvent';
import MessageInput from './MessageInput';

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
}

export default function ChatPanel({
  projectId,
  activeFilePath,
  onFilesChanged,
  onFileSelect,
  selectedModel,
  onStatusChange,
  onAgentDone,
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

  useEffect(() => {
    if (!projectId || projectId === 'default') {
      setHistory([]);
      setTimeline([]);
      updateStatus('done');
      return;
    }

    setLoading(true);
    fetch(`/api/projects?id=${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.project?.chatHistory) {
          const loadedHistory = (data.project.chatHistory as Message[]).filter(
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
        }
      })
      .catch((err) => {
        console.error('Error loading project status/history:', err);
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, historyReloadKey]);

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
    const text = input.trim();
    if (!text && attachments.length === 0) return;

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
      }),
    });

    await processStream(resPromise);
  };

  return (
    <div className="chat-panel">



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
              <StatusIndicator status={agentStatus} />
            </div>
          )}
          <div ref={endRef} />
      </div>

      {/* ── Agent plan (persists across turns) ───────────────────────────── */}
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
                    {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '●' : '○'}
                  </span>
                  <span className="plan-task-title">{t.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Continue banner after an interrupted turn ────────────────────── */}
      {!loading && (lastDoneReason === 'max_steps' || lastDoneReason === 'timeout') && (
        <div className="continue-banner">
          <span>
            The turn hit its {lastDoneReason === 'timeout' ? 'time' : 'step'} limit —
            the plan is saved.
          </span>
          <button
            className="continue-btn"
            onClick={() => {
              setLastDoneReason(null);
              setInput('Continue working through the plan from where you left off.');
              (document.querySelector('.input-textarea') as HTMLTextAreaElement)?.focus();
            }}
          >
            Continue
          </button>
        </div>
      )}

      {/* ── Prompt template pills (above input) ──────────────────────────── */}
      <div className="slash-pills">
        {PROMPT_TEMPLATES.map((tpl) => (
          <button
            key={tpl.label}
            className="slash-pill"
            title={tpl.hint}
            onClick={() => {
              setInput(tpl.prompt);
              (document.querySelector('.input-textarea') as HTMLTextAreaElement)?.focus();
            }}
          >
            {tpl.label}
          </button>
        ))}
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

      <style jsx>{`
        .chat-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          gap: 12px;
          overflow: hidden;
        }

        /* ── View toggle bar ── */
        .view-toggle-bar {
          display: flex;
          gap: 2px;
          background: rgba(0,0,0,0.2);
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
          background: rgba(255,255,255,0.03);
        }
        .view-tab--active {
          background: rgba(255,255,255,0.06) !important;
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
          background: rgba(18, 18, 23, 0.45);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 16px;
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

        /* Scrollable Timeline area */
        .chat-timeline {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding-right: 4px;
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
          padding: 2px 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-height: 160px;
          overflow-y: auto;
        }

        .plan-task {
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 12px;
          line-height: 1.4;
        }

        .plan-task-mark { flex-shrink: 0; width: 12px; }
        .plan-task--completed .plan-task-mark { color: var(--success); }
        .plan-task--completed .plan-task-title {
          color: var(--text-muted);
          text-decoration: line-through;
        }
        .plan-task--in_progress .plan-task-mark { color: var(--brand); }
        .plan-task--in_progress .plan-task-title { color: var(--text-primary); font-weight: 500; }
        .plan-task--pending .plan-task-mark { color: var(--text-disabled); }
        .plan-task--pending .plan-task-title { color: var(--text-secondary); }

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

        /* Slash pills row */
        .slash-pills {
          display: flex;
          gap: 5px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .slash-pill {
          padding: 4px 10px;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-full);
          font-size: 10.5px;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: var(--font-mono);
          transition: all var(--transition-fast);
        }
        .slash-pill:hover {
          background: rgba(255,255,255,0.06);
          border-color: var(--border-base);
          color: var(--text-primary);
        }
      `}</style>

    </div>
  );
}
