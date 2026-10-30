'use client';

import React from 'react';

export interface ModeToggleProps {
  activeMode: 'code' | 'chat';
  onModeChange: (mode: 'code' | 'chat') => void;
  className?: string;
}

export default function ModeToggle({
  activeMode,
  onModeChange,
  className = '',
}: ModeToggleProps) {
  return (
    <div
      className={`mode-toggle-segment ${className}`}
      role="group"
      aria-label="Workspace mode switcher"
    >
      <button
        type="button"
        onClick={() => onModeChange('chat')}
        className={`mode-toggle-btn ${activeMode === 'chat' ? 'mode-toggle-btn--active' : ''}`}
        aria-pressed={activeMode === 'chat'}
        title="Open Chat: Conversational AI studio & Interactive Artifacts"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          width={13}
          height={13}
          className="mode-toggle-icon mode-toggle-icon--claude"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <span className="mode-toggle-label">Open Chat</span>
      </button>

      <button
        type="button"
        onClick={() => onModeChange('code')}
        className={`mode-toggle-btn ${activeMode === 'code' ? 'mode-toggle-btn--active' : ''}`}
        aria-pressed={activeMode === 'code'}
        title="Open Code: Agentic IDE, Code Editor, and Terminal"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          width={13}
          height={13}
          className="mode-toggle-icon"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        <span className="mode-toggle-label">Open Code</span>
      </button>

      {/* Plain link: delegated tasks live on their own page, not a mode */}
      <a href="/tasks" className="mode-toggle-btn" title="Tasks: delegated goals running in the background">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          width={13}
          height={13}
          className="mode-toggle-icon"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9" />
        </svg>
        <span className="mode-toggle-label">Tasks</span>
      </a>

      <style jsx>{`
        .mode-toggle-segment {
          display: inline-flex;
          align-items: center;
          padding: 2px;
          border-radius: 9px;
          background: #ebe8e0;
          border: 1px solid rgba(0, 0, 0, 0.09);
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
          height: 28px;
          flex-shrink: 0;
          user-select: none;
        }

        :global(html:not([data-theme="light"])) .mode-toggle-segment {
          background: #23221f;
          border: 1px solid #36342f;
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
        }

        .mode-toggle-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 22px;
          padding: 0 9px;
          border-radius: 7px;
          font-size: 12px;
          font-weight: 500;
          line-height: 1;
          color: #6b6962;
          background: transparent;
          border: none;
          cursor: pointer;
          transition: all 0.15s cubic-bezier(0.2, 0, 0, 1);
          white-space: nowrap;
          outline: none;
        }

        :global(html:not([data-theme="light"])) .mode-toggle-btn {
          color: #9c978b;
        }

        .mode-toggle-btn:hover:not(.mode-toggle-btn--active) {
          color: #1a1916;
        }

        :global(html:not([data-theme="light"])) .mode-toggle-btn:hover:not(.mode-toggle-btn--active) {
          color: #f7f4ee;
        }

        .mode-toggle-btn:focus-visible {
          outline: 2px solid #da7756;
          outline-offset: 1px;
        }

        .mode-toggle-btn--active {
          background: #ffffff !important;
          color: #171614 !important;
          font-weight: 600;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04);
        }

        :global(html:not([data-theme="light"])) .mode-toggle-btn--active {
          background: #ffffff !important;
          color: #171614 !important;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
        }

        .mode-toggle-icon {
          flex-shrink: 0;
          transition: transform 0.15s ease;
        }

        .mode-toggle-icon--claude {
          color: #da7756;
        }

        .mode-toggle-btn:hover .mode-toggle-icon {
          transform: scale(1.05);
        }

        @media (max-width: 640px) {
          .mode-toggle-btn {
            padding: 0 6px;
            font-size: 11px;
            gap: 4px;
          }
        }
      `}</style>
    </div>
  );
}
