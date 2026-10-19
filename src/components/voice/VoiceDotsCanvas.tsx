'use client';

import { useEffect, useRef } from 'react';
import { buildDotRing, dotColor, dotPosition } from './dotGeometry';
import type { VoicePhase } from './useVoiceConversation';

export interface VoiceDotsCanvasProps {
  phase: VoicePhase;
  /** 0..1 live microphone level (ref — updated outside React) */
  micLevelRef: React.RefObject<number>;
  /** 0..1 speech synthesis output level (ref) */
  speechLevelRef: React.RefObject<number>;
  /** Compact bubble vs full immersive ring */
  variant?: 'bubble' | 'full';
  className?: string;
}

const DOT_COUNT_FULL = 140;
const DOT_COUNT_BUBBLE = 70;
const ERROR_HUE = 8; // red tint when the phase is an error state

function phaseEnergy(phase: VoicePhase, micRef: React.RefObject<number>, speechRef: React.RefObject<number>, t: number): number {
  const live = Math.max(micRef.current ?? 0, speechRef.current ?? 0);
  switch (phase) {
    case 'speaking':
      return Math.max(live, 0.45 + 0.1 * Math.sin(t * 3));
    case 'listening':
    case 'thinking':
      return Math.max(live * 0.6, 0.12 + 0.08 * Math.sin(t * 2.2));
    case 'off':
      return 0.06 + 0.04 * Math.sin(t * 1.1);
    case 'unsupported':
    case 'error':
      return 0.03;
    default:
      return 0;
  }
}

/**
 * Astra/GPT-4o-style reactive dot halo: a ring of dots that breathes when
 * idle, pushes outward and spins faster with voice energy, and dims red on
 * errors. Drawn on canvas (one rAF loop, no per-frame React renders).
 */
export default function VoiceDotsCanvas({ phase, micLevelRef, speechLevelRef, variant = 'full', className }: VoiceDotsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dots = buildDotRing(variant === 'bubble' ? DOT_COUNT_BUBBLE : DOT_COUNT_FULL);
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

      const currentPhase = phaseRef.current;
      const level = phaseEnergy(currentPhase, micLevelRef, speechLevelRef, t);
      const maxRadius = Math.min(w, h) / 2 - 6;
      const isError = currentPhase === 'error' || currentPhase === 'unsupported';

      for (const dot of dots) {
        const { x, y, size, alpha } = dotPosition(dot, level, t, w / 2, h / 2, maxRadius);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = isError
          ? `hsl(${ERROR_HUE} 70% ${58 + level * 10}%)`
          : dotColor(dot, level);
        ctx.globalAlpha = alpha * (isError ? 0.55 : 1);
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
  }, [variant, micLevelRef, speechLevelRef]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
