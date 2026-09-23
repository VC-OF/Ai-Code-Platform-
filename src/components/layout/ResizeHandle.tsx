'use client';

import { useCallback, useRef } from 'react';

interface ResizeHandleProps {
  onResize: (delta: number) => void;
}

export default function ResizeHandle({ onResize }: ResizeHandleProps) {
  const dragging = useRef(false);
  const lastX    = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      lastX.current    = e.clientX;
      document.body.style.cursor    = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (e: MouseEvent) => {
        if (!dragging.current) return;
        const delta = e.clientX - lastX.current;
        lastX.current = e.clientX;
        onResize(delta);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.body.style.cursor    = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup',   onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup',   onMouseUp);
    },
    [onResize]
  );

  return (
    <div
      className="resize-handle"
      onMouseDown={onMouseDown}
      title="Drag to resize"
    >
      <div className="resize-handle-bar" />

      <style jsx>{`
        .resize-handle {
          width: 4px;
          flex-shrink: 0;
          cursor: col-resize;
          background: var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background var(--transition-fast);
          position: relative;
          z-index: 10;
        }

        .resize-handle:hover,
        .resize-handle:active {
          background: var(--brand);
        }

        .resize-handle-bar {
          width: 2px;
          height: 40px;
          border-radius: 1px;
          background: var(--border-base);
          opacity: 0;
          transition: opacity var(--transition-fast);
        }

        .resize-handle:hover .resize-handle-bar {
          opacity: 1;
          background: var(--brand);
        }
      `}</style>
    </div>
  );
}
