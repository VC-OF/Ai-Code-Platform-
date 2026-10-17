'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { DbConversation, DbConversationMessage, ExtractedArtifact } from '@/lib/db';
import { getDefaultModel } from '@/lib/models';
import ChatSidebar from './ChatSidebar';
import ChatHeader from './ChatHeader';
import ChatTimeline from './ChatTimeline';
import ChatComposer from './ChatComposer';
import ArtifactsCanvas from './ArtifactsCanvas';

interface OpenChatAppProps {
  onSwitchToCode?: () => void;
  onOpenProject?: (projectId: string) => void;
}

export default function OpenChatApp({ onSwitchToCode, onOpenProject }: OpenChatAppProps = {}) {
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

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const sync = () => {
      setIsDesktop(media.matches);
      setIsSidebarOpen(media.matches);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState<ExtractedArtifact | null>(null);
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isSendingRef = useRef(false);

  // Sync selectedModel to localStorage
  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    if (typeof window !== 'undefined') {
      localStorage.setItem('opencode_selected_model', model);
    }
    if (activeConversationId) {
      fetch(`/api/conversations/${encodeURIComponent(activeConversationId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      }).catch(() => {});
    }
  };

  // Load conversation list
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, []);

  // Load active conversation messages
  const loadConversation = useCallback(async (id: string) => {
    if (isSendingRef.current) return;
    setSelectedArtifact(null);
    setIsCanvasOpen(false);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        const convo = data.conversation;
        if (isSendingRef.current || !convo || convo.id !== id) return;
        setActiveConversation(convo);
        if (convo.model) setSelectedModel(convo.model);

        // Find last artifact if available
        let lastArt: ExtractedArtifact | null = null;
        for (let i = convo.messages.length - 1; i >= 0; i--) {
          const m = convo.messages[i];
          if (m.artifacts && m.artifacts.length > 0) {
            lastArt = m.artifacts[m.artifacts.length - 1];
            break;
          }
        }
        if (lastArt) setSelectedArtifact(lastArt);
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations().then(() => {
      // If URL has ?id=, load that, otherwise load latest or create one
      const params = new URLSearchParams(window.location.search);
      const urlId = params.get('id');
      if (urlId) {
        setActiveConversationId(urlId);
        loadConversation(urlId);
      }
    });
  }, [loadConversations, loadConversation]);

  // When activeConversationId changes
  useEffect(() => {
    if (activeConversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadConversation(activeConversationId);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (url.searchParams.get('id') !== activeConversationId) {
          url.searchParams.set('id', activeConversationId);
          window.history.replaceState(null, '', url.pathname + url.search);
        }
      }
    } else {
      setActiveConversation(null);
      setSelectedArtifact(null);
      setIsCanvasOpen(false);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (url.searchParams.has('id')) {
          url.searchParams.delete('id');
          window.history.replaceState(null, '', url.pathname + url.search);
        }
      }
    }
  }, [activeConversationId, loadConversation]);

  // Handle New Chat
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
        setIsCanvasOpen(false);
      }
    } catch (err) {
      console.error('Failed to create new conversation:', err);
    }
  };

  // Handle Delete Conversation
  const handleDeleteConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConversationId === id) {
          setActiveConversationId(null);
          setActiveConversation(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  // Handle Rename Conversation
  const handleRenameConversation = async (id: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
        );
        if (activeConversation && activeConversation.id === id) {
          setActiveConversation((prev) => (prev ? { ...prev, title: newTitle } : null));
        }
      }
    } catch (err) {
      console.error('Failed to rename conversation:', err);
    }
  };

  // Handle Toggle Pin
  const handleTogglePinConversation = async (id: string, pinned: boolean) => {
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      });
      if (res.ok) {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, pinned: pinned ? 1 : 0 } : c))
        );
      }
    } catch (err) {
      console.error('Failed to pin conversation:', err);
    }
  };

  // Handle Clear Chat
  const handleClearChat = async () => {
    if (!activeConversationId) return;
    try {
      // Create fresh conversation or delete existing
      await handleDeleteConversation(activeConversationId);
      await handleNewChat();
    } catch {}
  };

  // Handle Export Chat
  const handleExportChat = () => {
    if (!activeConversation) return;
    let md = `# ${activeConversation.title}\n\n`;
    md += `*Model*: ${activeConversation.model || selectedModel}\n`;
    md += `*Date*: ${new Date(activeConversation.created_at).toLocaleString()}\n\n---\n\n`;

    for (const msg of activeConversation.messages) {
      md += `### ${msg.role === 'user' ? 'User' : 'Assistant'}\n\n`;
      if (msg.thinking) {
        md += `> **Thinking Process (${msg.thinking_ms ? (msg.thinking_ms / 1000).toFixed(1) + 's' : ''})**:\n`;
        md += `> ${msg.thinking.replace(/\n/g, '\n> ')}\n\n`;
      }
      md += `${msg.content}\n\n`;
      if (msg.artifacts) {
        const arts = typeof msg.artifacts === 'string' ? JSON.parse(msg.artifacts) : msg.artifacts;
        for (const art of arts) {
          md += `#### Artifact: ${art.title} (${art.type})\n\`\`\`${art.language || art.type}\n${art.content}\n\`\`\`\n\n`;
        }
      }
      md += `---\n\n`;
    }

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeConversation.title.replace(/[^a-z0-9_-]/gi, '_')}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Handle Send Message (Streamed)
  const handleSendMessage = async (prompt: string) => {
    isSendingRef.current = true;
    let convoId = activeConversationId;

    // If no active conversation, create one first
    if (!convoId) {
      try {
        const createRes = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: prompt.slice(0, 36) + (prompt.length > 36 ? '…' : ''),
            model: selectedModel,
          }),
        });
        if (!createRes.ok) throw new Error('Could not create conversation');
        const createData = await createRes.json();
        convoId = createData.conversation.id;
        setActiveConversationId(convoId);
        setConversations((prev) => [createData.conversation, ...prev]);
        setActiveConversation({
          ...createData.conversation,
          messages: [],
        });
      } catch (err) {
        console.error('Failed to initialize conversation:', err);
        isSendingRef.current = false;
        return;
      }
    }

    // Append optimistic user message
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
          title: prompt.slice(0, 36) + (prompt.length > 36 ? '…' : ''),
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
        body: JSON.stringify({
          content: prompt,
          model: selectedModel,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No readable stream');

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
                  const firstArt = data.artifacts[0];
                  setSelectedArtifact(firstArt);
                  setIsCanvasOpen(true);
                }
              } else if (currentEvent === 'error') {
                accumulatedText += `\n\n> ⚠️ **Error**: ${data.error || 'Failed to complete response'}`;
                setStreamingText(accumulatedText);
              } else if (currentEvent === 'done') {
                hasCompleted = true;
                // Assistant message completed
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
                  setIsCanvasOpen(true);
                }
              }
            } catch (parseErr) {
              console.error('Error parsing SSE data:', parseErr);
            }
          }
        }
      }

      // If stream finished without an explicit done event, preserve accumulated text
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
        console.error('Streaming error:', err);
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

  const isChatEmpty = (!activeConversation || activeConversation.messages.length === 0) && !isStreaming;

  return (
      <div className="relative flex h-[100dvh] min-h-0 w-full overflow-hidden bg-white dark:bg-[#1f1e1d] font-sans text-[#1f1e1d] dark:text-[#f7f4ee]">
      {/* Left Conversation History Sidebar */}
      {isSidebarOpen && !isDesktop && <button type="button" aria-label="Close chat history" onClick={() => setIsSidebarOpen(false)} className="absolute inset-0 z-30 bg-black/25 md:hidden" />}
      <div className={`${isSidebarOpen ? 'absolute inset-y-0 left-0 z-40 w-[min(18rem,85vw)] shadow-2xl md:relative md:z-20 md:w-auto md:shadow-none' : 'hidden md:flex'}`}>
      <ChatSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={(id) => {
          setActiveConversationId(id);
          setIsSidebarOpen(false);
        }}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        onTogglePinConversation={handleTogglePinConversation}
        isOpen={isSidebarOpen}
        onToggleOpen={() => setIsSidebarOpen(!isSidebarOpen)}
        onSwitchToCode={onSwitchToCode}
      />
      </div>

      {/* Main Conversation Center Container */}
      <div className="flex flex-1 flex-col h-full min-w-0 overflow-hidden relative">
        {/* Header */}
        <ChatHeader
          title={activeConversation?.title || 'Open Chat'}
          selectedModel={selectedModel}
          onModelChange={handleModelChange}
          onClearChat={handleClearChat}
          onExportChat={handleExportChat}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(true)}
          hasArtifact={!!selectedArtifact}
          isCanvasOpen={isCanvasOpen}
          onToggleCanvas={() => setIsCanvasOpen(!isCanvasOpen)}
          onSwitchToCode={onSwitchToCode}
        />

        {/* Message Stream */}
        <ChatTimeline
          messages={activeConversation?.messages || []}
          isStreaming={isStreaming}
          streamingThinking={streamingThinking}
          streamingText={streamingText}
          selectedArtifact={selectedArtifact}
          onSelectArtifact={(art) => {
            setSelectedArtifact(art);
            setIsCanvasOpen(true);
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

        {/* Input Composer (bottom docked when chat is active) */}
        {!isChatEmpty && (
          <ChatComposer
            onSendMessage={handleSendMessage}
            isStreaming={isStreaming}
            onStopStreaming={handleStopStreaming}
          />
        )}
      </div>

      {/* Side-by-side Artifacts Canvas Panel */}
      {isCanvasOpen && selectedArtifact && (
        <div className="absolute inset-0 z-30 h-full w-full md:static md:z-20 md:h-full md:w-[min(48%,48rem)] md:shrink-0 transition-all duration-300">
          <ArtifactsCanvas
            artifact={selectedArtifact}
            onClose={() => setIsCanvasOpen(false)}
            onOpenProject={onOpenProject}
          />
        </div>
      )}
    </div>
  );
}
