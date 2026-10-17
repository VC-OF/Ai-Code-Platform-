'use client';

import React, { useState, useRef, useEffect } from 'react';

interface ChatComposerProps {
  onSendMessage: (text: string) => void;
  isStreaming: boolean;
  onStopStreaming?: () => void;
  className?: string;
}

export default function ChatComposer({
  onSendMessage,
  isStreaming,
  onStopStreaming,
  className,
}: ChatComposerProps) {
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 260)}px`;
    }
  }, [prompt]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isStreaming) {
      onStopStreaming?.();
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setPrompt('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={`${className || "w-full px-3 sm:px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 max-w-3xl mx-auto"} min-w-0`}>
      <form
        onSubmit={handleSubmit}
        className="relative flex flex-col rounded-2xl border border-[#e5e2da] dark:border-[#383632] bg-white dark:bg-[#252421] shadow-[0_2px_12px_rgba(0,0,0,0.04)] dark:shadow-xl focus-within:border-[#da7756]/60 transition-all duration-200"
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="How can I help you today?"
          rows={2}
          aria-label="Message"
          className="w-full resize-none bg-transparent px-3 sm:px-4 pt-3.5 pb-2 text-[14px] text-[#1f1e1d] dark:text-[#f5f1e8] placeholder-[#8c887e] focus:outline-none max-h-64 leading-relaxed font-sans"
        />

        {/* Bottom card row: + on left, mic + waveform + send on right */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
          <span className="pl-1 text-[11px] text-[#8c887e]">Enter to send · Shift+Enter for a new line</span>

          {/* Right actions: Mic, Waveform, Send */}
          <div className="flex items-center gap-1.5">
            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStreaming}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-[#da7756] hover:bg-[#c96c4d] text-white shadow-xs transition-transform active:scale-95 cursor-pointer ml-1"
                title="Stop response"
              >
                <span className="w-2.5 h-2.5 rounded-[2px] bg-white"></span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim()}
                aria-label="Send message"
                className={`flex items-center justify-center w-7 h-7 rounded-full transition-all duration-150 ml-1 ${
                  prompt.trim()
                    ? 'bg-[#da7756] hover:bg-[#c96c4d] text-white shadow-xs active:scale-95 cursor-pointer'
                    : 'bg-[#e5e2da] dark:bg-[#383632] text-[#a8a397] dark:text-[#6e6a60] cursor-not-allowed'
                }`}
                title={prompt.trim() ? 'Send message (Enter)' : 'Type a prompt to send'}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </form>

    </div>
  );
}
