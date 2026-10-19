'use client';

import React from 'react';
import { groupModelOptions } from '@/lib/modelOptions';
import ModeToggle from '@/components/layout/ModeToggle';

interface ChatHeaderProps {
  title: string;
  selectedModel: string;
  onModelChange: (model: string) => void;
  onClearChat: () => void;
  onExportChat: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  hasArtifact: boolean;
  isCanvasOpen: boolean;
  onToggleCanvas: () => void;
  onSwitchToCode?: () => void;
  onOpenKeyModal?: () => void;
}

export default function ChatHeader({
  title,
  selectedModel,
  onModelChange,
  onClearChat,
  onExportChat,
  isSidebarOpen,
  onToggleSidebar,
  hasArtifact,
  isCanvasOpen,
  onToggleCanvas,
  onSwitchToCode,
  onOpenKeyModal,
}: ChatHeaderProps) {
  return (
    <header className="min-h-11 border-b border-[#e8e6de] bg-white dark:border-[#2b2a26] dark:bg-[#1f1e1b] flex items-center justify-between gap-2 px-2 sm:px-3 text-[#1f1e1d] dark:text-[#ede8de] select-none z-10 shrink-0">
      {/* Left: Sidebar toggle, history back/forward, Segmented Mode Toggle & Title */}
      <div className="flex items-center gap-2 min-w-0">
        {!isSidebarOpen && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg text-[#6e6b64] hover:text-[#1f1e1d] hover:bg-[#f0eee6] dark:text-[#9c978b] dark:hover:text-[#f7f4ee] dark:hover:bg-[#282723] transition-colors shrink-0"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth={1.8} />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 4v16" />
            </svg>
          </button>
        )}

        <div className="hidden sm:flex items-center gap-0.5 mr-1">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') window.history.back();
            }}
            className="p-1 rounded-md text-[#8c887e] hover:text-[#1f1e1d] hover:bg-[#f0eee6] dark:text-[#9c978b] dark:hover:text-[#f7f4ee] dark:hover:bg-[#282723] transition-colors"
            title="Back"
            aria-label="Back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') window.history.forward();
            }}
            className="p-1 rounded-md text-[#8c887e] hover:text-[#1f1e1d] hover:bg-[#f0eee6] dark:text-[#9c978b] dark:hover:text-[#f7f4ee] dark:hover:bg-[#282723] transition-colors"
            title="Forward"
            aria-label="Forward"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Top-Left Segmented Mode Toggle */}
        <ModeToggle
          className="max-[420px]:[&_.mode-toggle-btn]:px-1.5 max-[420px]:[&_.mode-toggle-label]:hidden"
          activeMode="chat"
          onModeChange={(mode) => {
            if (mode === 'code') {
              if (onSwitchToCode) {
                onSwitchToCode();
              } else {
                window.location.href = '/';
              }
            }
          }}
        />

        {title && title !== 'Open Chat' && title !== 'New Chat' && (
          <div className="min-w-0 hidden md:flex items-center gap-1.5 text-xs">
            <span className="text-[#c5c1b6] dark:text-[#42403a] font-light">/</span>
            <span
              className="font-medium text-xs text-[#737067] dark:text-[#9c978b] truncate max-w-xs font-sans"
              title={title}
            >
              {title}
            </span>
          </div>
        )}
      </div>

      {/* Right: Model Selector & Actions */}
      <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-2">
        {/* Model dropdown */}
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          aria-label="Select model"
          className="min-w-0 w-[92px] sm:w-auto sm:max-w-[180px] bg-[#f7f6f2] dark:bg-[#262521] border border-[#e5e2da] dark:border-[#3b3a35] hover:border-[#da7756] rounded-lg px-1.5 sm:px-2.5 py-1 text-xs text-[#1f1e1d] dark:text-[#ede8de] focus:outline-none focus:border-[#da7756] cursor-pointer"
        >
          {groupModelOptions().map(([group, options]) => (
            <optgroup key={group} label={group} className="bg-white dark:bg-[#1f1e1b] text-[#1f1e1d] dark:text-[#ede8de]">
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* Artifacts Canvas Toggle */}
        {hasArtifact && (
          <button
            type="button"
            onClick={onToggleCanvas}
            title={isCanvasOpen ? 'Hide Artifacts Canvas' : 'Show Artifacts Canvas'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              isCanvasOpen
                ? 'bg-[#da7756]/15 border-[#da7756]/50 text-[#da7756]'
                : 'bg-[#f7f6f2] dark:bg-[#262521] border-[#e5e2da] dark:border-[#3b3a35] text-[#4d4a42] dark:text-[#cfc9bd] hover:bg-[#edeae1] dark:hover:bg-[#2d2c28]'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
            <span className="hidden sm:inline">Canvas</span>
          </button>
        )}

        {/* API Keys Configuration */}
        {onOpenKeyModal && (
          <button
            type="button"
            onClick={onOpenKeyModal}
            title="Configure API Keys"
            aria-label="Configure API Keys"
            className="p-1.5 rounded-lg text-[#737067] hover:text-[#1f1e1d] hover:bg-[#f0eee6] dark:text-[#9c978b] dark:hover:text-[#f7f4ee] dark:hover:bg-[#282723] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </button>
        )}

        {/* Export Chat */}
        <button
          type="button"
          onClick={onExportChat}
          title="Export conversation as Markdown"
          aria-label="Export conversation as Markdown"
          className="p-1.5 rounded-lg text-[#737067] hover:text-[#1f1e1d] hover:bg-[#f0eee6] dark:text-[#9c978b] dark:hover:text-[#f7f4ee] dark:hover:bg-[#282723] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>

        {/* Clear Chat */}
        <button
          type="button"
          onClick={onClearChat}
          title="Clear messages"
          aria-label="Clear messages"
          className="p-1.5 rounded-lg text-[#737067] hover:text-red-500 hover:bg-[#f0eee6] dark:text-[#9c978b] dark:hover:text-red-400 dark:hover:bg-[#282723] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </header>
  );
}
