'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { KnowledgeItem } from '@/lib/knowledge';
import s from '../artifacts/drawer.module.css';

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

export default function KnowledgeModal({ projectId, isOpen, onClose }: KnowledgeModalProps) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTag, setActiveTag] = useState<string>('all');
  const [search, setSearch] = useState('');
  // true while composing a brand-new item: save must create, never overwrite
  const [isNew, setIsNew] = useState(false);

  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editContent, setEditContent] = useState('');

  const loading = isOpen && !!projectId && loadedFor !== projectId;

  const fetchList = useCallback(async (): Promise<KnowledgeItem[] | null> => {
    try {
      const res = await fetch(`/api/knowledge?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) return null;
      const data: { items?: KnowledgeItem[] } = await res.json();
      return data.items || [];
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [projectId]);

  const applyList = useCallback(
    (list: KnowledgeItem[] | null) => {
      if (list) {
        setItems(list);
        setSelectedId((prev) => prev ?? (list.length > 0 ? list[0].id : null));
      }
      setLoadedFor(projectId);
    },
    [projectId]
  );

  const loadItems = async () => {
    if (!projectId) return;
    applyList(await fetchList());
  };

  useEffect(() => {
    if (!isOpen || !projectId) return;
    let cancelled = false;
    fetchList().then((list) => {
      if (!cancelled) applyList(list);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId, fetchList, applyList]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditing) {
        setIsNew(false);
        setIsEditing(false);
      } else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isEditing, onClose]);

  if (!isOpen) return null;

  const selectedItem = items.find((i) => i.id === selectedId) || items[0];
  const allTags = Array.from(new Set(items.flatMap((i) => i.tags)));

  const q = search.toLowerCase();
  const filtered = items.filter((i) => {
    const matchesTag = activeTag === 'all' || i.tags.includes(activeTag);
    const matchesSearch = i.title.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q);
    return matchesTag && matchesSearch;
  });

  const startEditing = () => {
    if (!selectedItem) return;
    setIsNew(false);
    setEditTitle(selectedItem.title);
    setEditSummary(selectedItem.summary);
    setEditTags(selectedItem.tags.join(', '));
    setEditContent(selectedItem.content);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editTitle.trim() || !editSummary.trim() || !editContent.trim()) {
      alert('Please fill out title, summary, and content.');
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
        if (data.item?.id) setSelectedId(data.item.id);
        setIsNew(false);
        setIsEditing(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this knowledge item? This cannot be undone.')) return;
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

  const handleApplyPreset = async (preset: (typeof PRESET_TEMPLATES)[number]) => {
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

  const cancelEdit = () => {
    setIsNew(false);
    setIsEditing(false);
  };

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div
        className={s.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.topBar}>
          <div className={s.topTitle}>
            <h2 id="knowledge-title">Knowledge</h2>
            <span className={s.muted}>
              {items.length} {items.length === 1 ? 'item' : 'items'} in every prompt
            </span>
          </div>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close knowledge">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={s.intro}>
          Knowledge is saved in your workspace and added to the agent&apos;s system prompt on every turn, so it
          follows your conventions.
        </div>

        <div className={s.split}>
          <div className={s.sidebar}>
            <div className={s.sidebarHead}>
              <div className={s.searchRow}>
                <input
                  type="text"
                  placeholder="Search knowledge"
                  aria-label="Search knowledge"
                  className={s.input}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button type="button" className={s.btn} onClick={handleStartNew}>
                  New
                </button>
              </div>
              {allTags.length > 0 && (
                <div className={s.segmented} role="group" aria-label="Filter by tag">
                  <button
                    type="button"
                    aria-pressed={activeTag === 'all'}
                    className={`${s.segment} ${activeTag === 'all' ? s.segmentActive : ''}`}
                    onClick={() => setActiveTag('all')}
                  >
                    All
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={activeTag === tag}
                      className={`${s.segment} ${activeTag === tag ? s.segmentActive : ''}`}
                      onClick={() => setActiveTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={s.list}>
              {loading && items.length === 0 && <div className={s.note}>Loading…</div>}
              {!loading && items.length === 0 && (
                <div className={s.note}>
                  No knowledge yet. Add a convention the agent should always follow, or start from a template
                  below.
                </div>
              )}
              {!loading && items.length > 0 && filtered.length === 0 && (
                <div className={s.note}>No items match this filter.</div>
              )}
              {filtered.map((item) => {
                const active = item.id === selectedItem?.id && !isEditing;
                return (
                  <button
                    type="button"
                    key={item.id}
                    aria-current={active ? 'true' : undefined}
                    className={`${s.row} ${active ? s.rowActive : ''}`}
                    onClick={() => {
                      setIsNew(false);
                      setSelectedId(item.id);
                      setIsEditing(false);
                    }}
                  >
                    <span className={s.rowTitle}>{item.title}</span>
                    <span className={s.rowMeta}>{item.summary}</span>
                  </button>
                );
              })}

              <div className={s.sectionLabel}>Templates</div>
              {PRESET_TEMPLATES.map((tpl) => (
                <button key={tpl.title} type="button" className={s.row} onClick={() => handleApplyPreset(tpl)}>
                  <span className={s.rowTitle}>{tpl.title}</span>
                  <span className={s.rowMeta}>{tpl.summary}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={s.viewer}>
            {isEditing ? (
              <>
                <div className={s.viewerHeader}>
                  <h3 className={s.viewerTitle}>{selectedItem && !isNew ? 'Edit item' : 'New item'}</h3>
                  <div className={s.actions}>
                    <button type="button" className={s.btn} onClick={cancelEdit}>
                      Cancel
                    </button>
                    <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={handleSave}>
                      Save
                    </button>
                  </div>
                </div>

                <div className={s.body}>
                  <label className={s.field}>
                    <span className={s.label}>Title</span>
                    <input
                      type="text"
                      className={s.input}
                      placeholder="e.g. Data fetching in the App Router"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  </label>
                  <label className={s.field}>
                    <span className={s.label}>Summary</span>
                    <span className={s.muted}>One line, given priority in the prompt.</span>
                    <input
                      type="text"
                      className={s.input}
                      placeholder="e.g. Use server actions for mutations and Zod for validation"
                      value={editSummary}
                      onChange={(e) => setEditSummary(e.target.value)}
                    />
                  </label>
                  <label className={s.field}>
                    <span className={s.label}>Tags</span>
                    <input
                      type="text"
                      className={s.input}
                      placeholder="architecture, data, nextjs"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                    />
                  </label>
                  <label className={`${s.field} ${s.fieldGrow}`}>
                    <span className={s.label}>Content (Markdown)</span>
                    <textarea
                      className={s.textarea}
                      placeholder="Conventions, decisions, dos and don'ts…"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                    />
                  </label>
                </div>
              </>
            ) : selectedItem ? (
              <>
                <div className={s.viewerHeader}>
                  <div className={s.viewerTitles}>
                    <h3 className={s.viewerTitle}>{selectedItem.title}</h3>
                    <span className={s.muted}>
                      <span className={s.mono}>{selectedItem.id}</span>
                    </span>
                  </div>
                  <div className={s.actions}>
                    <button type="button" className={s.btn} onClick={startEditing}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${s.btn} ${s.btnDanger}`}
                      onClick={() => handleDelete(selectedItem.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className={s.body}>
                  <div className={s.md}>
                    <p>{selectedItem.summary}</p>
                    {selectedItem.tags.length > 0 && (
                      <div className={s.tags}>
                        {selectedItem.tags.map((t) => (
                          <span key={t} className={s.tag}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    <pre className={s.pre}>{selectedItem.content}</pre>
                  </div>
                </div>
              </>
            ) : (
              <div className={s.empty}>{loading ? 'Loading…' : 'Select an item, or create a new one.'}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
