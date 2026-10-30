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
  onSendPrompt?: (prompt: string) => void;
  composer?: React.ReactNode;
}

function getGreetingTitle() {
  const hour = new Date().getHours();
  if (hour >= 21 || hour < 5) return 'Late night thoughts';
  if (hour < 12) return 'Morning thoughts';
  if (hour < 18) return 'Afternoon thoughts';
  return 'Evening thoughts';
}

function ClaudeSunburst() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="shrink-0">
      <g stroke="#da7756" strokeWidth="2.4" strokeLinecap="round">
        <line x1="16" y1="4" x2="16" y2="9" />
        <line x1="16" y1="23" x2="16" y2="28" />
        <line x1="4" y1="16" x2="9" y2="16" />
        <line x1="23" y1="16" x2="28" y2="16" />
        <line x1="7.5" y1="7.5" x2="11" y2="11" />
        <line x1="21" y1="21" x2="24.5" y2="24.5" />
        <line x1="7.5" y1="24.5" x2="11" y2="21" />
        <line x1="21" y1="11" x2="24.5" y2="7.5" />
        <line x1="5.1" y1="11.8" x2="9" y2="12.8" />
        <line x1="23" y1="19.2" x2="26.9" y2="20.2" />
        <line x1="11.8" y1="5.1" x2="12.8" y2="9" />
        <line x1="19.2" y1="23" x2="20.2" y2="26.9" />
        <line x1="5.1" y1="20.2" x2="9" y2="19.2" />
        <line x1="23" y1="12.8" x2="26.9" y2="11.8" />
        <line x1="11.8" y1="26.9" x2="12.8" y2="23" />
        <line x1="19.2" y1="9" x2="20.2" y2="5.1" />
      </g>
    </svg>
  );
}

export default function ChatTimeline({
  messages,
  isStreaming,
  streamingThinking,
  streamingText,
  selectedArtifact,
  onSelectArtifact,
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
    const greetingTitle = getGreetingTitle();

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 w-full overflow-y-auto">
        <div className="w-full max-w-[720px] mx-auto flex flex-col items-center">
          {/* Brand Icon & Headline - Horizontal Side by Side */}
          <div className="flex items-center justify-center gap-3.5 mb-7 select-none">
            <ClaudeSunburst />
            <h1 className="text-3xl sm:text-[34px] font-serif font-normal text-[#1f1e1d] dark:text-[#f7f4ee] tracking-tight">
              {greetingTitle}
            </h1>
          </div>

          {/* Composer in Empty State */}
          {composer && (
            <div className="w-full">
              {composer}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 space-y-7 w-full">
      <div className="max-w-[760px] mx-auto space-y-7">
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
                {(() => {
                  const rawContent = message.content || '';
                  const artifactRegex = /:::artifact\{id="([^"]+)"[^\}]*\}\s*:::/g;
                  const renderedIds = new Set<string>();
                  const parts: React.ReactNode[] = [];
                  let lastIndex = 0;
                  let match: RegExpExecArray | null;

                  while ((match = artifactRegex.exec(rawContent)) !== null) {
                    const textBefore = rawContent.slice(lastIndex, match.index).trim();
                    if (textBefore) {
                      parts.push(<Markdown key={`text-${lastIndex}`} text={textBefore} />);
                    }
                    const artId = match[1];
                    const art = parsedArtifacts.find((a) => a.id === artId);
                    if (art) {
                      renderedIds.add(art.id);
                      parts.push(
                        <ArtifactCard
                          key={`art-${art.id}`}
                          artifact={art}
                          isActive={selectedArtifact?.id === art.id}
                          onSelect={onSelectArtifact}
                        />
                      );
                    }
                    lastIndex = match.index + match[0].length;
                  }

                  const remainingText = rawContent.slice(lastIndex).trim();
                  if (remainingText) {
                    const cleanRemaining = remainingText
                      .replace(/:::artifact\{[\s\S]*?\}\s*:::/g, '')
                      .replace(/<antArtifact[\s\S]*?<\/antArtifact>/gi, '')
                      .trim();
                    if (cleanRemaining) {
                      parts.push(<Markdown key={`text-rem-${lastIndex}`} text={cleanRemaining} />);
                    }
                  }

                  // Render any remaining artifacts not placed by a tag
                  parsedArtifacts
                    .filter((a) => !renderedIds.has(a.id))
                    .forEach((art) => {
                      parts.push(
                        <ArtifactCard
                          key={`art-extra-${art.id}`}
                          artifact={art}
                          isActive={selectedArtifact?.id === art.id}
                          onSelect={onSelectArtifact}
                        />
                      );
                    });

                  return parts.length > 0 ? parts : <Markdown text={rawContent.replace(/:::artifact\{[\s\S]*?\}\s*:::/g, '').trim()} />;
                })()}
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
              {(() => {
                const isGeneratingArtifact = streamingText.includes('<antArtifact') || streamingText.includes(':::artifact');
                const cleanStreamingText = streamingText
                  .replace(/<antArtifact[\s\S]*$/gi, '')
                  .replace(/:::artifact\{[\s\S]*$/gi, '')
                  .trim();

                return (
                  <>
                    {cleanStreamingText ? (
                      <Markdown text={cleanStreamingText} />
                    ) : (
                      !streamingThinking && (
                        <div className="flex items-center gap-2 text-[#737067] dark:text-[#9b968a] text-xs py-1">
                          <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-[#da7756] border-t-transparent" />
                          <span>Claude is responding…</span>
                        </div>
                      )
                    )}
                    {isGeneratingArtifact && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 my-2 rounded-xl bg-[#da7756]/10 border border-[#da7756]/30 text-[#da7756] text-xs font-medium animate-pulse">
                        <span className="w-2 h-2 rounded-full bg-[#da7756]"></span>
                        <span>Generating interactive artifact preview…</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
