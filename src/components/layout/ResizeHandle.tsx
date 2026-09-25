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
  onResizeWidthRef.current = onResizeWidth;

  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  const onEnsureOpenRef = useRef(onEnsureOpen);
  onEnsureOpenRef.current = onEnsureOpen;

  const hasOpenPanelsRef = useRef(hasOpenPanels);
  hasOpenPanelsRef.current = hasOpenPanels;

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
    : 'Drag left or click to open Code Editor';

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
            title="Click or drag left to open Code Editor"
            aria-label="Open Code Editor"
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
          transition: background 0.15s ease, box-shadow 0.15s ease;
        }

        /* ── Open mode: divider bar ── */
        .resize-handle--open {
          width: 6px;
          flex-shrink: 0;
          background: var(--border-subtle, rgba(255, 255, 255, 0.08));
        }

        /* ── Edge mode: right dock tab ── */
        .resize-handle--edge {
          width: 10px;
          flex-shrink: 0;
          background: transparent;
        }

        /* 24px wide invisible hit zone so the handle is effortless to grab from anywhere */
        .resize-handle::before {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          left: -10px;
          right: -10px;
          cursor: col-resize;
          z-index: 10;
        }

        .resize-handle:hover,
        .resize-handle--active {
          background: var(--brand, #f97316);
          box-shadow: 0 0 10px rgba(249, 115, 22, 0.45);
        }

        .resize-handle--edge:hover,
        .resize-handle--edge.resize-handle--active {
          background: rgba(249, 115, 22, 0.35);
        }

        .resize-handle-bar {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          position: relative;
        }

        .resize-handle-dots {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          opacity: 0.5;
          transition: opacity 0.15s ease;
          pointer-events: none;
        }

        .resize-handle:hover .resize-handle-dots,
        .resize-handle--active .resize-handle-dots {
          opacity: 1;
        }

        .resize-handle-dots span {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--text-muted, #8b949e);
          transition: background 0.15s ease;
        }

        .resize-handle:hover .resize-handle-dots span,
        .resize-handle--active .resize-handle-dots span {
          background: #ffffff;
        }

        /* Collapse mini button on the handle bar */
        .handle-collapse-btn {
          position: absolute;
          top: 48%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 18px;
          height: 32px;
          border-radius: 4px;
          background: var(--bg-surface, #1e1e24);
          border: 1px solid var(--border-base, rgba(255, 255, 255, 0.15));
          color: var(--text-secondary, #94a3b8);
          font-size: 13px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          pointer-events: auto;
          transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease, transform 0.15s ease;
          z-index: 25;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .resize-handle:hover .handle-collapse-btn,
        .resize-handle--active .handle-collapse-btn {
          opacity: 1;
        }

        .handle-collapse-btn:hover {
          background: var(--brand, #f97316);
          color: #ffffff;
          border-color: var(--brand, #f97316);
          transform: translate(-50%, -50%) scale(1.08);
        }

        /* ── Edge Dock Tab (When chat is full-page) ── */
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
          padding: 7px 11px 7px 8px;
          background: var(--bg-surface, #1c1d22);
          border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.2));
          border-right: none;
          border-radius: 18px 0 0 18px;
          color: var(--text-secondary, #cbd5e1);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: -3px 4px 14px rgba(0, 0, 0, 0.25);
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          white-space: nowrap;
        }

        .handle-dock-btn:hover {
          background: var(--bg-elevated, #27282f);
          color: var(--brand, #f97316);
          border-color: var(--brand, #f97316);
          box-shadow: -4px 6px 18px rgba(249, 115, 22, 0.3);
          transform: translateX(-4px);
        }

        .dock-btn-arrow {
          font-size: 14px;
          font-weight: 700;
          color: var(--brand, #f97316);
          transition: transform 0.2s ease;
        }

        .handle-dock-btn:hover .dock-btn-arrow {
          transform: translateX(-2px);
        }

        .dock-btn-icon {
          flex-shrink: 0;
        }

        .dock-btn-label {
          font-family: var(--font-brand, inherit);
          letter-spacing: 0.02em;
        }
      `}</style>
    </div>
  );
}
