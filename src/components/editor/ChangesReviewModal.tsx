'use client';

import { useEffect, useState, useCallback } from 'react';
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
  const activeFiles = filesChanged || changedFiles || [];
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
    if (isOpen) {
      loadChangesAndCheckpoints();
    }
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
      <div className="crm-modal animate-slide-up">
        {/* Header */}
        <div className="crm-header">
          <div className="crm-title-area">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18} className="crm-icon">
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <h3 className="crm-title">Visual Diff Review & Checkpoints</h3>
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

            <button type="button" className="crm-close-btn" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="crm-body">
          {/* Left: Files & Checkpoints sidebar */}
          <div className="crm-sidebar">
            <div className="crm-sidebar-section">
              <div className="crm-sidebar-label">CHANGED FILES</div>
              {loading ? (
                <div className="crm-empty-state">Scanning workspace diffs…</div>
              ) : diffFiles.length === 0 ? (
                <div className="crm-empty-state">No uncommitted changes detected. Workspace matches clean HEAD.</div>
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
                <div className="crm-sidebar-label">ROLLBACK CHECKPOINTS</div>
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
                    📄 {currentDiff.path}
                  </span>
                  <div className="crm-diff-legend">
                    <span className="crm-legend-item crm-legend-item--red">Original (HEAD)</span>
                    <span className="crm-legend-sep">→</span>
                    <span className="crm-legend-item crm-legend-item--green">Modified (Agent)</span>
                  </div>
                </div>
                <div className="crm-diff-container">
                  <MonacoDiffEditor
                    original={currentDiff.original}
                    modified={currentDiff.modified}
                    language={languageFor(currentDiff.path)}
                    theme="vs-dark"
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
                <p>Select a modified file to inspect unified line-by-line diffs.</p>
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
                {reverting ? 'Reverting workspace…' : `⏪ Undo Turn (Rollback to ${selectedSha.slice(0, 7)})`}
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
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(6px);
          z-index: 1000;
        }

        .crm-modal {
          position: fixed;
          top: 4%;
          left: 4%;
          right: 4%;
          bottom: 4%;
          background: var(--bg-surface, #131418);
          border: 1px solid var(--border-base, rgba(255, 255, 255, 0.15));
          border-radius: var(--radius-lg, 12px);
          display: flex;
          flex-direction: column;
          z-index: 1001;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          overflow: hidden;
        }

        .crm-header {
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 18px;
          background: var(--bg-deep, #0c0d10);
          border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
          flex-shrink: 0;
        }

        .crm-title-area {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .crm-icon {
          color: var(--brand, #f97316);
        }

        .crm-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-primary, #ffffff);
          margin: 0;
          font-family: var(--font-brand, sans-serif);
        }

        .crm-count-badge {
          font-size: 10.5px;
          font-weight: 600;
          padding: 2px 8px;
          background: rgba(249, 115, 22, 0.12);
          border: 1px solid rgba(249, 115, 22, 0.3);
          border-radius: 12px;
          color: var(--brand, #f97316);
          font-family: var(--font-mono, monospace);
        }

        .crm-header-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .crm-view-toggles {
          display: flex;
          background: var(--bg-surface, #1e1e24);
          border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
          border-radius: 6px;
          padding: 2px;
          gap: 2px;
        }

        .crm-toggle-btn {
          background: transparent;
          border: none;
          color: var(--text-muted, #94a3b8);
          font-size: 11px;
          font-weight: 500;
          padding: 3px 9px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .crm-toggle-btn:hover {
          color: var(--text-primary, #ffffff);
        }

        .crm-toggle-btn--active {
          background: var(--bg-hover, rgba(255, 255, 255, 0.12));
          color: var(--text-primary, #ffffff);
          font-weight: 600;
        }

        .crm-close-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--text-muted, #94a3b8);
          font-size: 13px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .crm-close-btn:hover {
          background: var(--bg-hover, rgba(255, 255, 255, 0.1));
          color: var(--text-primary, #ffffff);
        }

        .crm-body {
          flex: 1;
          display: flex;
          min-height: 0;
          overflow: hidden;
        }

        .crm-sidebar {
          width: 280px;
          border-right: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
          background: var(--bg-surface, #131418);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          flex-shrink: 0;
        }

        .crm-sidebar-section {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .crm-sidebar-section--checkpoints {
          border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
        }

        .crm-sidebar-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: var(--text-muted, #64748b);
          margin-bottom: 4px;
        }

        .crm-empty-state {
          font-size: 11px;
          color: var(--text-muted, #64748b);
          padding: 8px 4px;
          line-height: 1.4;
        }

        .crm-file-list {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .crm-file-item {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 6px 8px;
          border-radius: 6px;
          background: transparent;
          border: 1px solid transparent;
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: all 0.15s ease;
        }

        .crm-file-item:hover {
          background: var(--bg-hover, rgba(255, 255, 255, 0.05));
        }

        .crm-file-item--active {
          background: rgba(249, 115, 22, 0.1) !important;
          border-color: rgba(249, 115, 22, 0.3) !important;
        }

        .crm-file-badge {
          font-size: 9px;
          font-weight: 800;
          font-family: var(--font-mono, monospace);
          width: 15px;
          height: 15px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .crm-file-badge--modified {
          background: rgba(234, 179, 8, 0.18);
          color: #facc15;
        }

        .crm-file-badge--added {
          background: rgba(34, 197, 94, 0.18);
          color: #4ade80;
        }

        .crm-file-badge--deleted {
          background: rgba(239, 68, 68, 0.18);
          color: #f87171;
        }

        .crm-file-name {
          font-size: 11.5px;
          font-weight: 500;
          color: var(--text-primary, #ffffff);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .crm-file-dir {
          font-size: 9.5px;
          color: var(--text-muted, #64748b);
          margin-left: auto;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 90px;
        }

        /* Checkpoints list */
        .crm-checkpoint-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .crm-checkpoint-item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          border-radius: 6px;
          background: transparent;
          border: 1px solid transparent;
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: all 0.15s ease;
        }

        .crm-checkpoint-item:hover {
          background: var(--bg-hover, rgba(255, 255, 255, 0.05));
        }

        .crm-checkpoint-item--active {
          background: rgba(59, 130, 246, 0.12) !important;
          border-color: rgba(59, 130, 246, 0.3) !important;
        }

        .crm-cp-sha {
          font-family: var(--font-mono, monospace);
          font-size: 9.5px;
          color: #60a5fa;
          background: rgba(59, 130, 246, 0.1);
          padding: 1px 4px;
          border-radius: 3px;
          flex-shrink: 0;
        }

        .crm-cp-msg {
          font-size: 10.5px;
          color: var(--text-secondary, #cbd5e1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }

        .crm-cp-time {
          font-size: 9px;
          color: var(--text-muted, #64748b);
          flex-shrink: 0;
        }

        /* Right editor area */
        .crm-editor-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          background: var(--bg-deep, #0a0b0e);
        }

        .crm-editor-bar {
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 14px;
          background: var(--bg-surface, #131418);
          border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
          flex-shrink: 0;
        }

        .crm-active-file-title {
          font-size: 11.5px;
          font-family: var(--font-mono, monospace);
          color: var(--text-primary, #ffffff);
          font-weight: 500;
        }

        .crm-diff-legend {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          font-family: var(--font-mono, monospace);
        }

        .crm-legend-item--red { color: #f87171; }
        .crm-legend-item--green { color: #4ade80; }
        .crm-legend-sep { color: var(--text-muted, #64748b); }

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
          color: var(--text-muted, #64748b);
          font-size: 12px;
        }

        /* Footer */
        .crm-footer {
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          background: var(--bg-deep, #0c0d10);
          border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
          flex-shrink: 0;
        }

        .crm-footer-left,
        .crm-footer-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .crm-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .crm-btn--revert {
          background: rgba(239, 68, 68, 0.12);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .crm-btn--revert:hover:not(:disabled) {
          background: #ef4444;
          color: #ffffff;
        }

        .crm-btn--revert:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .crm-btn--ghost {
          background: var(--bg-surface, #1e1e24);
          color: var(--text-primary, #ffffff);
          border: 1px solid var(--border-base, rgba(255, 255, 255, 0.15));
        }

        .crm-btn--ghost:hover {
          background: var(--bg-hover, rgba(255, 255, 255, 0.1));
        }
      `}</style>
    </>
  );
}
