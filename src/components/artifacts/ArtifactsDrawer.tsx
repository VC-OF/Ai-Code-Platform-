'use client';

import React, { useState, useEffect } from 'react';
import type { ArtifactItem } from '@/lib/artifacts';

interface ArtifactsDrawerProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ArtifactsDrawer({
  projectId,
  isOpen,
  onClose,
}: ArtifactsDrawerProps) {
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState('');

  const loadArtifacts = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/artifacts?projectId=${encodeURIComponent(projectId)}`);
      if (res.ok) {
        const data = await res.json();
        setArtifacts(data.artifacts || []);
        if (data.artifacts?.length > 0 && !selectedId) {
          setSelectedId(data.artifacts[0].id);
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
      loadArtifacts();
    }
  }, [isOpen, projectId]);

  const selectedArtifact = artifacts.find((a) => a.id === selectedId) || artifacts[0];

  useEffect(() => {
    if (selectedArtifact) {
      setEditTitle(selectedArtifact.title);
      setEditContent(selectedArtifact.content);
      setIsEditing(false);
    }
  }, [selectedId, artifacts]);

  if (!isOpen) return null;

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
    const title = prompt('Enter artifact title:', 'New Architecture Spec');
    if (!title) return;
    try {
      const res = await fetch('/api/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title,
          content: `# ${title}\n\n> [!NOTE]\n> Draft artifact documentation created on ${new Date().toLocaleDateString()}.\n\n## Summary\nDescribe requirements, design decisions, and architectural notes here.`,
          type: 'markdown',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await loadArtifacts();
        if (data.artifact?.id) {
          setSelectedId(data.artifact.id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this artifact?')) return;
    try {
      const res = await fetch(`/api/artifacts?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setArtifacts((prev) => prev.filter((a) => a.id !== id));
        if (selectedId === id) {
          setSelectedId(null);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Helper to parse markdown alerts ([!NOTE], [!TIP], etc.)
  const renderFormattedMarkdown = (content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let alertBuffer: { type: string; lines: string[] } | null = null;
    let codeBuffer: { lang: string; lines: string[] } | null = null;

    lines.forEach((line, index) => {
      // Code blocks
      if (line.startsWith('```')) {
        if (codeBuffer) {
          elements.push(
            <pre key={`code-${index}`} className="artifact-code-block">
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

      // GitHub Alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
      const alertMatch = line.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
      if (alertMatch) {
        alertBuffer = { type: alertMatch[1].toUpperCase(), lines: [] };
        return;
      }

      if (alertBuffer) {
        if (line.startsWith('>')) {
          alertBuffer.lines.push(line.replace(/^>\s?/, ''));
          return;
        } else {
          // Flush alert
          const type = alertBuffer.type;
          const text = alertBuffer.lines.join('\n');
          elements.push(
            <div key={`alert-${index}`} className={`artifact-callout artifact-callout--${type.toLowerCase()}`}>
              <div className="artifact-callout-header">
                <span className="artifact-callout-icon">
                  {type === 'NOTE' && 'ℹ️'}
                  {type === 'TIP' && '💡'}
                  {type === 'IMPORTANT' && '📌'}
                  {type === 'WARNING' && '⚠️'}
                  {type === 'CAUTION' && '🛑'}
                </span>
                <span className="artifact-callout-title">{type}</span>
              </div>
              <div className="artifact-callout-content">{text}</div>
            </div>
          );
          alertBuffer = null;
        }
      }

      // Headers
      if (line.startsWith('# ')) {
        elements.push(<h1 key={`h1-${index}`} className="artifact-h1">{line.slice(2)}</h1>);
      } else if (line.startsWith('## ')) {
        elements.push(<h2 key={`h2-${index}`} className="artifact-h2">{line.slice(3)}</h2>);
      } else if (line.startsWith('### ')) {
        elements.push(<h3 key={`h3-${index}`} className="artifact-h3">{line.slice(4)}</h3>);
      } else if (line.startsWith('- ')) {
        elements.push(
          <li key={`li-${index}`} className="artifact-li">
            {line.slice(2)}
          </li>
        );
      } else if (line.trim() === '') {
        elements.push(<div key={`sp-${index}`} className="h-2" />);
      } else {
        elements.push(<p key={`p-${index}`} className="artifact-p">{line}</p>);
      }
    });

    // TS narrows alertBuffer to null here since it is only reassigned inside the forEach callback
    const lastAlert = alertBuffer as { type: string; lines: string[] } | null;
    if (lastAlert) {
      const type = lastAlert.type;
      const text = lastAlert.lines.join('\n');
      elements.push(
        <div key="alert-last" className={`artifact-callout artifact-callout--${type.toLowerCase()}`}>
          <div className="artifact-callout-header">
            <span className="artifact-callout-icon">
              {type === 'NOTE' && 'ℹ️'}
              {type === 'TIP' && '💡'}
              {type === 'IMPORTANT' && '📌'}
              {type === 'WARNING' && '⚠️'}
              {type === 'CAUTION' && '🛑'}
            </span>
            <span className="artifact-callout-title">{type}</span>
          </div>
          <div className="artifact-callout-content">{text}</div>
        </div>
      );
    }

    return elements;
  };

  const filtered = artifacts.filter(
    (a) =>
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      (a.description && a.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="artifact-modal-backdrop" onClick={onClose}>
      <div className="artifact-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <div className="artifact-top-bar">
          <div className="flex items-center gap-2">
            <span className="artifact-badge-brand">✦ Antigravity</span>
            <span className="font-semibold text-slate-100 text-sm">Project Artifacts & Architecture Docs</span>
            <span className="text-xs text-slate-400 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
              {artifacts.length} {artifacts.length === 1 ? 'doc' : 'docs'}
            </span>
          </div>
          <button type="button" className="artifact-btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Modal Layout */}
        <div className="artifact-main-split">
          {/* Sidebar */}
          <div className="artifact-sidebar">
            <div className="p-3 border-b border-white/10 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Artifacts</span>
                <button
                  type="button"
                  className="artifact-new-btn"
                  onClick={handleCreateNew}
                  title="Create new artifact"
                >
                  + New
                </button>
              </div>
              <input
                type="text"
                placeholder="Filter docs..."
                className="artifact-search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="artifact-list-items">
              {loading && <div className="p-4 text-xs text-slate-400">Loading artifacts...</div>}
              {!loading && filtered.length === 0 && (
                <div className="p-4 text-xs text-slate-500">No matching artifacts found.</div>
              )}
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className={`artifact-item-card ${item.id === selectedArtifact?.id ? 'artifact-item-card--active' : ''}`}
                  onClick={() => {
                    setSelectedId(item.id);
                    setIsEditing(false);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-xs text-slate-200 truncate">{item.title}</span>
                    <span className="artifact-type-tag">{item.type}</span>
                  </div>
                  {item.description && (
                    <p className="text-[11px] text-slate-400 truncate mt-1">{item.description}</p>
                  )}
                  <div className="text-[10px] text-slate-500 mt-1">
                    {new Date(item.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Viewer / Editor */}
          <div className="artifact-viewer">
            {selectedArtifact ? (
              <>
                <div className="artifact-viewer-header">
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        type="text"
                        className="artifact-title-input"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                    ) : (
                      <h2 className="text-base font-bold text-slate-100 truncate">{selectedArtifact.title}</h2>
                    )}
                    <span className="text-[11px] text-slate-400">
                      ID: <span className="font-mono">{selectedArtifact.id}</span> · Updated{' '}
                      {new Date(selectedArtifact.updatedAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          className="artifact-action-btn artifact-action-btn--primary"
                          onClick={handleSaveEdit}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="artifact-action-btn"
                          onClick={() => setIsEditing(false)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="artifact-action-btn"
                          onClick={() => setIsEditing(true)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="artifact-action-btn"
                          onClick={handleCopy}
                        >
                          {copied ? '✓ Copied' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          className="artifact-action-btn"
                          onClick={handleDownload}
                        >
                          Download .md
                        </button>
                        <button
                          type="button"
                          className="artifact-action-btn artifact-action-btn--danger"
                          onClick={() => handleDelete(selectedArtifact.id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="artifact-content-body">
                  {isEditing ? (
                    <textarea
                      className="artifact-editor-textarea font-mono"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                    />
                  ) : (
                    <div className="artifact-markdown-render">
                      {renderFormattedMarkdown(selectedArtifact.content)}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Select an artifact from the left to view or create a new one.
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .artifact-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.75);
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
        .artifact-modal-container {
          width: 90vw;
          max-width: 1080px;
          height: 82vh;
          background: #0f111a;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 14px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(99, 102, 241, 0.15);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .artifact-top-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 18px;
          background: rgba(255, 255, 255, 0.02);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .artifact-badge-brand {
          font-size: 11px;
          font-weight: 700;
          color: #a5b4fc;
          background: rgba(99, 102, 241, 0.2);
          padding: 2px 7px;
          border-radius: 6px;
          border: 1px solid rgba(99, 102, 241, 0.35);
        }
        .artifact-btn-close {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 15px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
        }
        .artifact-btn-close:hover {
          color: #fff;
          background: rgba(255, 255, 255, 0.08);
        }
        .artifact-main-split {
          display: flex;
          flex: 1;
          min-height: 0;
        }
        .artifact-sidebar {
          width: 290px;
          background: rgba(0, 0, 0, 0.25);
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          flex-direction: column;
        }
        .artifact-new-btn {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 6px;
          background: #4f46e5;
          color: #fff;
          font-weight: 600;
          border: none;
          cursor: pointer;
        }
        .artifact-new-btn:hover {
          background: #4338ca;
        }
        .artifact-search-input {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          padding: 6px 10px;
          color: #f1f5f9;
          font-size: 11.5px;
          outline: none;
        }
        .artifact-list-items {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .artifact-item-card {
          padding: 10px 12px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .artifact-item-card:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.12);
        }
        .artifact-item-card--active {
          background: rgba(99, 102, 241, 0.15) !important;
          border-color: rgba(99, 102, 241, 0.5) !important;
        }
        .artifact-type-tag {
          font-size: 9.5px;
          font-family: monospace;
          background: rgba(255, 255, 255, 0.08);
          padding: 1px 5px;
          border-radius: 4px;
          color: #94a3b8;
          text-transform: uppercase;
        }
        .artifact-viewer {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          background: rgba(15, 17, 26, 0.7);
        }
        .artifact-viewer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .artifact-title-input {
          width: 100%;
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid #6366f1;
          border-radius: 6px;
          color: #fff;
          font-size: 14px;
          font-weight: 700;
          padding: 4px 8px;
        }
        .artifact-action-btn {
          font-size: 11px;
          padding: 5px 10px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #cbd5e1;
          cursor: pointer;
          transition: all 0.15s;
        }
        .artifact-action-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
        }
        .artifact-action-btn--primary {
          background: #4f46e5;
          border-color: #6366f1;
          color: #fff;
        }
        .artifact-action-btn--danger {
          color: #f87171;
          border-color: rgba(239, 68, 68, 0.25);
        }
        .artifact-action-btn--danger:hover {
          background: rgba(239, 68, 68, 0.15);
        }
        .artifact-content-body {
          flex: 1;
          overflow-y: auto;
          padding: 24px 28px;
        }
        .artifact-editor-textarea {
          width: 100%;
          height: 100%;
          background: transparent;
          border: none;
          color: #f8fafc;
          font-size: 13px;
          line-height: 1.6;
          outline: none;
          resize: none;
        }
        .artifact-markdown-render {
          display: flex;
          flex-direction: column;
          gap: 10px;
          color: #e2e8f0;
          font-size: 13.5px;
          line-height: 1.6;
        }
        .artifact-h1 {
          font-size: 20px;
          font-weight: 700;
          color: #f8fafc;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 8px;
          margin-top: 6px;
        }
        .artifact-h2 {
          font-size: 16px;
          font-weight: 600;
          color: #e2e8f0;
          margin-top: 14px;
        }
        .artifact-h3 {
          font-size: 14px;
          font-weight: 600;
          color: #cbd5e1;
          margin-top: 10px;
        }
        .artifact-p {
          color: #cbd5e1;
        }
        .artifact-li {
          margin-left: 18px;
          color: #cbd5e1;
        }
        .artifact-code-block {
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 12px 14px;
          overflow-x: auto;
          font-family: monospace;
          font-size: 12px;
          color: #38bdf8;
        }
        /* Antigravity callouts */
        .artifact-callout {
          border-radius: 8px;
          padding: 12px 16px;
          margin: 10px 0;
          border-left: 4px solid;
          background: rgba(255, 255, 255, 0.03);
        }
        .artifact-callout-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11.5px;
          font-weight: 700;
          margin-bottom: 4px;
          letter-spacing: 0.04em;
        }
        .artifact-callout-content {
          font-size: 12.5px;
          line-height: 1.5;
        }
        .artifact-callout--note {
          border-color: #38bdf8;
          background: rgba(56, 189, 248, 0.08);
          color: #bae6fd;
        }
        .artifact-callout--tip {
          border-color: #34d399;
          background: rgba(52, 211, 153, 0.08);
          color: #a7f3d0;
        }
        .artifact-callout--important {
          border-color: #a855f7;
          background: rgba(168, 85, 247, 0.08);
          color: #e9d5ff;
        }
        .artifact-callout--warning {
          border-color: #f59e0b;
          background: rgba(245, 158, 11, 0.08);
          color: #fde68a;
        }
        .artifact-callout--caution {
          border-color: #ef4444;
          background: rgba(239, 68, 68, 0.08);
          color: #fecaca;
        }
      `}</style>
    </div>
  );
}
