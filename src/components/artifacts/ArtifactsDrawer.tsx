'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { ArtifactItem } from '@/lib/artifacts';
import s from './drawer.module.css';

interface ArtifactsDrawerProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

const CALLOUT_CLASS: Record<string, string | undefined> = {
  NOTE: s.callout_note,
  TIP: s.callout_tip,
  WARNING: s.callout_warning,
  CAUTION: s.callout_caution,
};

function renderCallout(key: string, type: string, lines: string[]) {
  return (
    <div key={key} className={`${s.callout} ${CALLOUT_CLASS[type] ?? ''}`}>
      <div className={s.calloutTitle}>{type.charAt(0) + type.slice(1).toLowerCase()}</div>
      <div className={s.calloutBody}>{lines.join('\n')}</div>
    </div>
  );
}

// Minimal markdown renderer: headings, lists, code fences, GitHub alerts.
function renderFormattedMarkdown(content: string) {
  const elements: React.ReactNode[] = [];
  let alertBuffer: { type: string; lines: string[] } | null = null;
  let codeBuffer: { lang: string; lines: string[] } | null = null;

  content.split('\n').forEach((line, index) => {
    if (line.startsWith('```')) {
      if (codeBuffer) {
        elements.push(
          <pre key={`code-${index}`} className={s.code}>
            <code>{codeBuffer.lines.join('\n')}</code>
          </pre>
        );
        codeBuffer = null;
      } else {
        codeBuffer = { lang: line.slice(3).trim(), lines: [] };
      }
      return;
    }
    if (codeBuffer) {
      codeBuffer.lines.push(line);
      return;
    }

    const alertMatch = line.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
    if (alertMatch) {
      alertBuffer = { type: alertMatch[1].toUpperCase(), lines: [] };
      return;
    }
    if (alertBuffer) {
      if (line.startsWith('>')) {
        alertBuffer.lines.push(line.replace(/^>\s?/, ''));
        return;
      }
      elements.push(renderCallout(`alert-${index}`, alertBuffer.type, alertBuffer.lines));
      alertBuffer = null;
    }

    if (line.startsWith('# ')) {
      elements.push(<h1 key={`h1-${index}`} className={s.h1}>{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={`h2-${index}`} className={s.h2}>{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={`h3-${index}`} className={s.h3}>{line.slice(4)}</h3>);
    } else if (line.startsWith('- ')) {
      elements.push(<li key={`li-${index}`} className={s.li}>{line.slice(2)}</li>);
    } else if (line.trim() === '') {
      elements.push(<div key={`sp-${index}`} className={s.spacer} />);
    } else {
      elements.push(<p key={`p-${index}`}>{line}</p>);
    }
  });

  // TS narrows alertBuffer to null here since it is only reassigned inside the callback
  const lastAlert = alertBuffer as { type: string; lines: string[] } | null;
  if (lastAlert) elements.push(renderCallout('alert-last', lastAlert.type, lastAlert.lines));
  return elements;
}

const fmtDate = (d: string | number | Date) =>
  new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ArtifactsDrawer({ projectId, isOpen, onClose }: ArtifactsDrawerProps) {
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Project id whose artifacts have finished loading; "loading" is derived from it.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState('');

  const loading = isOpen && !!projectId && loadedFor !== projectId;

  const fetchList = useCallback(async (): Promise<ArtifactItem[] | null> => {
    try {
      const res = await fetch(`/api/artifacts?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) return null;
      const data: { artifacts?: ArtifactItem[] } = await res.json();
      return data.artifacts || [];
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [projectId]);

  const applyList = useCallback(
    (list: ArtifactItem[] | null) => {
      if (list) {
        setArtifacts(list);
        setSelectedId((prev) => prev ?? (list.length > 0 ? list[0].id : null));
      }
      setLoadedFor(projectId);
    },
    [projectId]
  );

  const loadArtifacts = async () => {
    if (!projectId) return;
    applyList(await fetchList());
  };

  // Load on open; state is only set in the promise callback, after the fetch.
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
      if (isEditing) setIsEditing(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isEditing, onClose]);

  if (!isOpen) return null;

  const selectedArtifact = artifacts.find((a) => a.id === selectedId) || artifacts[0];

  const startEditing = () => {
    if (!selectedArtifact) return;
    setEditTitle(selectedArtifact.title);
    setEditContent(selectedArtifact.content);
    setIsEditing(true);
  };

  const handleCopy = () => {
    if (!selectedArtifact) return;
    navigator.clipboard
      .writeText(selectedArtifact.content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => console.error(err));
  };

  const handleDownload = () => {
    if (!selectedArtifact) return;
    const blob = new Blob([selectedArtifact.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedArtifact.title.replace(/\s+/g, '_').toLowerCase()}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleSaveEdit = async () => {
    if (!selectedArtifact) return;
    try {
      const res = await fetch('/api/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          id: selectedArtifact.id,
          title: editTitle,
          content: editContent,
          type: selectedArtifact.type,
        }),
      });
      if (res.ok) {
        await loadArtifacts();
        setIsEditing(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateNew = async () => {
    const title = prompt('Artifact title', 'New design note');
    if (!title) return;
    try {
      const res = await fetch('/api/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title,
          content: `# ${title}\n\n> [!NOTE]\n> Draft created on ${new Date().toLocaleDateString()}.\n\n## Summary\nDescribe requirements, design decisions, and architectural notes here.`,
          type: 'markdown',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await loadArtifacts();
        if (data.artifact?.id) {
          setSelectedId(data.artifact.id);
          setIsEditing(false);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this artifact? This cannot be undone.')) return;
    try {
      const res = await fetch(
        `/api/artifacts?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setArtifacts((prev) => prev.filter((a) => a.id !== id));
        if (selectedId === id) setSelectedId(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const q = search.toLowerCase();
  const filtered = artifacts.filter(
    (a) => a.title.toLowerCase().includes(q) || (a.description && a.description.toLowerCase().includes(q))
  );

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div
        className={s.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifacts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.topBar}>
          <div className={s.topTitle}>
            <h2 id="artifacts-title">Artifacts</h2>
            <span className={s.muted}>{artifacts.length}</span>
          </div>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close artifacts">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={s.split}>
          <div className={s.sidebar}>
            <div className={s.sidebarHead}>
              <div className={s.searchRow}>
                <input
                  type="text"
                  placeholder="Filter artifacts"
                  aria-label="Filter artifacts"
                  className={s.input}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button type="button" className={s.btn} onClick={handleCreateNew}>
                  New
                </button>
              </div>
            </div>

            <div className={s.list}>
              {loading && artifacts.length === 0 && <div className={s.note}>Loading…</div>}
              {!loading && artifacts.length === 0 && (
                <div className={s.note}>
                  No artifacts yet. Ask the agent to write one, e.g. &ldquo;Document the auth flow&rdquo;.
                </div>
              )}
              {!loading && artifacts.length > 0 && filtered.length === 0 && (
                <div className={s.note}>No artifacts match &ldquo;{search}&rdquo;.</div>
              )}
              {filtered.map((item) => {
                const active = item.id === selectedArtifact?.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    aria-current={active ? 'true' : undefined}
                    className={`${s.row} ${active ? s.rowActive : ''}`}
                    onClick={() => {
                      setSelectedId(item.id);
                      setIsEditing(false);
                    }}
                  >
                    <span className={s.rowTitle}>{item.title}</span>
                    <span className={s.rowMeta}>
                      {item.description || item.type} · {fmtDate(item.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={s.viewer}>
            {selectedArtifact ? (
              <>
                <div className={s.viewerHeader}>
                  <div className={s.viewerTitles}>
                    {isEditing ? (
                      <input
                        type="text"
                        aria-label="Artifact title"
                        className={s.titleInput}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                    ) : (
                      <h3 className={s.viewerTitle}>{selectedArtifact.title}</h3>
                    )}
                    <span className={s.muted}>
                      <span className={s.mono}>{selectedArtifact.id}</span> · Updated{' '}
                      {new Date(selectedArtifact.updatedAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className={s.actions}>
                    {isEditing ? (
                      <>
                        <button type="button" className={s.btn} onClick={() => setIsEditing(false)}>
                          Cancel
                        </button>
                        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={handleSaveEdit}>
                          Save
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className={s.btn} onClick={startEditing}>
                          Edit
                        </button>
                        <button type="button" className={s.btn} onClick={handleCopy}>
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                        <button type="button" className={s.btn} onClick={handleDownload}>
                          Download
                        </button>
                        <button
                          type="button"
                          className={`${s.btn} ${s.btnDanger}`}
                          onClick={() => handleDelete(selectedArtifact.id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className={s.body}>
                  {isEditing ? (
                    <textarea
                      aria-label="Artifact content"
                      className={s.textarea}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                    />
                  ) : (
                    <div className={s.md}>{renderFormattedMarkdown(selectedArtifact.content)}</div>
                  )}
                </div>
              </>
            ) : (
              <div className={s.empty}>
                {loading ? 'Loading…' : 'Artifacts the agent writes will appear here.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
