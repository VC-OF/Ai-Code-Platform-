'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { languageFor } from '@/lib/file-utils';

const MonacoDiffEditor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.DiffEditor),
  { ssr: false }
);

interface ChangesReviewModalProps {
  isOpen?: boolean;
  onClose: () => void;
  projectId: string;
  filesChanged?: string[];
  changedFiles?: string[];
  onReverted?: () => void;
  onRollbackComplete?: () => void;
}

interface FileDiffItem {
  path: string;
  original: string;
  modified: string;
  status: 'modified' | 'added' | 'deleted';
}

interface CheckpointItem {
  sha: string;
  timestamp: number;
  message: string;
}

export default function ChangesReviewModal({
  isOpen = true,
  onClose,
  projectId,
  filesChanged,
  changedFiles,
  onReverted,
  onRollbackComplete,
}: ChangesReviewModalProps) {
  const activeFiles = useMemo(
    () => filesChanged || changedFiles || [],
    [filesChanged, changedFiles]
  );
  const [diffFiles, setDiffFiles] = useState<FileDiffItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([]);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'inline'>('side-by-side');

  // Load changes and checkpoints
  const loadChangesAndCheckpoints = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);

    try {
      // 1. Fetch checkpoints
      const cpRes = await fetch(`/api/git/checkpoints?projectId=${encodeURIComponent(projectId)}`);
      const cpData = await cpRes.json();
      const cpList: CheckpointItem[] = cpData.checkpoints || [];
      setCheckpoints(cpList);
      if (cpList.length > 0) {
        setSelectedSha(cpList[0].sha);
      }

      // 2. Fetch git status to get current changed files
      const statusRes = await fetch(`/api/git/status?projectId=${encodeURIComponent(projectId)}`);
      const statusData = await statusRes.json();
      const statusChanges: Array<{ code: string; path: string }> = statusData.changes || [];

      // Combine provided activeFiles and status changes
      const allPaths = Array.from(
        new Set([
          ...activeFiles,
          ...statusChanges.map((c) => c.path),
        ])
      ).filter(Boolean);

      if (allPaths.length === 0) {
        setDiffFiles([]);
        setSelectedPath(null);
        setLoading(false);
        return;
      }

      // Fetch diff content for each file
      const loaded: FileDiffItem[] = await Promise.all(
        allPaths.map(async (filePath) => {
          try {
            const [fsRes, gitRes] = await Promise.all([
              fetch(`/api/files?path=${encodeURIComponent(filePath)}&projectId=${encodeURIComponent(projectId)}`),
              fetch(`/api/files?path=${encodeURIComponent(filePath)}&projectId=${encodeURIComponent(projectId)}&version=git`),
            ]);

            const fsData = await fsRes.json();
            const gitData = await gitRes.json();

            const original = gitData.content ?? '';
            const modified = fsData.content ?? '';

            let status: 'modified' | 'added' | 'deleted' = 'modified';
            if (!original && modified) status = 'added';
            else if (original && !modified) status = 'deleted';

            return {
              path: filePath,
              original,
              modified,
              status,
            };
          } catch {
            return {
              path: filePath,
              original: '',
              modified: '',
              status: 'modified' as const,
            };
          }
        })
      );

      setDiffFiles(loaded);
      setSelectedPath((prev) => (prev && loaded.some((f) => f.path === prev) ? prev : loaded[0]?.path || null));
    } catch (err) {
      console.error('Error loading changes review', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, activeFiles]);

  useEffect(() => {
    if (!isOpen) return;
    // Defer the load to a microtask so state updates don't run synchronously
    // inside the effect body; ignore the run if the effect was torn down.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void loadChangesAndCheckpoints();
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, loadChangesAndCheckpoints]);

  const handleRevert = async () => {
    if (!selectedSha && checkpoints.length === 0) return;
    const shaToRevert = selectedSha || checkpoints[0]?.sha;
    if (!shaToRevert) return;

    if (!confirm('Are you sure you want to revert files to this checkpoint? Current uncommitted changes in this turn will be undone.')) {
      return;
    }

    setReverting(true);
    try {
      const res = await fetch('/api/git/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, sha: shaToRevert }),
      });
      const data = await res.json();
      if (data.success) {
        onRollbackComplete?.();
        onReverted?.();
        onClose();
      } else {
        alert(data.error || 'Failed to revert checkpoint');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Revert failed');
    } finally {
      setReverting(false);
    }
  };

  if (!isOpen) return null;

  const currentDiff = diffFiles.find((f) => f.path === selectedPath) || diffFiles[0];

  return (
    <>
      <div className="crm-backdrop" onClick={onClose} />
      <div className="crm-modal" role="dialog" aria-modal="true" aria-labelledby="crm-title">
        {/* Header */}
        <div className="crm-header">
          <div className="crm-title-area">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18} className="crm-icon">
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <h3 id="crm-title" className="crm-title">Review changes</h3>
            <span className="crm-count-badge">
              {diffFiles.length} file{diffFiles.length === 1 ? '' : 's'} changed
            </span>
          </div>

          <div className="crm-header-actions">
            <div className="crm-view-toggles">
              <button
                type="button"
                className={`crm-toggle-btn ${viewMode === 'side-by-side' ? 'crm-toggle-btn--active' : ''}`}
                onClick={() => setViewMode('side-by-side')}
              >
                Split
              </button>
              <button
                type="button"
                className={`crm-toggle-btn ${viewMode === 'inline' ? 'crm-toggle-btn--active' : ''}`}
                onClick={() => setViewMode('inline')}
              >
                Unified
              </button>
            </div>

            <button type="button" className="crm-close-btn" onClick={onClose} title="Close" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width={14} height={14} aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="crm-body">
          {/* Left: Files & Checkpoints sidebar */}
          <div className="crm-sidebar">
            <div className="crm-sidebar-section">
              <div className="crm-sidebar-label">Changed files</div>
              {loading ? (
                <div className="crm-empty-state">Loading changes…</div>
              ) : diffFiles.length === 0 ? (
                <div className="crm-empty-state">No uncommitted changes.</div>
              ) : (
                <div className="crm-file-list">
                  {diffFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      className={`crm-file-item ${file.path === currentDiff?.path ? 'crm-file-item--active' : ''}`}
                      onClick={() => setSelectedPath(file.path)}
                    >
                      <span className={`crm-file-badge crm-file-badge--${file.status}`}>
                        {file.status === 'added' ? '+' : file.status === 'deleted' ? '-' : 'M'}
                      </span>
                      <span className="crm-file-name" title={file.path}>
                        {file.path.split('/').pop()}
                      </span>
                      <span className="crm-file-dir" title={file.path}>
                        {file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Checkpoint rollbacks */}
            {checkpoints.length > 0 && (
              <div className="crm-sidebar-section crm-sidebar-section--checkpoints">
                <div className="crm-sidebar-label">Checkpoints</div>
                <div className="crm-checkpoint-list">
                  {checkpoints.slice(0, 8).map((cp) => (
                    <button
                      key={cp.sha}
                      type="button"
                      className={`crm-checkpoint-item ${selectedSha === cp.sha ? 'crm-checkpoint-item--active' : ''}`}
                      onClick={() => setSelectedSha(cp.sha)}
                    >
                      <span className="crm-cp-sha">{cp.sha.slice(0, 7)}</span>
                      <span className="crm-cp-msg" title={cp.message}>
                        {cp.message.replace(/^checkpoint:\s*/i, '')}
                      </span>
                      <span className="crm-cp-time">
                        {new Date(cp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Monaco Diff Editor */}
          <div className="crm-editor-area">
            {currentDiff ? (
              <>
                <div className="crm-editor-bar">
                  <span className="crm-active-file-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={12} height={12} aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    {currentDiff.path}
                  </span>
                  <div className="crm-diff-legend">
                    <span className="crm-legend-item crm-legend-item--red">Original (HEAD)</span>
                    <span className="crm-legend-sep">→</span>
                    <span className="crm-legend-item crm-legend-item--green">Modified</span>
                  </div>
                </div>
                <div className="crm-diff-container">
                  <MonacoDiffEditor
                    original={currentDiff.original}
                    modified={currentDiff.modified}
                    language={languageFor(currentDiff.path)}
                    theme={typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark'}
                    options={{
                      readOnly: true,
                      renderSideBySide: viewMode === 'side-by-side',
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      fontSize: 12.5,
                      lineNumbers: 'on',
                      wordWrap: 'on',
                      automaticLayout: true,
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="crm-no-diff">
                <p>Select a changed file to view its diff.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer controls */}
        <div className="crm-footer">
          <div className="crm-footer-left">
            {selectedSha && (
              <button
                type="button"
                className="crm-btn crm-btn--revert"
                onClick={handleRevert}
                disabled={reverting}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                {reverting ? 'Reverting workspace…' : `Roll back to ${selectedSha.slice(0, 7)}`}
              </button>
            )}
          </div>

          <div className="crm-footer-right">
            <button type="button" className="crm-btn crm-btn--ghost" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .crm-backdrop {
          position: fixed;
          inset: 0;
          background: var(--scrim);
          z-index: 1000;
        }

        .crm-modal {
          position: fixed;
          top: 4%;
          left: 4%;
          right: 4%;
          bottom: 4%;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          z-index: 1001;
          box-shadow: var(--shadow-lg);
          overflow: hidden;
          font-family: var(--font-sans);
        }

        .crm-header {
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .crm-title-area {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .crm-icon {
          color: var(--text-muted);
        }

        .crm-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        .crm-count-badge {
          font-size: 12px;
          color: var(--text-muted);
        }

        .crm-header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .crm-view-toggles {
          display: flex;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 2px;
          gap: 2px;
        }

        .crm-toggle-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 500;
          padding: 3px 10px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .crm-toggle-btn:hover {
          color: var(--text-primary);
        }

        .crm-toggle-btn--active {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }

        .crm-close-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--text-muted);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .crm-close-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .crm-body {
          flex: 1;
          display: flex;
          min-height: 0;
          overflow: hidden;
        }

        .crm-sidebar {
          width: 280px;
          border-right: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          flex-shrink: 0;
        }

        .crm-sidebar-section {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .crm-sidebar-section--checkpoints {
          border-top: 1px solid var(--border-subtle);
        }

        .crm-sidebar-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-muted);
          margin-bottom: 4px;
          padding: 0 4px;
        }

        .crm-empty-state {
          font-size: 12px;
          color: var(--text-muted);
          padding: 8px 4px;
          line-height: 1.4;
        }

        .crm-file-list,
        .crm-checkpoint-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .crm-file-item,
        .crm-checkpoint-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 8px;
          border-radius: var(--radius-md);
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: background var(--transition-fast);
        }

        .crm-file-item:hover,
        .crm-checkpoint-item:hover {
          background: var(--bg-hover);
        }

        .crm-file-item--active,
        .crm-file-item--active:hover,
        .crm-checkpoint-item--active,
        .crm-checkpoint-item--active:hover {
          background: var(--bg-overlay);
        }

        .crm-file-badge {
          font-size: 11px;
          font-weight: 600;
          font-family: var(--font-mono);
          width: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .crm-file-badge--modified {
          color: var(--warning);
        }

        .crm-file-badge--added {
          color: var(--success);
        }

        .crm-file-badge--deleted {
          color: var(--error);
        }

        .crm-file-name {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .crm-file-dir {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          margin-left: auto;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 90px;
        }

        .crm-cp-sha {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .crm-cp-msg {
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }

        .crm-cp-time {
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .crm-editor-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          background: var(--bg-base);
        }

        .crm-editor-bar {
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 14px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .crm-active-file-title {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-family: var(--font-mono);
          color: var(--text-primary);
        }

        .crm-active-file-title :global(svg) {
          color: var(--text-muted);
        }

        .crm-diff-legend {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
        }

        .crm-legend-item--red { color: var(--error); }
        .crm-legend-item--green { color: var(--success); }
        .crm-legend-sep { color: var(--text-muted); }

        .crm-diff-container {
          flex: 1;
          min-height: 0;
          position: relative;
        }

        .crm-no-diff {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          font-size: 13px;
        }

        .crm-footer {
          height: 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          background: var(--bg-surface);
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .crm-footer-left,
        .crm-footer-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .crm-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-sans);
          font-size: 12.5px;
          font-weight: 500;
          padding: 6px 12px;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
        }

        .crm-btn--revert {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border-base);
        }

        .crm-btn--revert:hover:not(:disabled) {
          background: var(--bg-hover);
          border-color: var(--border-strong);
          color: var(--error);
        }

        .crm-btn--revert:disabled {
          color: var(--text-disabled);
          cursor: not-allowed;
        }

        .crm-btn--ghost {
          background: var(--bg-elevated);
          color: var(--text-primary);
          border: 1px solid var(--border-base);
        }

        .crm-btn--ghost:hover {
          background: var(--bg-hover);
          border-color: var(--border-strong);
        }

        .crm-toggle-btn:focus-visible,
        .crm-close-btn:focus-visible,
        .crm-file-item:focus-visible,
        .crm-checkpoint-item:focus-visible,
        .crm-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        @media (prefers-reduced-motion: reduce) {
          .crm-toggle-btn,
          .crm-close-btn,
          .crm-file-item,
          .crm-checkpoint-item,
          .crm-btn {
            transition: none;
          }
        }
      `}</style>
    </>
  );
}
