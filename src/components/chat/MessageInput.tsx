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
        <div className="context-badge" title="Active file is included as context">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={11} height={11} aria-hidden="true">
            <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" />
          </svg>
          <span className="context-path">{activeFile}</span>
        </div>
      )}

      {/* Attachments preview row */}
      {attachments.length > 0 && (
        <div className="attachments-preview-list">
          {attachments.map((att) => (
            <div key={att.id} className="attachment-preview-card">
              {att.type.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
                <img src={att.content} alt={att.name} className="attachment-preview-thumb" />
              ) : (
                <svg className="attachment-preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={12} aria-hidden="true">
                  <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" />
                </svg>
              )}
              <span className="attachment-preview-name" title={att.name}>{att.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                className="btn-remove-attachment"
                title="Remove attachment"
                aria-label={`Remove ${att.name}`}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isStreaming
            ? 'Reply, steer, or answer the agent…'
            : 'Describe what to build…'
        }
        disabled={disabled}
        rows={1}
        className="input-textarea"
        aria-label="Message"
      />

      {/* Toolbar */}
      <div className="input-toolbar">
        {!isStreaming && (
          <>
            <button
              type="button"
              onClick={triggerFileInput}
              className="btn-attach"
              title="Attach files or images"
              aria-label="Attach files or images"
              disabled={disabled}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              type="button"
              onClick={captureScreenshot}
              className="btn-attach"
              title="Capture a screenshot"
              aria-label="Capture a screenshot"
              disabled={disabled}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
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
              aria-pressed={isListening}
              disabled={disabled}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0014 0M12 18v4M8 22h8" />
              </svg>
            </button>
          </>
        )}

        <span className="input-shortcut-hint">Ctrl + Enter to send</span>

        {isStreaming && (
          <button type="button" onClick={onCancel} className="btn-stop" title="Stop (Esc)" aria-label="Stop">
            <svg viewBox="0 0 24 24" width={10} height={10} aria-hidden="true">
              <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={handleSendClick}
          disabled={disabled || !canSend}
          className="btn-send"
          title={isStreaming ? 'Send to the running agent' : 'Send'}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={14} height={14}>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>

      <style jsx>{`
        .input-area {
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: 14px;
          padding: 10px 10px 8px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex-shrink: 0;
          transition: border-color var(--transition-fast);
        }

        .input-area:focus-within {
          border-color: var(--border-strong);
        }

        .context-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 2px 8px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-full);
          color: var(--text-muted);
          width: fit-content;
          max-width: 100%;
        }

        .context-path {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .attachments-preview-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .attachment-preview-card {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 4px 6px 4px 8px;
          max-width: 200px;
        }

        .attachment-preview-thumb {
          width: 20px;
          height: 20px;
          object-fit: cover;
          border-radius: 4px;
          border: 1px solid var(--border-subtle);
        }

        .attachment-preview-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .attachment-preview-name {
          font-size: 11.5px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 130px;
        }

        .btn-remove-attachment {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 14px;
          cursor: pointer;
          padding: 0 2px;
          line-height: 1;
          display: flex;
          align-items: center;
          border-radius: var(--radius-sm);
          transition: color var(--transition-fast);
        }

        .btn-remove-attachment:hover {
          color: var(--text-primary);
        }

        .input-textarea {
          width: 100%;
          background: none;
          border: none;
          outline: none;
          resize: none;
          color: var(--text-primary);
          font-family: var(--font-sans);
          font-size: 13.5px;
          line-height: 1.5;
          min-height: 22px;
          max-height: 160px;
          padding: 2px 0;
        }

        .input-textarea::placeholder {
          color: var(--text-muted);
        }

        .input-toolbar {
          display: flex;
          align-items: center;
          gap: 2px;
        }

        .btn-attach {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: var(--text-muted);
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .btn-attach:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .btn-attach:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .btn-attach--active {
          color: var(--text-primary);
          background: var(--bg-overlay);
        }

        .btn-send,
        .btn-stop {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          flex-shrink: 0;
          transition: background var(--transition-fast), opacity var(--transition-fast);
        }

        .btn-send {
          background: var(--accent);
          color: #fff;
          margin-left: 4px;
        }

        .btn-send:hover:not(:disabled) {
          background: var(--accent-dim);
        }

        .btn-send:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        .btn-stop {
          background: var(--bg-elevated);
          color: var(--text-primary);
          border: 1px solid var(--border-base);
        }

        .btn-stop:hover {
          background: var(--bg-overlay);
        }

        .btn-attach:focus-visible,
        .btn-send:focus-visible,
        .btn-stop:focus-visible,
        .btn-remove-attachment:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        .input-shortcut-hint {
          margin-left: auto;
          margin-right: 6px;
          font-size: 11px;
          color: var(--text-disabled);
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
