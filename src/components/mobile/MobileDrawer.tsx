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
              className="mob-drawer-close"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
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
          background: rgba(0, 0, 0, 0);
          z-index: 100;
          pointer-events: none;
          transition: background var(--transition-base);
        }

        .mob-backdrop--open {
          background: rgba(0, 0, 0, 0.6);
          pointer-events: all;
          backdrop-filter: blur(2px);
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
          border-radius: var(--radius-xl) var(--radius-xl) 0 0;
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
          box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
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
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .mob-drawer-title {
          font-size: var(--text-base);
          font-weight: 600;
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
          border-radius: var(--radius-sm);
          font-size: 12px;
          transition: all var(--transition-fast);
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
