'use client';

import React, { useState, useEffect } from 'react';
import type { KnowledgeItem } from '@/lib/knowledge';

interface KnowledgeModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_TEMPLATES = [
  {
    title: 'API & Error Handling Standards',
    summary: 'Standardized JSON error responses and HTTP status conventions.',
    tags: ['api', 'error-handling', 'backend'],
    content: `### API Error Handling Standard
- Always return JSON with \`{ error: string }\` on status >= 400.
- Use appropriate status codes: 400 for validation errors, 401 for unauthorized, 404 for missing resources, 500 for server exceptions.
- Never leak raw stack traces to the client in production responses.`,
  },
  {
    title: 'Component Architecture & State Rules',
    summary: 'Rules for modular client vs server components and state management.',
    tags: ['react', 'components', 'state'],
    content: `### Component Architecture
- Mark files with 'use client' only when they need browser APIs, hooks, or event listeners.
- Keep components focused and under 300 lines; extract complex UI into dedicated subcomponents.
- Use optimistic UI updates with error rollback for high-frequency actions.`,
  },
  {
    title: 'Security & Input Sanitization',
    summary: 'Zero-trust input validation using Zod and path traversal protection.',
    tags: ['security', 'zod', 'validation'],
    content: `### Security Standards
- Always validate incoming API request bodies using Zod schemas before processing.
- Prevent path traversal by strictly resolving paths inside workspace roots via safe path resolvers.
- Never commit or log API keys or bearer tokens.`,
  },
];

