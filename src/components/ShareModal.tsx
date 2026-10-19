'use client';

import { useState, useEffect } from 'react';
import type { Project } from '@/types';

interface ShareModalProps {
  project: Project;
  onClose: () => void;
}

export default function ShareModal({ project, onClose }: ShareModalProps) {
  const [isPublic, setIsPublic] = useState(Boolean(project.isPublic));
  const [shareToken, setShareToken] = useState<string | null>(project.shareToken || null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function fetchShareStatus() {
      try {
        const res = await fetch(`/api/projects/${project.id}/share`);
        if (res.ok) {
          const data = await res.json();
          if (!ignore) {
            setIsPublic(Boolean(data.isPublic));
            setShareToken(data.shareToken || null);
          }
        }
      } catch {}
    }
    fetchShareStatus();
    return () => {
      ignore = true;
    };
  }, [project.id]);

  const toggleShare = async (enable: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: enable }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update share settings');
      setIsPublic(Boolean(data.isPublic));
      setShareToken(data.shareToken || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const shareUrl = typeof window !== 'undefined' && shareToken
    ? `${window.location.origin}/api/share/${shareToken}`
    : '';

  const copyToClipboard = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="share-header">
          <div className="share-title-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <h3>Share Project</h3>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className="share-body">
          {error && <div className="share-error">{error}</div>}

          <div className="project-badge">
            <span className="project-name">{project.title}</span>
            <span className="project-id">{project.id}</span>
          </div>

          <div className="share-toggle-row">
            <div className="toggle-info">
              <span className="toggle-label">Public Link Access</span>
              <p className="toggle-desc">
                {isPublic
                  ? 'Anyone with the unique link can view this workspace in read-only mode.'
                  : 'Workspace is private. Only you can view and edit.'}
              </p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => toggleShare(e.target.checked)}
                disabled={loading}
              />
              <span className="slider round" />
            </label>
          </div>

          {isPublic && shareUrl && (
            <div className="share-link-box">
              <label>Public Share URL</label>
              <div className="copy-input-row">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="link-input"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  className={`copy-btn ${copied ? 'copied' : ''}`}
                  onClick={copyToClipboard}
                >
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="share-footer">
          <button type="button" className="btn-close" onClick={onClose}>
            Done
          </button>
        </div>

        <style jsx>{`
          .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.65);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
          }
          .share-modal {
            background: var(--bg-surface, #1e1e24);
            border: 1px solid var(--border-subtle, #333);
            border-radius: 12px;
            width: 480px;
            max-width: 92vw;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            color: var(--text-primary, #f3f4f6);
          }
          .share-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            border-bottom: 1px solid var(--border-subtle, #333);
            background: var(--bg-elevated, #25252d);
          }
          .share-title-row {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
          }
          .share-title-row h3 {
            margin: 0;
            font-size: 15px;
          }
          .close-btn {
            background: none;
            border: none;
            color: var(--text-muted, #9ca3af);
            font-size: 20px;
            cursor: pointer;
            line-height: 1;
          }
          .close-btn:hover {
            color: #fff;
          }
          .share-body {
            padding: 18px;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .share-error {
            padding: 8px 12px;
            background: rgba(239, 68, 68, 0.15);
            border-left: 3px solid #ef4444;
            color: #fca5a5;
            font-size: 12px;
            border-radius: 4px;
          }
          .project-badge {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--bg-base, #141418);
            border: 1px solid var(--border-subtle, #333);
            border-radius: 8px;
            padding: 8px 12px;
          }
          .project-name {
            font-weight: 600;
            font-size: 13px;
          }
          .project-id {
            font-family: var(--font-mono, monospace);
            font-size: 11px;
            color: var(--text-muted, #9ca3af);
          }
          .share-toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 10px 0;
            border-top: 1px solid var(--border-subtle, #2c2c36);
            border-bottom: 1px solid var(--border-subtle, #2c2c36);
          }
          .toggle-label {
            font-size: 13px;
            font-weight: 600;
          }
          .toggle-desc {
            margin: 2px 0 0;
            font-size: 12px;
            color: var(--text-muted, #9ca3af);
          }
          .switch {
            position: relative;
            display: inline-block;
            width: 44px;
            height: 24px;
            flex-shrink: 0;
          }
          .switch input {
            opacity: 0;
            width: 0;
            height: 0;
          }
          .slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: #3f3f46;
            transition: 0.2s;
            border-radius: 24px;
          }
          .slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: 0.2s;
            border-radius: 50%;
          }
          input:checked + .slider {
            background-color: #3b82f6;
          }
          input:checked + .slider:before {
            transform: translateX(20px);
          }
          .share-link-box {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .share-link-box label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted, #9ca3af);
          }
          .copy-input-row {
            display: flex;
            gap: 8px;
          }
          .link-input {
            flex: 1;
            background: var(--bg-base, #141418);
            border: 1px solid var(--border-subtle, #3a3a46);
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 12px;
            font-family: var(--font-mono, monospace);
            color: #93c5fd;
            outline: none;
          }
          .copy-btn {
            padding: 8px 14px;
            background: var(--accent-primary, #3b82f6);
            color: #fff;
            font-size: 12px;
            font-weight: 500;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.15s;
          }
          .copy-btn.copied {
            background: #10b981;
          }
          .share-footer {
            padding: 12px 18px;
            border-top: 1px solid var(--border-subtle, #333);
            display: flex;
            justify-content: flex-end;
            background: var(--bg-elevated, #25252d);
          }
          .btn-close {
            padding: 7px 16px;
            border-radius: 6px;
            background: var(--bg-surface, #1e1e24);
            border: 1px solid var(--border-subtle, #444);
            color: var(--text-primary, #f3f4f6);
            font-size: 12px;
            cursor: pointer;
          }
        `}</style>
      </div>
    </div>
  );
}
