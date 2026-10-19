'use client';

import React, { useEffect, useRef } from 'react';

interface GeminiLiveOrbProps {
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  isMuted: boolean;
  inputLevel: number;   // 0 to 1
  outputLevel: number;  // 0 to 1
  size?: number;
}

export default function GeminiLiveOrb({
  state,
  isMuted,
  inputLevel,
  outputLevel,
  size = 140,
}: GeminiLiveOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  // Render fluid animated gradient orb on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const render = () => {
      if (!running) return;
      phaseRef.current += 0.035;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Base radius with audio responsiveness
      const speakingMod = outputLevel * 22;
      const micMod = !isMuted ? inputLevel * 18 : 0;
      const activeMod = state === 'connected' ? speakingMod + micMod : 0;
      const breathe = Math.sin(phaseRef.current * 1.5) * 4;
      const radius = (size / 3) + activeMod + breathe;

      // 1. Outer ambient glow
      const outerGlow = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 1.6);
      if (state === 'error') {
        outerGlow.addColorStop(0, 'rgba(239, 68, 68, 0.4)');
        outerGlow.addColorStop(1, 'rgba(239, 68, 68, 0)');
      } else if (state === 'connecting') {
        outerGlow.addColorStop(0, 'rgba(234, 179, 8, 0.35)');
        outerGlow.addColorStop(1, 'rgba(234, 179, 8, 0)');
      } else if (outputLevel > 0.1) {
        // AI Speaking: bright cyan / purple pulse
        outerGlow.addColorStop(0, 'rgba(56, 189, 248, 0.6)');
        outerGlow.addColorStop(0.5, 'rgba(168, 85, 247, 0.35)');
        outerGlow.addColorStop(1, 'rgba(99, 102, 241, 0)');
      } else if (inputLevel > 0.1 && !isMuted) {
        // User speaking: electric blue / emerald shimmer
        outerGlow.addColorStop(0, 'rgba(16, 185, 129, 0.5)');
        outerGlow.addColorStop(0.6, 'rgba(59, 130, 246, 0.3)');
        outerGlow.addColorStop(1, 'rgba(16, 185, 129, 0)');
      } else {
        // Idle connected: signature Gemini violet-cyan aura
        outerGlow.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
        outerGlow.addColorStop(0.6, 'rgba(56, 189, 248, 0.2)');
        outerGlow.addColorStop(1, 'rgba(99, 102, 241, 0)');
      }

      ctx.fillStyle = outerGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.6, 0, Math.PI * 2);
      ctx.fill();

      // 2. Multi-point organic blob for Gemini Live shape
      ctx.save();
      ctx.beginPath();
      const points = 8;
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const wave = Math.sin(angle * 3 + phaseRef.current * 2) * (activeMod * 0.4 + 3);
        const r = radius + wave;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();

      // Inner gradient
      const innerGrad = ctx.createLinearGradient(
        cx - radius + Math.cos(phaseRef.current) * 20,
        cy - radius + Math.sin(phaseRef.current) * 20,
        cx + radius,
        cy + radius
      );

      if (state === 'error') {
        innerGrad.addColorStop(0, '#f87171');
        innerGrad.addColorStop(1, '#dc2626');
      } else if (state === 'connecting') {
        innerGrad.addColorStop(0, '#fde047');
        innerGrad.addColorStop(1, '#d97706');
      } else if (outputLevel > 0.1) {
        innerGrad.addColorStop(0, '#38bdf8');
        innerGrad.addColorStop(0.5, '#818cf8');
        innerGrad.addColorStop(1, '#c084fc');
      } else {
        innerGrad.addColorStop(0, '#2563eb');
        innerGrad.addColorStop(0.4, '#7c3aed');
        innerGrad.addColorStop(0.8, '#06b6d4');
        innerGrad.addColorStop(1, '#4f46e5');
      }

      ctx.fillStyle = innerGrad;
      ctx.shadowColor = 'rgba(56, 189, 248, 0.6)';
      ctx.shadowBlur = 24;
      ctx.fill();
      ctx.restore();

      // 3. Floating shimmer highlights
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(
        cx - radius * 0.35 + Math.cos(phaseRef.current * 1.2) * 5,
        cy - radius * 0.35 + Math.sin(phaseRef.current * 1.2) * 5,
        radius * 0.35,
        radius * 0.2,
        Math.PI / 4,
        0,
        Math.PI * 2
      );
      const highlight = ctx.createRadialGradient(
        cx - radius * 0.35,
        cy - radius * 0.35,
        0,
        cx - radius * 0.35,
        cy - radius * 0.35,
        radius * 0.35
      );
      highlight.addColorStop(0, 'rgba(255, 255, 255, 0.65)');
      highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = highlight;
      ctx.fill();
      ctx.restore();

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);

    return () => {
      running = false;
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
      }
    };
  }, [state, isMuted, inputLevel, outputLevel, size]);

  const getStatusText = () => {
    if (state === 'connecting') return 'Connecting to Gemini Live...';
    if (state === 'error') return 'Connection Error';
    if (state === 'disconnected') return 'Disconnected';
    if (outputLevel > 0.1) return 'Gemini is speaking...';
    if (inputLevel > 0.1 && !isMuted) return 'Listening to you...';
    if (isMuted) return 'Microphone muted';
    return 'Listening in real-time';
  };

  return (
    <div className="gemini-live-orb-container">
      <div className="orb-canvas-wrapper" style={{ width: size, height: size }}>
        <canvas
          ref={canvasRef}
          width={size * 1.4}
          height={size * 1.4}
          style={{ width: size * 1.4, height: size * 1.4 }}
          className="gemini-live-canvas"
        />
      </div>

      <div className="orb-status-badge">
        <span className={`status-dot status-dot--${state}`} />
        <span className="status-label">{getStatusText()}</span>
      </div>

      <style jsx>{`
        .gemini-live-orb-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 12px;
          user-select: none;
        }
        .orb-canvas-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .gemini-live-canvas {
          pointer-events: none;
        }
        .orb-status-badge {
          display: flex;
          align-items: center;
          gap: 7px;
          margin-top: 8px;
          padding: 4px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(8px);
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary, #cbd5e1);
        }
        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #64748b;
        }
        .status-dot--connected {
          background: #10b981;
          box-shadow: 0 0 8px #10b981;
        }
        .status-dot--connecting {
          background: #f59e0b;
          box-shadow: 0 0 8px #f59e0b;
        }
        .status-dot--error {
          background: #ef4444;
          box-shadow: 0 0 8px #ef4444;
        }
        .status-label {
          letter-spacing: 0.2px;
        }
      `}</style>
    </div>
  );
}
