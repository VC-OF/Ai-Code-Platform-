'use client';

import { useEffect, useRef } from 'react';
import { buildDotRing, dotColor, dotPosition } from './dotGeometry';
import type { AgentStatus } from '../StatusIndicator';

export interface AgentStatusDotsProps {
  status: AgentStatus | 'idle';
  /** Inline indicator (default) or a larger hero cluster for the empty state */
  variant?: 'inline' | 'hero';
}

const ENERGY: Record<string, number> = {
  idle: 0.05,
  planning: 0.35,
  writing: 0.5,
  reading: 0.28,
  linting: 0.42,
  testing: 0.45,
  compacting: 0.38,
  waiting: 0.12,
  done: 0.06,
  error: 0.1,
};

const COUNT = { inline: 26, hero: 64 } as const;

/**
 * Astra-style particle dots that visualize what the agent is doing right
 * now: a calm breathing cluster when idle, faster swirl and stronger
 * outward push while it plans, writes or tests. Canvas-driven so the chat
 * does not re-render per frame.
 */
export default function AgentStatusDots({ status, variant = 'inline' }: AgentStatusDotsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dots = buildDotRing(COUNT[variant]);
    let raf = 0;
    let disposed = false;
    const start = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = () => {
      if (disposed) return;
      const t = (performance.now() - start) / 1000;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const current = statusRef.current;
      const base = ENERGY[current] ?? 0.2;
      // Waiting/error dims the cluster
      const dim = current === 'waiting' || current === 'error' ? 0.5 : 1;
      const level = base * (0.85 + 0.15 * Math.sin(t * 2));

      for (const dot of dots) {
        const { x, y, size, alpha } = dotPosition(dot, level, t, w / 2, h / 2, Math.min(w, h) / 2 - 2);
        ctx.beginPath();
        ctx.arc(x, y, size * (variant === 'hero' ? 1.1 : 0.8), 0, Math.PI * 2);
        ctx.fillStyle = dotColor(dot, level);
        ctx.globalAlpha = alpha * dim * 0.85;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [variant]);

  return (
    <canvas
      ref={canvasRef}
      className={variant === 'hero' ? 'agent-dots agent-dots--hero' : 'agent-dots'}
      role="img"
      aria-label={status === 'idle' ? 'Ready' : `Agent is ${status}`}
    />
  );
}
