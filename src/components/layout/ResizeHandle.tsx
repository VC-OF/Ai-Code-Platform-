'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ResizeHandleProps {
  onResizeWidth: (width: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onToggle?: () => void;
  onEnsureOpen?: () => void;
  hasOpenPanels?: boolean;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  title?: string;
}

export default function ResizeHandle({
  onResizeWidth,
  onDragStart,
  onDragEnd,
  onToggle,
  onEnsureOpen,
  hasOpenPanels = false,
  containerRef,
  title,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const hasMoved = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Remove window listeners if unmounted mid-drag
  useEffect(() => () => cleanupRef.current?.(), []);

  const onResizeWidthRef = useRef(onResizeWidth);
  const onToggleRef = useRef(onToggle);
  const onEnsureOpenRef = useRef(onEnsureOpen);
  const hasOpenPanelsRef = useRef(hasOpenPanels);

  // Keep latest callbacks/values in refs for use inside window listeners
  useEffect(() => {
    onResizeWidthRef.current = onResizeWidth;
    onToggleRef.current = onToggle;
    onEnsureOpenRef.current = onEnsureOpen;
    hasOpenPanelsRef.current = hasOpenPanels;
  }, [onResizeWidth, onToggle, onEnsureOpen, hasOpenPanels]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // If clicking directly on a button inside the handle, let the button handle it
      if ((e.target as HTMLElement).closest('.handle-btn')) {
        return;
      }

      e.preventDefault();
      dragging.current = true;
      hasMoved.current = false;
      setIsDragging(true);
      startX.current = e.clientX;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      onDragStart?.();

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!dragging.current) return;
        const totalDelta = moveEvent.clientX - startX.current;

        // Require 3px movement before starting drag tracking to avoid accidental drag on click
        if (Math.abs(totalDelta) > 3) {
          hasMoved.current = true;
          if (!hasOpenPanelsRef.current) {
            onEnsureOpenRef.current?.();
          }

          if (containerRef?.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const targetWidth = moveEvent.clientX - rect.left;
            onResizeWidthRef.current(targetWidth);
          } else {
            onResizeWidthRef.current(moveEvent.clientX);
          }
        }
      };

      const onMouseUp = (upEvent: MouseEvent) => {
        dragging.current = false;
        setIsDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        cleanupRef.current = null;
        onDragEnd?.();

        if (!hasMoved.current) {
          // It was a click, not a drag!
          onToggleRef.current?.();
        } else if (containerRef?.current) {
          const rect = containerRef.current.getBoundingClientRect();
          // If dragged close to the right edge (within 70px), snap closed to full page
          if (rect.right - upEvent.clientX < 70) {
            onToggleRef.current?.();
          }
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      cleanupRef.current = () => {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    },
    [containerRef, onDragStart, onDragEnd]
  );

  const defaultTitle = hasOpenPanels
    ? 'Drag to resize panels • Double-click to toggle'
    : 'Drag left or click to open code editor';

  return (
    <div
      className={`resize-handle ${hasOpenPanels ? 'resize-handle--open' : 'resize-handle--edge'} ${
        isDragging ? 'resize-handle--active' : ''
      }`}
      onMouseDown={onMouseDown}
      onDoubleClick={() => onToggle?.()}
      title={title || defaultTitle}
      role="separator"
      aria-orientation="vertical"
    >
      {/* ── When panels are open: divider bar with grip & collapse mini-button ── */}
      {hasOpenPanels ? (
        <div className="resize-handle-bar">
          <div className="resize-handle-dots" title="Drag to resize">
            <span />
            <span />
            <span />
          </div>

          <button
            type="button"
            className="handle-btn handle-collapse-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
            title="Collapse panels to full-page chat"
            aria-label="Collapse panels"
          >
            ›
          </button>
        </div>
      ) : (
        /* ── When chat is full-page: prominent draggable edge tab ── */
        <div className="resize-handle-edge-tab">
          <button
            type="button"
            className="handle-btn handle-dock-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
            title="Click or drag left to open code editor"
            aria-label="Open code editor"
          >
            <span className="dock-btn-arrow">‹</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              width={13}
              height={13}
              className="dock-btn-icon"
            >
              <polyline points="16 18 22 12 16 6" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="8 6 2 12 8 18" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="dock-btn-label">Code</span>
          </button>
        </div>
      )}

      <style jsx>{`
        .resize-handle {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: col-resize;
          user-select: none;
          z-index: 40;
          transition: background var(--transition-fast, 0.15s ease);
        }
        .resize-handle--open {
          width: 5px;
          flex-shrink: 0;
          background: var(--border-subtle);
        }
        .resize-handle--edge {
          width: 8px;
          flex-shrink: 0;
          background: transparent;
        }
        .resize-handle::before {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          left: -8px;
          right: -8px;
          cursor: col-resize;
          z-index: 10;
        }
        .resize-handle:hover,
        .resize-handle--active {
          background: var(--border-strong);
        }
        .resize-handle--edge:hover,
        .resize-handle--edge.resize-handle--active {
          background: var(--bg-hover);
        }
        .resize-handle-bar {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .resize-handle-dots {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          opacity: 0.6;
          pointer-events: none;
        }
        .resize-handle-dots span {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--text-muted);
        }
        .handle-collapse-btn {
          position: absolute;
          top: 48%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 18px;
          height: 30px;
          border-radius: var(--radius-md);
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          color: var(--text-secondary);
          font-size: 13px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          pointer-events: auto;
          transition: opacity var(--transition-fast, 0.15s ease);
          z-index: 25;
        }
        .resize-handle:hover .handle-collapse-btn,
        .resize-handle--active .handle-collapse-btn,
        .handle-collapse-btn:focus-visible {
          opacity: 1;
        }
        .handle-collapse-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .resize-handle-edge-tab {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: 35;
        }
        .handle-dock-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 10px 6px 8px;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-right: none;
          border-radius: var(--radius-md) 0 0 var(--radius-md);
          color: var(--text-secondary);
          font-size: 12px;
          cursor: pointer;
          transition: background var(--transition-fast, 0.15s ease), color var(--transition-fast, 0.15s ease);
          white-space: nowrap;
        }
        .handle-dock-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .handle-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        .dock-btn-arrow {
          font-size: 13px;
        }
        .dock-btn-icon {
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