export default function KnowledgeModal({
  projectId,
  isOpen,
  onClose,
}: KnowledgeModalProps) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTag, setActiveTag] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [isNew, setIsNew] = useState(false);

  // Form states
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editContent, setEditContent] = useState('');

  const loadItems = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/knowledge?projectId=${encodeURIComponent(projectId)}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        if (data.items?.length > 0 && !selectedId) {
          setSelectedId(data.items[0].id);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadItems();
    }
  }, [isOpen, projectId]);

  const selectedItem = items.find((i) => i.id === selectedId) || items[0];

  useEffect(() => {
    if (selectedItem && !isNew) {
      setEditTitle(selectedItem.title);
      setEditSummary(selectedItem.summary);
      setEditTags(selectedItem.tags.join(', '));
      setEditContent(selectedItem.content);
      setIsEditing(false);
    }
  }, [selectedId, items]);

  if (!isOpen) return null;

  const allTags = Array.from(new Set(items.flatMap((i) => i.tags)));

  const filtered = items.filter((i) => {
    const matchesTag = activeTag === 'all' || i.tags.includes(activeTag);
    const matchesSearch =
      i.title.toLowerCase().includes(search.toLowerCase()) ||
      i.summary.toLowerCase().includes(search.toLowerCase());
    return matchesTag && matchesSearch;
  });

  const handleSave = async () => {
    if (!editTitle.trim() || !editSummary.trim() || !editContent.trim()) {
      alert('Please fill out Title, Summary, and Content.');
      return;
    }

    try {
      const tags = editTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          id: isEditing && !isNew && selectedItem ? selectedItem.id : undefined,
          title: editTitle,
          summary: editSummary,
          tags: tags.length > 0 ? tags : ['general'],
          content: editContent,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        await loadItems();
        if (data.item?.id) {
          setSelectedId(data.item.id);
        }
        setIsNew(false);
        setIsEditing(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this Knowledge Item?')) return;
    try {
      const res = await fetch(
        `/api/knowledge?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        if (selectedId === id) setSelectedId(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleApplyPreset = async (preset: typeof PRESET_TEMPLATES[0]) => {
    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title: preset.title,
          summary: preset.summary,
          tags: preset.tags,
          content: preset.content,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await loadItems();
        if (data.item?.id) setSelectedId(data.item.id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleStartNew = () => {
    setIsNew(true);
    setSelectedId(null);
    setEditTitle('');
    setEditSummary('');
    setEditTags('');
    setEditContent('');
    setIsEditing(true);
  };

  return (
    <div className="ki-modal-backdrop" onClick={onClose}>
      <div className="ki-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ki-top-bar">
          <div className="flex items-center gap-2">
            <span className="ki-badge-brand">🧠 Antigravity KI</span>
            <span className="font-semibold text-slate-100 text-sm">Knowledge Items Memory Store</span>
            <span className="text-xs text-slate-400 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
              {items.length} {items.length === 1 ? 'rule' : 'rules'} auto-injected
            </span>
          </div>
          <button type="button" className="ki-btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Info banner */}
        <div className="ki-banner">
          <span className="text-indigo-400 font-bold">ℹ️ Persistent Memory:</span> Knowledge items are permanently stored in your workspace and injected into the agent's system prompt on every turn so it adheres to your codebase conventions.
        </div>

        {/* Main Body */}
        <div className="ki-main-split">
          {/* Sidebar */}
          <div className="ki-sidebar">
            <div className="p-3 border-b border-white/10 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Knowledge Items</span>
                <button
                  type="button"
                  className="ki-new-btn"
                  onClick={handleStartNew}
                >
                  + New Item
                </button>
              </div>

              <input
                type="text"
                placeholder="Search knowledge..."
                className="ki-search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              {/* Tag filters */}
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-1">
                <button
                  type="button"
                  className={`ki-tag-btn ${activeTag === 'all' ? 'ki-tag-btn--active' : ''}`}
                  onClick={() => setActiveTag('all')}
                >
                  All
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`ki-tag-btn ${activeTag === tag ? 'ki-tag-btn--active' : ''}`}
                    onClick={() => setActiveTag(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Presets dropdown / quick adds */}
            <div className="px-3 py-2 bg-indigo-500/5 border-b border-indigo-500/10">
              <span className="text-[10.5px] font-semibold text-indigo-300 uppercase tracking-wider block mb-1">
                Quick Presets
              </span>
              <div className="flex flex-col gap-1">
                {PRESET_TEMPLATES.map((tpl, i) => (
                  <button
                    key={i}
                    type="button"
                    className="ki-preset-btn"
                    onClick={() => handleApplyPreset(tpl)}
                  >
                    + {tpl.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Items List */}
            <div className="ki-list-items">
              {loading && <div className="p-4 text-xs text-slate-400">Loading memory items...</div>}
              {!loading && filtered.length === 0 && (
                <div className="p-4 text-xs text-slate-500">No knowledge items match your filter.</div>
              )}
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className={`ki-item-card ${item.id === selectedItem?.id && !isEditing ? 'ki-item-card--active' : ''}`}
                  onClick={() => {
                    setIsNew(false);
                    setSelectedId(item.id);
                    setIsEditing(false);
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-xs text-slate-200 truncate">{item.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-2 mb-1.5">{item.summary}</p>
                  <div className="flex flex-wrap gap-1">
                    {item.tags.map((t) => (
                      <span key={t} className="ki-item-pill">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Details / Editor */}
          <div className="ki-viewer">
            {isEditing ? (
              <div className="ki-editor-pane">
                <div className="ki-viewer-header">
                  <h3 className="text-sm font-bold text-slate-100">
                    {selectedItem && !isNew ? 'Edit Knowledge Item' : 'New Knowledge Item'}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="ki-action-btn ki-action-btn--primary"
                      onClick={handleSave}
                    >
                      Save Knowledge Item
                    </button>
                    <button
                      type="button"
                      className="ki-action-btn"
                      onClick={() => {
                        setIsNew(false);
                        setIsEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                <div className="ki-editor-body">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-300 font-semibold">Title</label>
                    <input
                      type="text"
                      className="ki-form-input"
                      placeholder="e.g. Next.js App Router Data Fetching Patterns"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-300 font-semibold">Summary (injected as priority prompt line)</label>
                    <input
                      type="text"
                      className="ki-form-input"
                      placeholder="e.g. Always use server actions for mutation and Zod for validation"
                      value={editSummary}
                      onChange={(e) => setEditSummary(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-300 font-semibold">Tags (comma-separated)</label>
                    <input
                      type="text"
                      className="ki-form-input"
                      placeholder="e.g. architecture, data, nextjs"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1 flex-1 min-h-[220px]">
                    <label className="text-xs text-slate-300 font-semibold">Content (Markdown)</label>
                    <textarea
                      className="ki-form-textarea font-mono"
                      placeholder="Detailed instructions, coding conventions, architectural decisions, and dos/don'ts..."
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ) : selectedItem ? (
              <div className="ki-detail-pane">
                <div className="ki-viewer-header">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-slate-100 truncate">{selectedItem.title}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] text-slate-400 font-mono">ID: {selectedItem.id}</span>
                      <div className="flex gap-1">
                        {selectedItem.tags.map((t) => (
                          <span key={t} className="ki-item-pill">#{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      className="ki-action-btn"
                      onClick={() => setIsEditing(true)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ki-action-btn ki-action-btn--danger"
                      onClick={() => handleDelete(selectedItem.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="ki-detail-body">
                  <div className="ki-summary-callout">
                    <span className="font-semibold text-indigo-300 block mb-1">KI Summary</span>
                    <p className="text-xs text-slate-200 leading-relaxed">{selectedItem.summary}</p>
                  </div>

                  <div className="ki-markdown-view">
                    <pre className="font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {selectedItem.content}
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Select a Knowledge Item from the left to view details or add a new one.
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .ki-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.78);
          backdrop-filter: blur(6px);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: fade 0.2s ease;
        }
        @keyframes fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .ki-modal-container {
          width: 92vw;
          max-width: 1040px;
          height: 82vh;
          background: #0d0f17;
          border: 1px solid rgba(99, 102, 241, 0.35);
          border-radius: 14px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(99, 102, 241, 0.2);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .ki-top-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 18px;
          background: rgba(99, 102, 241, 0.08);
          border-bottom: 1px solid rgba(99, 102, 241, 0.2);
        }
        .ki-badge-brand {
          font-size: 11px;
          font-weight: 700;
          color: #c7d2fe;
          background: rgba(99, 102, 241, 0.25);
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid rgba(99, 102, 241, 0.4);
        }
        .ki-btn-close {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 15px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
        }
        .ki-btn-close:hover {
          color: #fff;
          background: rgba(255, 255, 255, 0.08);
        }
        .ki-banner {
          padding: 8px 18px;
          background: rgba(99, 102, 241, 0.06);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 11.5px;
          color: #cbd5e1;
        }
        .ki-main-split {
          display: flex;
          flex: 1;
          min-height: 0;
        }
        .ki-sidebar {
          width: 320px;
          background: rgba(0, 0, 0, 0.3);
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          flex-direction: column;
        }
        .ki-new-btn {
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 6px;
          background: #4f46e5;
          color: #fff;
          font-weight: 600;
          border: none;
          cursor: pointer;
        }
        .ki-new-btn:hover {
          background: #4338ca;
        }
        .ki-search-input {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          padding: 6px 10px;
          color: #f1f5f9;
          font-size: 11.5px;
          outline: none;
        }
        .ki-tag-btn {
          font-size: 10.5px;
          padding: 2px 7px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.05);
          color: #94a3b8;
          border: 1px solid rgba(255, 255, 255, 0.08);
          cursor: pointer;
          white-space: nowrap;
        }
        .ki-tag-btn--active {
          background: rgba(99, 102, 241, 0.25);
          color: #c7d2fe;
          border-color: #818cf8;
        }
        .ki-preset-btn {
          text-align: left;
          font-size: 10.5px;
          padding: 4px 8px;
          border-radius: 4px;
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.2);
          color: #c7d2fe;
          cursor: pointer;
          transition: all 0.12s;
        }
        .ki-preset-btn:hover {
          background: rgba(99, 102, 241, 0.25);
          border-color: #818cf8;
        }
        .ki-list-items {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ki-item-card {
          padding: 10px 12px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ki-item-card:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.12);
        }
        .ki-item-card--active {
          background: rgba(99, 102, 241, 0.18) !important;
          border-color: rgba(99, 102, 241, 0.5) !important;
        }
        .ki-item-pill {
          font-size: 9.5px;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.08);
          color: #94a3b8;
          font-family: monospace;
        }
        .ki-viewer {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          background: rgba(13, 15, 23, 0.85);
        }
        .ki-viewer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .ki-action-btn {
          font-size: 11px;
          padding: 5px 12px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #cbd5e1;
          cursor: pointer;
          transition: all 0.15s;
        }
        .ki-action-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
        }
        .ki-action-btn--primary {
          background: #4f46e5;
          border-color: #6366f1;
          color: #fff;
        }
        .ki-action-btn--danger {
          color: #f87171;
          border-color: rgba(239, 68, 68, 0.25);
        }
        .ki-action-btn--danger:hover {
          background: rgba(239, 68, 68, 0.15);
        }
        .ki-detail-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .ki-summary-callout {
          padding: 12px 14px;
          border-radius: 8px;
          background: rgba(99, 102, 241, 0.1);
          border-left: 3px solid #818cf8;
        }
        .ki-markdown-view {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 16px;
        }
        .ki-editor-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .ki-editor-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .ki-form-input {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 6px;
          padding: 7px 10px;
          color: #f8fafc;
          font-size: 12px;
          outline: none;
        }
        .ki-form-input:focus {
          border-color: #818cf8;
        }
        .ki-form-textarea {
          flex: 1;
          min-height: 240px;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          padding: 12px;
          color: #f8fafc;
          font-size: 12.5px;
          line-height: 1.55;
          outline: none;
          resize: vertical;
        }
        .ki-form-textarea:focus {
          border-color: #818cf8;
        }
      `}</style>
    </div>
  );
}
