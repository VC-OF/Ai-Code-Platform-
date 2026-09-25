'use client';

import { useEffect, useRef } from 'react';

interface MobileDrawerProps {
  open:       boolean;
  onClose:    () => void;
  title?:     string;
  children:   React.ReactNode;
  side?:      'left' | 'bottom';
}

export default function MobileDrawer({
  open,
  onClose,
  title,
  children,
  side = 'left',
}: MobileDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Prevent scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`mob-backdrop ${open ? 'mob-backdrop--open' : ''}`}
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`mob-drawer mob-drawer--${side} ${open ? 'mob-drawer--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Handle (bottom drawer) */}
        {side === 'bottom' && (
          <div className="mob-drawer-handle-wrap" onClick={onClose}>
            <div className="mob-drawer-handle" />
          </div>
        )}

        {/* Header */}
        {title && (
          <div className="mob-drawer-header">
            <span className="mob-drawer-title">{title}</span>
            <button
              type="button"
              className="mob-drawer-close"
              onClick={onClose}
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div className="mob-drawer-content">
          {children}
        </div>
      </div>

      <style jsx>{`
        .mob-backdrop {
          position: fixed;
          inset: 0;
          background: transparent;
          opacity: 0;
          z-index: 100;
          pointer-events: none;
          transition: opacity var(--transition-base);
        }

        .mob-backdrop--open {
          background: var(--text-primary);
          opacity: 0.32;
          pointer-events: all;
        }

        /* ── Left drawer ─── */
        .mob-drawer--left {
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          width: min(300px, 85vw);
          background: var(--bg-surface);
          border-right: 1px solid var(--border-subtle);
          z-index: 101;
          transform: translateX(-100%);
          transition: transform var(--transition-slow);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .mob-drawer--left.mob-drawer--open {
          transform: translateX(0);
          box-shadow: var(--shadow-lg);
        }

        /* ── Bottom drawer ─── */
        .mob-drawer--bottom {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          max-height: 85vh;
          background: var(--bg-surface);
          border-top: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          z-index: 101;
          transform: translateY(100%);
          transition: transform var(--transition-slow);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding-bottom: env(safe-area-inset-bottom, 0);
        }

        .mob-drawer--bottom.mob-drawer--open {
          transform: translateY(0);
          box-shadow: var(--shadow-lg);
        }

        .mob-drawer-handle-wrap {
          display: flex;
          justify-content: center;
          padding: 12px 0 8px;
          cursor: pointer;
        }

        .mob-drawer-handle {
          width: 36px;
          height: 4px;
          background: var(--border-strong);
          border-radius: var(--radius-full);
        }

        .mob-drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px 10px 16px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .mob-drawer-title {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .mob-drawer-close {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          border-radius: var(--radius-md);
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .mob-drawer-close:focus-visible {
          outline: 2px solid var(--accent);
        }

        .mob-drawer-close:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .mob-drawer-content {
          flex: 1;
          overflow-y: auto;
        }
      `}</style>
    </>
  );
}
