'use client';

import React, { useState, useMemo } from 'react';
import type { DbConversation } from '@/lib/db';

interface ChatSidebarProps {
  conversations: DbConversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  onTogglePinConversation: (id: string, pinned: boolean) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  onSwitchToCode?: () => void;
}

export default function ChatSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onRenameConversation,
  onTogglePinConversation,
  isOpen,
  onToggleOpen,
  onSwitchToCode,
}: ChatSidebarProps) {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const term = search.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(term));
  }, [conversations, search]);

  const groups = useMemo(() => {
    const pinned: DbConversation[] = [];
    const today: DbConversation[] = [];
    const yesterday: DbConversation[] = [];
    const last7Days: DbConversation[] = [];
    const older: DbConversation[] = [];

    const oneDay = 24 * 60 * 60 * 1000;
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const yesterdayStart = todayStart - oneDay;
    const sevenDaysAgo = todayStart - 7 * oneDay;

    for (const c of filteredConversations) {
      if (c.pinned) {
        pinned.push(c);
        continue;
      }
      if (c.updated_at >= todayStart) {
        today.push(c);
      } else if (c.updated_at >= yesterdayStart) {
        yesterday.push(c);
      } else if (c.updated_at >= sevenDaysAgo) {
        last7Days.push(c);
      } else {
        older.push(c);
      }
    }

    return [
      { label: 'Pinned', items: pinned },
      { label: 'Today', items: today },
      { label: 'Yesterday', items: yesterday },
      { label: 'Previous 7 Days', items: last7Days },
      { label: 'Older', items: older },
    ].filter((g) => g.items.length > 0);
  }, [filteredConversations]);

  const handleStartRename = (c: DbConversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditingTitle(c.title);
  };

  const handleSaveRename = (id: string, e: React.FormEvent) => {
    e.preventDefault();
    if (editingTitle.trim()) {
      onRenameConversation(id, editingTitle.trim());
    }
    setEditingId(null);
  };

  if (!isOpen) {
    return (
      <div className="p-3 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col items-center select-none shrink-0 z-20">
        <button
          type="button"
          onClick={onToggleOpen}
          className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          title="Open sidebar"
          aria-label="Open sidebar"
        >
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth={1.8} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 4v16" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onNewChat}
          className="mt-4 p-2 rounded-xl bg-[var(--brand)] text-white hover:opacity-90 shadow-xs transition-transform active:scale-95 cursor-pointer"
          title="New Chat"
          aria-label="New Chat"
        >
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <aside className="w-64 sm:w-72 h-full border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col shrink-0 select-none z-20 font-sans">
      {/* Top search & collapse */}
      <div className="p-3 pb-2 flex items-center gap-2">
        <div className="relative flex-1 flex items-center">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none shrink-0"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats..."
            className="w-full h-8 pl-8 pr-6 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)] transition-colors shadow-2xs font-sans"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleOpen}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors shrink-0 cursor-pointer"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* + New Chat Action Button */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full h-9 flex items-center justify-between px-3 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] hover:border-[var(--brand)]/50 text-[var(--text-primary)] font-medium text-xs transition-all active:scale-[0.99] shadow-xs cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-[var(--brand)] text-white flex items-center justify-center font-bold shadow-xs group-hover:scale-105 transition-transform">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </span>
            <span className="font-semibold text-xs tracking-tight">New Chat</span>
          </div>
          <kbd className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-1.5 py-0.5 rounded font-medium">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Navigation Links */}
      <div className="px-3 py-1 space-y-1 border-b border-[var(--border-subtle)] pb-2.5">
        <button
          type="button"
          onClick={() => onSwitchToCode?.()}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group text-left"
        >
          <div className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] group-hover:text-[var(--brand)] transition-colors shrink-0">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <span className="truncate">Projects (Open Code)</span>
        </button>

        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('oc-open', { detail: { target: 'upgrade' } }))}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group text-left"
          title="Upgrade OpenCode in an isolated worktree"
        >
          <div className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] group-hover:text-[var(--brand)] transition-colors shrink-0">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="truncate">Upgrade OpenCode</span>
        </button>
      </div>

      {/* Conversation Thread List (Pinned & Recents) */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {groups.length === 0 ? (
          <div className="text-center py-8 text-xs text-[var(--text-muted)] font-sans">
            {search ? 'No matching chats' : 'No chats yet'}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="space-y-0.5">
              <div className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] font-sans flex items-center justify-between select-none">
                <span>{group.label}</span>
                {group.label === 'Recents' && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-[var(--text-muted)]">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                )}
              </div>

              {group.items.map((item) => {
                const isActive = activeConversationId === item.id;
                const isEditing = editingId === item.id;

                if (isEditing) {
                  return (
                    <form
                      key={item.id}
                      onSubmit={(e) => handleSaveRename(item.id, e)}
                      className="px-2 py-1"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={(e) => handleSaveRename(item.id, e)}
                        className="w-full h-7 px-2 text-xs bg-[var(--bg-elevated)] border border-[var(--brand)] rounded-md text-[var(--text-primary)] focus:outline-none font-sans"
                      />
                    </form>
                  );
                }

                return (
                  <div
                    key={item.id}
                    onClick={() => onSelectConversation(item.id)}
                    className={`group relative flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-all text-xs font-sans ${
                      isActive
                        ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] font-semibold shadow-2xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-[var(--brand)] rounded-r-full" />
                    )}

                    <div className="flex items-center gap-2 truncate min-w-0 pr-1">
                      <span className="w-4 h-4 flex items-center justify-center shrink-0">
                        {item.pinned ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--brand)]">
                            <path d="M12 2a1 1 0 0 1 1 1v4.06a7.97 7.97 0 0 1 3.54 1.46l2.87-2.87a1 1 0 1 1 1.41 1.41l-2.87 2.87A7.97 7.97 0 0 1 19.41 13H23a1 1 0 1 1 0 2h-3.59a7.97 7.97 0 0 1-1.46 3.54l2.87 2.87a1 1 0 0 1-1.41 1.41l-2.87-2.87A7.97 7.97 0 0 1 13 21.41V23a1 1 0 1 1-2 0v-1.59a7.97 7.97 0 0 1-3.54-1.46l-2.87 2.87a1 1 0 0 1-1.41-1.41l2.87-2.87A7.97 7.97 0 0 1 4.59 15H1a1 1 0 1 1 0-2h3.59a7.97 7.97 0 0 1 1.46-3.54L3.18 6.59a1 1 0 1 1 1.41-1.41l2.87 2.87A7.97 7.97 0 0 1 11 6.59V3a1 1 0 0 1 1-1z" />
                          </svg>
                        ) : (
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                          </svg>
                        )}
                      </span>
                      <span className="truncate leading-normal">{item.title}</span>
                    </div>

                    {/* Quick action buttons on hover */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {/* Pin */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePinConversation(item.id, !item.pinned);
                        }}
                        title={item.pinned ? 'Unpin chat' : 'Pin chat'}
                        aria-label={item.pinned ? 'Unpin chat' : 'Pin chat'}
                        className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      >
                        <svg width="12" height="12" fill={item.pinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                        </svg>
                      </button>

                      {/* Rename */}
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(item, e)}
                        title="Rename chat"
                        aria-label="Rename chat"
                        className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      >
                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteConversation(item.id);
                        }}
                        title="Delete chat"
                        aria-label="Delete chat"
                        className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-red-500 transition-colors cursor-pointer"
                      >
                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Sidebar Footer */}
      <div className="p-3 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-muted)] font-sans">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[var(--brand)] animate-pulse" />
          <span className="font-medium text-[var(--text-secondary)]">Open Chat</span>
        </div>
        <span className="font-mono text-[10px] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-1.5 py-0.5 rounded text-[var(--text-muted)]">
          v1.0
        </span>
      </div>
    </aside>
  );
}
