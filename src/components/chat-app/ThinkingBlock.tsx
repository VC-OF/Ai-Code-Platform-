'use client';

import React, { useState } from 'react';

interface ThinkingBlockProps {
  thinking: string;
  thinkingMs?: number | null;
  isStreaming?: boolean;
}

export default function ThinkingBlock({
  thinking,
  thinkingMs,
  isStreaming = false,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(isStreaming);

  const durationText = thinkingMs
    ? `Thought for ${(thinkingMs / 1000).toFixed(1)}s`
    : isStreaming
    ? 'Thinking…'
    : 'Thinking completed';

  return (
    <div className="my-3 rounded-xl border border-[#e5e2da] dark:border-[#3e3c38] bg-[#fbf9f5] dark:bg-[#23221f] text-xs overflow-hidden transition-all duration-200 shadow-2xs">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 bg-[#f0eee6] dark:bg-[#282724] hover:bg-[#eae7dd] dark:hover:bg-[#2d2c29] text-[#1f1e1d] dark:text-[#e3ded4] font-medium transition-colors text-left select-none cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            {isStreaming && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#da7756] opacity-75"></span>
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isStreaming ? 'bg-[#da7756]' : 'bg-[#da7756]'
              }`}
            ></span>
          </span>
          <span className="font-semibold tracking-wide text-[11px] text-[#da7756] uppercase font-mono">
            Thinking Process
          </span>
          <span className="text-[11px] text-[#737067] dark:text-[#9b968a] font-normal">
            ({durationText})
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[#737067] dark:text-[#9b968a] hover:text-[#1f1e1d] dark:hover:text-[#faf6f0]">
          <span className="text-[11px] font-sans">{isExpanded ? 'Hide' : 'Show'}</span>
          <svg
            className={`w-3.5 h-3.5 transform transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="p-4 text-[#3d3a33] dark:text-[#cfc9bd] font-mono text-[11.5px] leading-relaxed border-t border-[#e5e2da] dark:border-[#34322e] max-h-80 overflow-y-auto whitespace-pre-wrap select-text bg-[#f7f5ed] dark:bg-[#1c1b18]">
          {thinking}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 ml-1 bg-[#da7756] animate-pulse align-middle" />
          )}
        </div>
      )}
    </div>
  );
}
