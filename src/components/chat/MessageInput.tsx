'use client';

import { useRef, useEffect, useState } from 'react';

interface Attachment {
  id: string;
  name: string;
  type: string;
  content: string; // base64 for images, raw text for files
}

interface MessageInputProps {
  value:         string;
  onChange:      (v: string) => void;
  onSend:        (attachments: Attachment[]) => void;
  onCancel:      () => void;
  isStreaming:   boolean;
  activeFile?:   string | null;
  disabled?:     boolean;
}

export default function MessageInput({
  value,
  onChange,
  onSend,
  onCancel,
  isStreaming,
  activeFile,
  disabled,
}: MessageInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Auto-resize textarea
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      const canSend = value.trim() || attachments.length > 0;
      if (canSend) {
        onSend(attachments);
        setAttachments([]);
      }
    }
    if (e.key === 'Escape' && isStreaming) {
      onCancel();
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).substr(2, 9),
            name: file.name,
            type: file.type,
            content: reader.result as string,
          }
        ]);
      };
      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
    // Clear input value so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
  };

  const handleSendClick = () => {
    onSend(attachments);
    setAttachments([]);
  };

  const canSend = value.trim() || attachments.length > 0;

  return (
    <div className="input-area">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Active file context badge */}
      {activeFile && (
        <div className="context-badge">
          <span className="context-icon">📄</span>
          <span className="context-path">{activeFile}</span>
          <span className="context-label">active</span>
        </div>
      )}

      {/* Pane title */}
      <div className="input-title">WHAT DO YOU WANT TO BUILD?</div>

      {/* Attachments preview row */}
      {attachments.length > 0 && (
        <div className="attachments-preview-list">
          {attachments.map((att) => (
            <div key={att.id} className="attachment-preview-card">
              {att.type.startsWith('image/') ? (
                <img src={att.content} alt={att.name} className="attachment-preview-thumb" />
              ) : (
                <span className="attachment-preview-icon">📄</span>
              )}
              <span className="attachment-preview-name" title={att.name}>{att.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                className="btn-remove-attachment"
                title="Remove attachment"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="input-row">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isStreaming
              ? 'Reply, steer, or answer the agent…'
              : 'Describe what to build...'
          }
          disabled={disabled}
          rows={1}
          className="input-textarea"
        />

        <div className="input-action-buttons">
          {!isStreaming && (
            <button
              type="button"
              onClick={triggerFileInput}
              className="btn-attach"
              title="Attach files or images"
              disabled={disabled}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
          )}

          {isStreaming && (
            <button onClick={onCancel} className="btn-stop" title="Stop execution (Esc)">
              <span className="stop-icon">■</span>
            </button>
          )}
          <button
            onClick={handleSendClick}
            disabled={disabled || !canSend}
            className="btn-send"
            title={isStreaming ? 'Send to the running agent' : 'Send instruction'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={13} height={13}>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      <span className="input-shortcut-hint">(Cmd + Enter to send)</span>

      <style jsx>{`
        .input-area {
          background: rgba(18, 18, 23, 0.45);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex-shrink: 0;
        }

        .input-title {
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          font-weight: 600;
          margin-bottom: 2px;
        }

        .context-badge {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          padding: 4px var(--space-2);
          background: var(--brand-glow);
          border: 1px solid rgba(0, 122, 255, 0.25);
          border-radius: var(--radius-sm);
          width: fit-content;
          max-width: 100%;
        }

        .context-icon { font-size: 11px; }

        .context-path {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .context-label {
          font-size: 9px;
          text-transform: uppercase;
          color: var(--brand);
          font-weight: 700;
          letter-spacing: 0.05em;
        }

        /* Attachments list style */
        .attachments-preview-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 4px;
        }

        .attachment-preview-card {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          padding: 4px 8px;
          position: relative;
          max-width: 180px;
        }

        .attachment-preview-thumb {
          width: 20px;
          height: 20px;
          object-fit: cover;
          border-radius: 4px;
          border: 1px solid var(--border-subtle);
        }

        .attachment-preview-icon {
          font-size: 12px;
        }

        .attachment-preview-name {
          font-size: 10.5px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 110px;
        }

        .btn-remove-attachment {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          padding: 0 2px;
          line-height: 1;
          display: flex;
          align-items: center;
          transition: color var(--transition-fast);
        }

        .btn-remove-attachment:hover {
          color: var(--error);
        }

        .input-row {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          padding: 8px 12px;
          transition: all var(--transition-fast);
        }

        .input-row:focus-within {
          border-color: rgba(255, 255, 255, 0.15);
        }

        .input-textarea {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          resize: none;
          color: var(--text-primary);
          font-family: var(--font-sans);
          font-size: 12.5px;
          line-height: 1.5;
          min-height: 20px;
          max-height: 120px;
        }

        .input-textarea::placeholder {
          color: var(--text-muted);
        }

        .input-action-buttons {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .btn-attach {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: 50%;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-attach:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.1);
          border-color: var(--border-base);
          color: var(--text-primary);
        }

        .btn-attach:disabled {
          opacity: 0.25;
          cursor: not-allowed;
        }

        .btn-send,
        .btn-stop {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 50%;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-send {
          background: #ffffff;
          color: #000000;
        }

        .btn-send:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.85);
        }

        .btn-send:disabled {
          opacity: 0.25;
          cursor: not-allowed;
        }

        .btn-stop {
          background: var(--error);
          color: white;
        }

        .stop-icon {
          font-size: 8px;
          font-weight: 700;
        }

        .input-shortcut-hint {
          font-size: 10px;
          color: var(--text-muted);
          margin-top: -6px;
          margin-bottom: 4px;
        }
      `}</style>
    </div>
  );
}
