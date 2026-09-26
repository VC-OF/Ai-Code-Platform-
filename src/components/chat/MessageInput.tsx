'use client';

import { useRef, useEffect, useState } from 'react';
import {
  formatSlashUsage,
  getSlashQuery,
  matchSlashCommands,
  SLASH_COMMANDS,
  type SlashCommandDefinition,
} from '@/lib/slashCommands';

export const VIM_STORAGE_KEY = 'oc-vim-mode';
export const VIM_TOGGLE_EVENT = 'oc-vim-toggle';

function readVimEnabled(): boolean {
  try {
    return localStorage.getItem(VIM_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Start index of the word before `pos` (vim `b`). */
function prevWordStart(text: string, pos: number): number {
  let i = Math.max(0, pos - 1);
  while (i > 0 && /\s/.test(text[i])) i--;
  while (i > 0 && /\S/.test(text[i - 1])) i--;
  return i;
}

/** Start index of the next word after `pos` (vim `w`). */
function nextWordStart(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && /\S/.test(text[i])) i++;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

/** [start, end) of the line containing `pos` (end excludes the newline). */
function lineBounds(text: string, pos: number): { start: number; end: number } {
  const start = pos === 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1;
  const nl = text.indexOf('\n', pos);
  return { start, end: nl === -1 ? text.length : nl };
}

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
  /** Project commands from .claude/commands/*.md, merged into autocomplete */
  extraCommands?: SlashCommandDefinition[];
}

export default function MessageInput({
  value,
  onChange,
  onSend,
  onCancel,
  isStreaming,
  activeFile,
  disabled,
  extraCommands,
}: MessageInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // ── Vim keybindings (toggled by /vim, persisted in localStorage) ─────────
  const [vimEnabled, setVimEnabled] = useState(false);
  const [vimMode, setVimMode] = useState<'insert' | 'normal'>('insert');
  const pendingVimOp = useRef<string | null>(null);

  useEffect(() => {
    // Deferred so the first client render matches the server markup
    const id = requestAnimationFrame(() => setVimEnabled(readVimEnabled()));
    const onToggle = (e: Event) => {
      setVimEnabled((e as CustomEvent<{ enabled?: boolean }>).detail?.enabled === true);
      setVimMode('insert');
    };
    window.addEventListener(VIM_TOGGLE_EVENT, onToggle);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener(VIM_TOGGLE_EVENT, onToggle);
    };
  }, []);

  const setCursor = (pos: number) => {
    const el = ref.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(pos, el.value.length));
    el.setSelectionRange(clamped, clamped);
  };

  /** Apply a text edit, then place the caret once React has re-rendered. */
  const editText = (next: string, caret: number) => {
    onChange(next);
    requestAnimationFrame(() => setCursor(caret));
  };

  /** Returns true when the key was consumed by normal mode. */
  const handleVimNormalKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const el = e.currentTarget;
    const pos = el.selectionStart ?? 0;
    const text = el.value;
    const { start, end } = lineBounds(text, pos);
    const op = pendingVimOp.current;
    pendingVimOp.current = null;

    if (op === 'd' && e.key === 'd') {
      // Delete the whole line including one adjacent newline
      const removeStart = end >= text.length && start > 0 ? start - 1 : start;
      const removeEnd = end < text.length ? end + 1 : end;
      editText(text.slice(0, removeStart) + text.slice(removeEnd), removeStart);
      return true;
    }

    switch (e.key) {
      case 'h': case 'ArrowLeft': setCursor(Math.max(start, pos - 1)); return true;
      case 'l': case 'ArrowRight': setCursor(Math.min(end, pos + 1)); return true;
      case '0': case 'Home': setCursor(start); return true;
      case '$': case 'End': setCursor(end); return true;
      case 'w': setCursor(nextWordStart(text, pos)); return true;
      case 'b': setCursor(prevWordStart(text, pos)); return true;
      case 'x':
        if (pos < end) editText(text.slice(0, pos) + text.slice(pos + 1), pos);
        return true;
      case 'd': pendingVimOp.current = 'd'; return true;
      case 'i': setVimMode('insert'); return true;
      case 'a': setVimMode('insert'); setCursor(Math.min(end, pos + 1)); return true;
      case 'A': setVimMode('insert'); setCursor(end); return true;
      case 'I': setVimMode('insert'); setCursor(start); return true;
      default:
        // Swallow other printable keys so normal mode never inserts text
        return e.key.length === 1;
    }
  };

  // ── Slash-command autocomplete ─────────────────────────────────────────
  const slashQuery = getSlashQuery(value);
  const slashMatches: SlashCommandDefinition[] = slashQuery === null
    ? []
    : matchSlashCommands(slashQuery, extraCommands?.length ? [...SLASH_COMMANDS, ...extraCommands] : SLASH_COMMANDS);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [prevSlashQuery, setPrevSlashQuery] = useState<string | null>(null);
  if (slashQuery !== prevSlashQuery) {
    // Reset the highlight when the filter changes (adjust during render)
    setPrevSlashQuery(slashQuery);
    setActiveIndex(0);
  }
  const popoverOpen = slashMatches.length > 0 && dismissedFor !== value;
  const activeCommand = popoverOpen ? slashMatches[Math.min(activeIndex, slashMatches.length - 1)] : undefined;
  const optionId = (name: string) => `slash-option-${name}`;

  useEffect(() => {
    if (!activeCommand) return;
    document.getElementById(`slash-option-${activeCommand.name}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeCommand]);

  const completeCommand = (command: SlashCommandDefinition) => {
    const next = command.args ? `/${command.name} ` : `/${command.name}`;
    onChange(next);
    requestAnimationFrame(() => {
      ref.current?.focus();
      setCursor(next.length);
    });
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popoverOpen && activeCommand) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((i) => (i + delta + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        completeCommand(activeCommand);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const typed = value.slice(1).toLowerCase();
        const exact = typed === activeCommand.name || !!activeCommand.aliases?.includes(typed);
        if (exact && !activeCommand.argsRequired) {
          onSend(attachments);
          setAttachments([]);
        } else {
          completeCommand(activeCommand);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedFor(value);
        return;
      }
    }

    if (vimEnabled) {
      if (vimMode === 'insert' && e.key === 'Escape') {
        e.preventDefault();
        setVimMode('normal');
        pendingVimOp.current = null;
        // Vim steps the caret one left when leaving insert mode
        const pos = e.currentTarget.selectionStart ?? 0;
        const { start } = lineBounds(e.currentTarget.value, pos);
        setCursor(Math.max(start, pos - 1));
        return;
      }
      if (vimMode === 'normal' && handleVimNormalKey(e)) {
        e.preventDefault();
        return;
      }
    }

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
      {popoverOpen && (
        <div className="slash-popover" role="listbox" id="slash-command-listbox" aria-label="Slash commands">
          {slashMatches.map((command, index) => {
            const active = command === activeCommand;
            return (
              <div
                key={command.name}
                id={optionId(command.name)}
                role="option"
                aria-selected={active}
                className={`slash-option ${active ? 'slash-option--active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => {
                  // Keep focus in the textarea
                  e.preventDefault();
                  completeCommand(command);
                }}
              >
                <span className="slash-option-name">{formatSlashUsage(command)}</span>
                <span className="slash-option-desc">{command.description}</span>
              </div>
            );
          })}
        </div>
      )}

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
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={popoverOpen}
        aria-controls={popoverOpen ? 'slash-command-listbox' : undefined}
        aria-activedescendant={activeCommand ? optionId(activeCommand.name) : undefined}
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

        {vimEnabled && (
          <span className={`vim-indicator ${vimMode === 'normal' ? 'vim-indicator--normal' : ''}`} aria-live="polite">
            {vimMode === 'normal' ? 'NORMAL' : 'INSERT'}
          </span>
        )}
        <span className="input-shortcut-hint">Ctrl + Enter to send · / for commands</span>

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
          position: relative;
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

        .slash-popover {
          position: absolute;
          left: 0;
          right: 0;
          bottom: calc(100% + 6px);
          max-height: 272px;
          overflow-y: auto;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          padding: 4px;
          z-index: 20;
        }

        .slash-option {
          display: flex;
          align-items: baseline;
          gap: 10px;
          padding: 6px 8px;
          border-radius: var(--radius-sm);
          cursor: pointer;
        }

        .slash-option--active {
          background: var(--bg-hover);
        }

        .slash-option-name {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-primary);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .slash-option-desc {
          font-size: 12px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vim-indicator {
          font-family: var(--font-mono);
          font-size: 10.5px;
          letter-spacing: 0.04em;
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 1px 6px;
          margin-left: 6px;
        }

        .vim-indicator--normal {
          color: var(--text-primary);
          border-color: var(--border-strong);
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
