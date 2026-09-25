'use client';

import { useRef, useEffect, useState } from 'react';

interface Attachment {
  id: string;
  name: string;
  type: string;
  content: string; // base64 for images, raw text for files
}

interface SpeechRecognitionResultEventLike extends Event {
  results: { length: number; [index: number]: { [index: number]: { transcript: string } } };
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  }
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
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

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

  const toggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      onChange(`${value}${value ? ' ' : ''}[Voice input is not supported by this browser]`);
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length })
        .map((_, index) => event.results[index]?.[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (transcript) onChange(`${value}${value ? ' ' : ''}${transcript}`);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const captureScreenshot = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      triggerFileInput();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = settings.width || video.videoWidth;
      canvas.height = settings.height || video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      setAttachments((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).slice(2, 11),
          name: `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
          type: 'image/png',
          content: canvas.toDataURL('image/png'),
        },
      ]);
      track.stop();
      video.srcObject = null;
    } catch {
      // The user may cancel the browser's screen-share prompt.
    }
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
        accept="image/*,.txt,.md,.json,.csv,.pdf"
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

          {!isStreaming && (
            <>
              <button
                type="button"
                onClick={captureScreenshot}
                className="btn-attach"
                title="Capture a screenshot"
                aria-label="Capture a screenshot"
                disabled={disabled}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <circle cx="12" cy="12" r="3" />
                  <path d="M8 4l1-2h6l1 2" />
                </svg>
              </button>
              <button
                type="button"
                onClick={toggleVoice}
                className={`btn-attach ${isListening ? 'btn-attach--active' : ''}`}
                title={isListening ? 'Stop voice input' : 'Start voice input'}
                aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                disabled={disabled}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 11a7 7 0 0014 0M12 18v4M8 22h8" />
                </svg>
              </button>
            </>
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
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
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
          border: 1px solid var(--accent-border);
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
          background: var(--bg-elevated);
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
          background: var(--bg-base);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          padding: 8px 12px;
          transition: all var(--transition-fast);
        }

        .input-row:focus-within {
          border-color: var(--accent-border);
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
          background: var(--bg-elevated);
          color: var(--text-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: 50%;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-attach:hover:not(:disabled) {
          background: var(--bg-hover);
          border-color: var(--border-base);
          color: var(--text-primary);
        }

        .btn-attach:disabled {
          opacity: 0.25;
          cursor: not-allowed;
        }

        .btn-attach--active {
          color: var(--brand);
          border-color: var(--accent-border);
          background: var(--brand-glow);
          animation: pulse-soft 1.4s ease-in-out infinite;
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
          background: var(--brand);
          color: #fffaf7;
        }

        .btn-send:hover:not(:disabled) {
          background: var(--brand-dim);
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
