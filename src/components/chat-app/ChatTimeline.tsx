'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { DbConversationMessage, ExtractedArtifact } from '@/lib/db';
import Markdown from '@/components/chat/Markdown';
import ThinkingBlock from './ThinkingBlock';
import ArtifactCard from './ArtifactCard';

interface ChatTimelineProps {
  messages: DbConversationMessage[];
  isStreaming: boolean;
  streamingThinking: string;
  streamingText: string;
  selectedArtifact: ExtractedArtifact | null;
  onSelectArtifact: (artifact: ExtractedArtifact) => void;
  onSendPrompt: (prompt: string) => void;
  composer?: React.ReactNode;
}

const STARTER_PROMPTS = [
  {
    title: 'Interactive Web Application',
    prompt: 'Build a complete interactive financial loan calculator in HTML, CSS, and JS with clean visuals, sliders for loan amount, interest rate, and term, and an amortization chart.',
    badge: 'HTML / JS',
    icon: (
      <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
  {
    title: 'Modern SVG Vector Graphic',
    prompt: 'Create a high-quality, modern SVG vector illustration of a cloud native microservices architecture with glowing gradients, database nodes, and API gateways.',
    badge: 'SVG Vector',
    icon: (
      <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    title: 'React Kanban Board Component',
    prompt: 'Write a full React component for a sleek Kanban Task Board with columns (Backlog, In Progress, Done), add card functionality, and tag badges.',
    badge: 'React / TSX',
    icon: (
      <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 9a3 3 0 100 6 3 3 0 000-6zm0-7c-5.52 0-10 4.48-10 10s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
      </svg>
    ),
  },
  {
    title: 'Deep Architectural Reasoning',
    prompt: 'Analyze the mathematical and computational trade-offs between Multi-Head Attention and Grouped-Query Attention (GQA) in Large Language Models with detailed reasoning and LaTeX math.',
    badge: 'Reasoning & Math',
    icon: (
      <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 21 || hour < 5) return 'Moonlit chat?';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function ChatTimeline({
  messages,
  isStreaming,
  streamingThinking,
  streamingText,
  selectedArtifact,
  onSelectArtifact,
  onSendPrompt,
  composer,
}: ChatTimelineProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, streamingThinking, isStreaming]);

  const handleCopyMessage = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const isEmpty = messages.length === 0 && !isStreaming;

  if (isEmpty) {
    const greeting = getGreeting();

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 max-w-3xl mx-auto w-full overflow-y-auto">
        {/* Brand Icon & Headline */}
        <div className="flex flex-col items-center mb-6">
          <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0, fontFamily: 'var(--font-sans)' }}>
            {greeting}
          </h1>
        </div>

        {/* Centered Composer in Empty State */}
        {composer && (
          <div className="w-full mb-6">
            {composer}
          </div>
        )}

        {/* Starter Suggestion Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
          {STARTER_PROMPTS.map((starter) => (
            <button
              key={starter.title}
              type="button"
              onClick={() => onSendPrompt(starter.prompt)}
              style={{ border: '1px solid var(--border-base)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}
              className="flex flex-col text-left hover:bg-[var(--bg-hover)] transition-all duration-150 group cursor-pointer"
            >
              <div className="flex items-center justify-between w-full mb-1.5">
                <div className="flex items-center gap-2">
                  {starter.icon}
                  <span style={{ color: 'var(--text-primary)' }} className="font-semibold text-xs transition-colors">
                    {starter.title}
                  </span>
                </div>
                <span style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }} className="text-[10px] px-1.5 py-0.5 rounded font-mono">
                  {starter.badge}
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)' }} className="text-[11.5px] line-clamp-2 leading-relaxed">
                {starter.prompt}
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 space-y-7">
      <div className="max-w-3xl mx-auto space-y-7">
        {messages.map((message) => {
          const isUser = message.role === 'user';
          let parsedArtifacts: ExtractedArtifact[] = [];
          if (Array.isArray(message.artifacts)) {
            parsedArtifacts = message.artifacts as unknown as ExtractedArtifact[];
          } else if (typeof message.artifacts === 'string') {
            try {
              parsedArtifacts = JSON.parse(message.artifacts);
            } catch {}
          }

          if (isUser) {
            return (
              <div key={message.id} className="flex flex-col items-end">
                <div className="rounded-2xl px-5 py-3.5 max-w-[85%] bg-[#f0eee6] border border-[#e5e2da] text-[#1f1e1d] dark:bg-[#2a2925] dark:border-[#383632] dark:text-[#fbf8f2] shadow-2xs text-[14.5px] leading-relaxed whitespace-pre-wrap select-text font-sans">
                  {message.content}
                </div>
              </div>
            );
          }

          // Assistant Message - Clean Claude Editorial Layout
          return (
            <div key={message.id} className="flex flex-col items-start w-full group">
              {/* Header with Claude Sunburst */}
              <div className="flex items-center gap-2 mb-2 text-xs text-[#737067] dark:text-[#9b968a]">
                <div className="w-5 h-5 rounded-full bg-[#f0eee6] dark:bg-[#2a2925] flex items-center justify-center text-[#da7756]">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2a1 1 0 0 1 1 1v4.06a7.97 7.97 0 0 1 3.54 1.46l2.87-2.87a1 1 0 1 1 1.41 1.41l-2.87 2.87A7.97 7.97 0 0 1 19.41 13H23a1 1 0 1 1 0 2h-3.59a7.97 7.97 0 0 1-1.46 3.54l2.87 2.87a1 1 0 0 1-1.41 1.41l-2.87-2.87A7.97 7.97 0 0 1 13 21.41V23a1 1 0 1 1-2 0v-1.59a7.97 7.97 0 0 1-3.54-1.46l-2.87 2.87a1 1 0 0 1-1.41-1.41l2.87-2.87A7.97 7.97 0 0 1 4.59 15H1a1 1 0 1 1 0-2h3.59a7.97 7.97 0 0 1 1.46-3.54L3.18 6.59a1 1 0 1 1 1.41-1.41l2.87 2.87A7.97 7.97 0 0 1 11 6.59V3a1 1 0 0 1 1-1z" />
                  </svg>
                </div>
                <span className="font-semibold text-[#1f1e1d] dark:text-[#ede8de]">Claude</span>
                {message.model && (
                  <span className="text-[11px] text-[#8c887e] dark:text-[#7d796e] font-mono">
                    ({message.model})
                  </span>
                )}
              </div>

              {/* Extended Thinking Block */}
              {message.thinking && (
                <div className="w-full">
                  <ThinkingBlock
                    thinking={message.thinking}
                    thinkingMs={message.thinking_ms}
                  />
                </div>
              )}

              {/* Assistant Message Body */}
              <div className="w-full text-[#1f1e1d] dark:text-[#ebe6dc] text-[14.5px] leading-relaxed">
                <Markdown text={message.content} />

                {/* Inline Artifacts */}
                {parsedArtifacts.map((art) => (
                  <ArtifactCard
                    key={art.id}
                    artifact={art}
                    isActive={selectedArtifact?.id === art.id}
                    onSelect={onSelectArtifact}
                  />
                ))}
              </div>

              {/* Claude Action Toolbar */}
              <div className="flex items-center gap-1.5 mt-3 pt-1 text-[#8b867b] opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => handleCopyMessage(message.id, message.content)}
                  title="Copy response"
                  className="p-1.5 rounded-lg hover:bg-[#f0eee6] dark:hover:bg-[#282723] hover:text-[#1f1e1d] dark:hover:text-[#f7f4ee] transition-colors cursor-pointer"
                >
                  {copiedId === message.id ? (
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Copied!</span>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          );
        })}

        {/* Live Streaming Assistant Message */}
        {isStreaming && (
          <div className="flex flex-col items-start w-full">
            <div className="flex items-center gap-2 mb-2 text-xs text-[#737067] dark:text-[#9b968a]">
              <div className="w-5 h-5 rounded-full bg-[#f0eee6] dark:bg-[#2a2925] flex items-center justify-center text-[#da7756] animate-pulse">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2a1 1 0 0 1 1 1v4.06a7.97 7.97 0 0 1 3.54 1.46l2.87-2.87a1 1 0 1 1 1.41 1.41l-2.87 2.87A7.97 7.97 0 0 1 19.41 13H23a1 1 0 1 1 0 2h-3.59a7.97 7.97 0 0 1-1.46 3.54l2.87 2.87a1 1 0 0 1-1.41 1.41l-2.87-2.87A7.97 7.97 0 0 1 13 21.41V23a1 1 0 1 1-2 0v-1.59a7.97 7.97 0 0 1-3.54-1.46l-2.87 2.87a1 1 0 0 1-1.41-1.41l2.87-2.87A7.97 7.97 0 0 1 4.59 15H1a1 1 0 1 1 0-2h3.59a7.97 7.97 0 0 1 1.46-3.54L3.18 6.59a1 1 0 1 1 1.41-1.41l2.87 2.87A7.97 7.97 0 0 1 11 6.59V3a1 1 0 0 1 1-1z" />
                </svg>
              </div>
              <span className="font-semibold text-[#1f1e1d] dark:text-[#ede8de]">Claude</span>
              <span className="text-[11px] text-[#da7756] font-mono">generating…</span>
            </div>

            {streamingThinking && (
              <div className="w-full">
                <ThinkingBlock
                  thinking={streamingThinking}
                  isStreaming={true}
                />
              </div>
            )}

            <div className="w-full text-[#1f1e1d] dark:text-[#ebe6dc] text-[14.5px] leading-relaxed">
              {streamingText ? (
                <Markdown text={streamingText} />
              ) : (
                !streamingThinking && (
                  <div className="flex items-center gap-2 text-[#737067] dark:text-[#9b968a] text-xs py-1">
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-[#da7756] border-t-transparent" />
                    <span>Claude is responding…</span>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
