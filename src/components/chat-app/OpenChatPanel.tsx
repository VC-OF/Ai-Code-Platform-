'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { DbConversation, DbConversationMessage, ExtractedArtifact } from '@/lib/db';
import { getDefaultModel } from '@/lib/models';
import ChatTimeline from './ChatTimeline';
import ChatComposer from './ChatComposer';
import ArtifactsCanvas from './ArtifactsCanvas';

interface OpenChatPanelProps {
  projectId?: string;
  onFileInsert?: (content: string) => void;
  onClose?: () => void;
  onExpandToFullChat?: () => void;
}

export default function OpenChatPanel({
  onClose,
  onExpandToFullChat,
}: OpenChatPanelProps) {
  const [conversations, setConversations] = useState<DbConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<
    (DbConversation & { messages: DbConversationMessage[] }) | null
  >(null);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('opencode_selected_model') || getDefaultModel();
    }
    return getDefaultModel();
  });

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState<ExtractedArtifact | null>(null);
  const [showArtifactDrawer, setShowArtifactDrawer] = useState(false);
  const [showThreadPicker, setShowThreadPicker] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isSendingRef = useRef(false);

  // Load conversations list
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) {
        const data = await res.json();
        const convos: DbConversation[] = data.conversations || [];
        setConversations(convos);
        if (convos.length > 0 && !activeConversationId) {
          setActiveConversationId(convos[0].id);
        }
      }
    } catch {}
  }, [activeConversationId]);

  // Load active conversation
  const loadConversation = useCallback(async (id: string) => {
    if (isSendingRef.current) return;
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        const convo = data.conversation;
        if (isSendingRef.current) return;
        setActiveConversation(convo);
        if (convo.model) setSelectedModel(convo.model);

        // Find last artifact if present
        for (let i = convo.messages.length - 1; i >= 0; i--) {
          const m = convo.messages[i];
          if (m.artifacts && m.artifacts.length > 0) {
            setSelectedArtifact(m.artifacts[m.artifacts.length - 1]);
            break;
          }
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (activeConversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadConversation(activeConversationId);
    }
  }, [activeConversationId, loadConversation]);

  // New Chat
  const handleNewChat = async () => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New Chat',
          model: selectedModel,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const newConvo = data.conversation;
        setConversations((prev) => [newConvo, ...prev]);
        setActiveConversationId(newConvo.id);
        setSelectedArtifact(null);
        setShowArtifactDrawer(false);
        setShowThreadPicker(false);
      }
    } catch {}
  };

  // Send message with streaming
  const handleSendMessage = async (prompt: string) => {
    isSendingRef.current = true;
    let convoId = activeConversationId;
    if (!convoId) {
      try {
        const createRes = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: prompt.slice(0, 32) + (prompt.length > 32 ? '…' : ''),
            model: selectedModel,
          }),
        });
        if (!createRes.ok) {
          isSendingRef.current = false;
          return;
        }
        const createData = await createRes.json();
        convoId = createData.conversation.id;
        setActiveConversationId(convoId);
        setConversations((prev) => [createData.conversation, ...prev]);
        setActiveConversation({
          ...createData.conversation,
          messages: [],
        });
      } catch {
        isSendingRef.current = false;
        return;
      }
    }

    const tempUserMsg: DbConversationMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: convoId!,
      role: 'user',
      content: prompt,
      created_at: Date.now(),
    };

    setActiveConversation((prev) => {
      if (!prev) {
        return {
          id: convoId!,
          title: prompt.slice(0, 32) + (prompt.length > 32 ? '…' : ''),
          model: selectedModel,
          pinned: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
          messages: [tempUserMsg],
        };
      }
      return {
        ...prev,
        messages: [...(prev.messages || []), tempUserMsg],
      };
    });

    setIsStreaming(true);
    setStreamingThinking('');
    setStreamingText('');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let accumulatedThinking = '';
    let accumulatedText = '';
    let hasCompleted = false;

    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(convoId!)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: prompt, model: selectedModel }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('HTTP error');

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'message';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = 'message';
            continue;
          }
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            try {
              const data = JSON.parse(dataStr);
              if (currentEvent === 'thinking') {
                accumulatedThinking += data.delta || '';
                setStreamingThinking(accumulatedThinking);
              } else if (currentEvent === 'text') {
                accumulatedText += data.delta || '';
                setStreamingText(accumulatedText);
              } else if (currentEvent === 'artifacts') {
                if (data.artifacts && data.artifacts.length > 0) {
                  setSelectedArtifact(data.artifacts[0]);
                  setShowArtifactDrawer(true);
                }
              } else if (currentEvent === 'error') {
                accumulatedText += `\n\n> ⚠️ **Error**: ${data.error || 'Failed to complete response'}`;
                setStreamingText(accumulatedText);
              } else if (currentEvent === 'done') {
                hasCompleted = true;
                const assistantMsg: DbConversationMessage = {
                  id: data.id || `msg-${Date.now()}`,
                  conversation_id: convoId!,
                  role: 'assistant',
                  content: data.content || accumulatedText,
                  thinking: data.thinking || accumulatedThinking || null,
                  thinking_ms: data.thinking_ms || null,
                  artifacts: data.artifacts ? JSON.stringify(data.artifacts) : null,
                  model: selectedModel,
                  created_at: Date.now(),
                };

                setActiveConversation((prev) => {
                  if (!prev) return null;
                  return {
                    ...prev,
                    messages: [...prev.messages, assistantMsg],
                  };
                });

                if (data.artifacts && data.artifacts.length > 0) {
                  setSelectedArtifact(data.artifacts[0]);
                  setShowArtifactDrawer(true);
                }
              }
            } catch (err) {
              console.error('Error parsing data chunk:', err);
            }
          }
        }
      }

      if (!hasCompleted && (accumulatedText || accumulatedThinking)) {
        const fallbackMsg: DbConversationMessage = {
          id: `msg-${Date.now()}`,
          conversation_id: convoId!,
          role: 'assistant',
          content: accumulatedText || 'Response completed.',
          thinking: accumulatedThinking || null,
          thinking_ms: null,
          artifacts: null,
          model: selectedModel,
          created_at: Date.now(),
        };
        setActiveConversation((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            messages: [...prev.messages, fallbackMsg],
          };
        });
      }
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (!isAbort) {
        console.error('Error streaming:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        const errorMsg: DbConversationMessage = {
          id: `err-${Date.now()}`,
          conversation_id: convoId!,
          role: 'assistant',
          content: `> ⚠️ **Error communicating with AI service**: ${errMsg}\n\nPlease verify your API key or model settings.`,
          created_at: Date.now(),
        };
        setActiveConversation((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            messages: [...prev.messages, errorMsg],
          };
        });
      }
    } finally {
      setIsStreaming(false);
      setStreamingThinking('');
      setStreamingText('');
      abortControllerRef.current = null;
      isSendingRef.current = false;
      loadConversations();
    }
  };

  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#181816] text-[#ede8de] overflow-hidden relative select-none font-sans">
      {/* Subheader Toolbar: Thread Picker, New Chat, Artifact Drawer toggle, and Fullscreen Link */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2a26] bg-[#1f1e1b] shrink-0 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {/* Thread dropdown toggle */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowThreadPicker(!showThreadPicker)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#272622] hover:bg-[#2d2c28] border border-[#383632] text-[#ede8de] font-medium max-w-[160px] truncate"
              title="Switch conversation thread"
            >
              <svg className="w-3.5 h-3.5 text-[#da7756] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2a1 1 0 0 1 1 1v4.06a7.97 7.97 0 0 1 3.54 1.46l2.87-2.87a1 1 0 1 1 1.41 1.41l-2.87 2.87A7.97 7.97 0 0 1 19.41 13H23a1 1 0 1 1 0 2h-3.59a7.97 7.97 0 0 1-1.46 3.54l2.87 2.87a1 1 0 0 1-1.41 1.41l-2.87-2.87A7.97 7.97 0 0 1 13 21.41V23a1 1 0 1 1-2 0v-1.59a7.97 7.97 0 0 1-3.54-1.46l-2.87 2.87a1 1 0 0 1-1.41-1.41l2.87-2.87A7.97 7.97 0 0 1 4.59 15H1a1 1 0 1 1 0-2h3.59a7.97 7.97 0 0 1 1.46-3.54L3.18 6.59a1 1 0 1 1 1.41-1.41l2.87 2.87A7.97 7.97 0 0 1 11 6.59V3a1 1 0 0 1 1-1z" />
              </svg>
              <span className="truncate">{activeConversation?.title || 'New Chat'}</span>
              <svg className="w-3 h-3 text-[#9c978b] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Thread Popover */}
            {showThreadPicker && (
              <div className="absolute left-0 top-full mt-1.5 w-64 bg-[#21201d] border border-[#383632] rounded-xl shadow-2xl py-1.5 z-50 max-h-60 overflow-y-auto">
                <div className="px-3 py-1 text-[10px] font-semibold text-[#8b877c] uppercase tracking-wider">
                  Conversations
                </div>
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setActiveConversationId(c.id);
                      setShowThreadPicker(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs truncate flex items-center justify-between hover:bg-[#2b2a26] ${
                      activeConversationId === c.id ? 'text-[#da7756] font-semibold bg-[#282723]' : 'text-[#ede8de]'
                    }`}
                  >
                    <span className="truncate">{c.title}</span>
                    {c.pinned ? <span className="text-[#da7756] text-[10px]">📌</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleNewChat}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#272622] hover:bg-[#31302c] border border-[#383632] text-[#ede8de] text-xs font-medium"
            title="Start new chat"
          >
            <svg className="w-3.5 h-3.5 text-[#da7756]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>New</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Artifact Drawer Toggle */}
          {selectedArtifact && (
            <button
              type="button"
              onClick={() => setShowArtifactDrawer(!showArtifactDrawer)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-colors ${
                showArtifactDrawer
                  ? 'bg-[#da7756]/20 border-[#da7756]/50 text-[#da7756]'
                  : 'bg-[#272622] border-[#383632] text-[#cfc9bd] hover:bg-[#2d2c28]'
              }`}
              title="Toggle Artifact Canvas"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              <span>Artifact</span>
            </button>
          )}

          {/* Full Screen Studio Link / Switcher */}
          <button
            type="button"
            onClick={onExpandToFullChat}
            className="p-1.5 rounded-lg text-[#9c978b] hover:text-[#f7f4ee] hover:bg-[#282723] transition-colors cursor-pointer"
            title="Expand to Full Open Chat Studio (same page)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#9c978b] hover:text-[#f7f4ee] hover:bg-[#282723] transition-colors cursor-pointer"
              title="Close Chat Panel"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>


      {/* Main Body */}
      {(() => {
        const isChatEmpty = (!activeConversation || activeConversation.messages.length === 0) && !isStreaming;
        return (
          <div className="flex-1 flex overflow-hidden relative">
            <div className="flex-1 flex flex-col h-full min-w-0">
              <ChatTimeline
                messages={activeConversation?.messages || []}
                isStreaming={isStreaming}
                streamingThinking={streamingThinking}
                streamingText={streamingText}
                selectedArtifact={selectedArtifact}
                onSelectArtifact={(art) => {
                  setSelectedArtifact(art);
                  setShowArtifactDrawer(true);
                }}
                onSendPrompt={handleSendMessage}
                composer={
                  isChatEmpty ? (
                    <ChatComposer
                      onSendMessage={handleSendMessage}
                      isStreaming={isStreaming}
                      onStopStreaming={handleStopStreaming}
                      className="w-full px-0 pb-2 pt-0 max-w-2xl mx-auto"
                    />
                  ) : undefined
                }
              />

              {!isChatEmpty && (
                <ChatComposer
                  onSendMessage={handleSendMessage}
                  isStreaming={isStreaming}
                  onStopStreaming={handleStopStreaming}
                />
              )}
            </div>

            {/* Embedded Artifacts Canvas Overlay / Drawer */}
            {showArtifactDrawer && selectedArtifact && (
              <div className="w-1/2 h-full shrink-0 border-l border-zinc-800 z-20">
                <ArtifactsCanvas
                  artifact={selectedArtifact}
                  onClose={() => setShowArtifactDrawer(false)}
                />
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
