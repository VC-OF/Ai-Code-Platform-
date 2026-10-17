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
      <div className="p-3 border-r border-[#e8e6de] dark:border-[#2b2a26] bg-[#faf9f6] dark:bg-[#1a1916] flex flex-col items-center select-none">
        <button
          type="button"
          onClick={onToggleOpen}
          className="p-2 rounded-lg text-[#6e6b64] hover:text-[#1f1e1d] hover:bg-[#ebe7de] dark:text-[#9c978b] dark:hover:text-[#f7f4ee] dark:hover:bg-[#282723] transition-colors"
          title="Open sidebar"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth={1.8} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 4v16" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onNewChat}
          className="mt-4 p-2 rounded-xl bg-[#f0eee6] hover:bg-[#e8e5dc] text-[#1f1e1d] dark:bg-[#da7756] dark:text-white shadow-sm transition-colors"
          title="New Chat"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <aside className="w-64 sm:w-72 h-full border-r border-[#e8e6de] dark:border-[#2b2a26] bg-[#faf9f6] dark:bg-[#191815] flex flex-col shrink-0 select-none z-20 font-sans">
      {/* Top search & collapse */}
      <div className="p-3 pb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-[#21201d] border border-[#e8e6de] dark:border-[#312f2c] rounded-lg text-xs text-[#1f1e1d] dark:text-[#ece7dc] placeholder-[#9c978b] focus:outline-none focus:border-[#da7756] transition-colors shadow-2xs"
          />
          <svg
            className="w-3.5 h-3.5 text-[#9c978b] absolute left-2.5 top-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <button
          type="button"
          onClick={onToggleOpen}
          className="p-1.5 rounded-lg text-[#8c887e] hover:text-[#1f1e1d] hover:bg-[#ebe7de] dark:text-[#9c978b] dark:hover:text-[#f7f4ee] dark:hover:bg-[#282723] transition-colors"
          title="Close sidebar"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* + New Button */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f0eee6] hover:bg-[#e6e3da] dark:bg-[#282723] dark:hover:bg-[#31302c] border border-transparent hover:border-[#dedacf] text-[#1f1e1d] dark:text-[#f7f4ee] font-medium text-xs transition-all active:scale-[0.99]"
        >
          <span className="text-base leading-none font-semibold text-[#1f1e1d] dark:text-white">+</span>
          <span>New</span>
        </button>
      </div>

      {/* Navigation Links */}
      <div className="px-2 py-1 space-y-0.5 border-b border-[#ece9e0] dark:border-[#2b2a26]/60 pb-2">
        <button
          type="button"
          onClick={() => onSwitchToCode?.()}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-[#524f48] dark:text-[#9c978b] hover:text-[#1f1e1d] dark:hover:text-[#f7f4ee] hover:bg-[#edeae1] dark:hover:bg-[#23221f] transition-colors"
        >
          <svg className="w-3.5 h-3.5 text-[#736f66]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span>Projects</span>
        </button>

        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('oc-open', { detail: { target: 'upgrade' } }))}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-[#524f48] dark:text-[#9c978b] hover:text-[#1f1e1d] dark:hover:text-[#f7f4ee] hover:bg-[#edeae1] dark:hover:bg-[#23221f] transition-colors"
          title="Upgrade OpenCode in an isolated worktree"
        >
          <svg className="w-3.5 h-3.5 text-[#736f66]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>Upgrade OpenCode</span>
        </button>
      </div>

      {/* Conversation Thread List (Pinned & Recents) */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {groups.length === 0 ? (
          <div className="text-center py-8 text-xs text-[#9c978b]">
            {search ? 'No matching chats' : 'No chats yet'}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="space-y-0.5">
              <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold text-[#8c887e] dark:text-[#7d796f] tracking-wide">
                <span>{group.label}</span>
                {group.label === 'Recents' && (
                  <svg className="w-3 h-3 text-[#a8a49a]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
                        className="w-full px-2 py-1 text-xs bg-white dark:bg-[#121210] border border-[#da7756] rounded text-[#1f1e1d] dark:text-[#f7f4ee] focus:outline-none"
                      />
                    </form>
                  );
                }

                return (
                  <div
                    key={item.id}
                    onClick={() => onSelectConversation(item.id)}
                    className={`group relative flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-xs ${
                      isActive
                        ? 'bg-[#edeae1] dark:bg-[#292824] text-[#1f1e1d] dark:text-[#f7f4ee] font-medium shadow-2xs'
                        : 'text-[#524f48] dark:text-[#9c978b] hover:text-[#1f1e1d] dark:hover:text-[#ece7dc] hover:bg-[#edeae1]/60 dark:hover:bg-[#22211e]'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate min-w-0 pr-2">
                      {item.pinned ? (
                        <svg className="w-3.5 h-3.5 text-[#da7756] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5 text-[#8c887e] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                      )}
                      <span className="truncate">{item.title}</span>
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
                        className="p-1 rounded hover:bg-[#dfdbd1] dark:hover:bg-[#34322e] text-[#736f66] dark:text-[#9c978b]"
                      >
                        <svg className="w-3 h-3" fill={item.pinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                        </svg>
                      </button>

                      {/* Rename */}
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(item, e)}
                        title="Rename chat"
                        className="p-1 rounded hover:bg-[#dfdbd1] dark:hover:bg-[#34322e] text-[#736f66] dark:text-[#9c978b]"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
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
                        className="p-1 rounded hover:bg-[#dfdbd1] dark:hover:bg-[#34322e] text-[#736f66] dark:text-[#9c978b] hover:text-red-500"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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


    </aside>
  );
}
