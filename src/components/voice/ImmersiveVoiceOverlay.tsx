'use client';

import { useState } from 'react';
import VoiceDotsCanvas from './VoiceDotsCanvas';
import VoiceStatusBar from './VoiceStatusBar';
import type { VoiceConversation } from './useVoiceConversation';
import { useMicLevel } from './useMicLevel';

/**
 * ChatGPT-Advanced-Voice-style full-screen canvas: an Astra-like reactive
 * dot halo with the current phase, the live transcript, and collapse /
 * voice-off controls. Voice mode keeps running while collapsed (bubble).
 */
export default function ImmersiveVoiceOverlay({ voice }: { voice: VoiceConversation }) {
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const micLevelRef = useMicLevel(voice.active && voice.phase !== 'speaking');
  const speechLevelRef = useMicLevel(voice.active && voice.phase === 'speaking'); // reuse sampler on output? no: speak uses TTS audio we cannot tap; animate via phase energy

  if (dismissed || !voice.active) return null;

  const PHASE_TITLE: Record<string, string> = {
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
    error: 'Microphone off',
    unsupported: 'Voice input unavailable',
    off: '',
  };

  return (
    <div
      className={`voice-canvas-overlay ${collapsed ? 'voice-canvas-overlay--bubble' : ''}`}
      role="region"
      aria-label="Voice mode"
    >
      <VoiceDotsCanvas
        phase={voice.phase}
        micLevelRef={micLevelRef}
        speechLevelRef={speechLevelRef}
        variant={collapsed ? 'bubble' : 'full'}
        className="voice-canvas-dots"
      />
      <div className="voice-canvas-controls">
        <button
          type="button"
          className="voice-canvas-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand voice canvas' : 'Collapse to bubble'}
          aria-label={collapsed ? 'Expand voice canvas' : 'Collapse voice canvas'}
        >
          {collapsed ? '⤢' : '⤡'}
        </button>
        <button
          type="button"
          className="voice-canvas-btn voice-canvas-btn--off"
          onClick={() => {
            voice.toggle();
            setDismissed(true);
          }}
          title="Turn voice mode off"
          aria-label="Turn voice mode off"
        >
          ✕
        </button>
      </div>
      {!collapsed && (
        <div className="voice-canvas-body">
          <div className="voice-canvas-title">{PHASE_TITLE[voice.phase]}</div>
          <div className="voice-canvas-status">
            <VoiceStatusBar voice={voice} />
          </div>
        </div>
      )}
      <style jsx global>{`
        .voice-canvas-overlay {
          position: fixed;
          inset: 0;
          z-index: 9000;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: radial-gradient(ellipse at center, rgba(8, 12, 26, 0.94) 30%, rgba(3, 6, 16, 0.98) 100%);
          backdrop-filter: blur(14px);
          animation: voice-canvas-in 0.25s ease-out;
        }
        @keyframes voice-canvas-in {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
        .voice-canvas-dots {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        .voice-canvas-controls {
          position: absolute;
          top: 18px;
          right: 18px;
          display: flex;
          gap: 8px;
          z-index: 2;
        }
        .voice-canvas-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 1px solid rgba(148, 163, 184, 0.3);
          background: rgba(15, 23, 42, 0.6);
          color: #cbd5e1;
          font-size: 15px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .voice-canvas-btn:hover {
          color: #f8fafc;
          border-color: rgba(148, 163, 184, 0.6);
          background: rgba(30, 41, 59, 0.8);
        }
        .voice-canvas-btn--off:hover {
          color: #fca5a5;
          border-color: rgba(239, 68, 68, 0.5);
        }
        .voice-canvas-body {
          position: relative;
          z-index: 1;
          width: min(560px, 88vw);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          pointer-events: none;
        }
        .voice-canvas-title {
          font-size: 22px;
          font-weight: 500;
          color: #f1f5f9;
          letter-spacing: 0.3px;
        }
        .voice-canvas-status {
          width: 100%;
          pointer-events: auto;
          display: flex;
          justify-content: center;
        }

        /* ── Collapsed bubble ── */
        .voice-canvas-overlay--bubble {
          position: fixed;
          inset: auto;
          right: 20px;
          bottom: 96px;
          width: 96px;
          height: 96px;
          border-radius: 50%;
          background: radial-gradient(circle at center, rgba(15, 23, 42, 0.92), rgba(8, 12, 26, 0.96));
          border: 1px solid rgba(56, 189, 248, 0.3);
          box-shadow: 0 10px 34px rgba(0, 0, 0, 0.55), 0 0 22px rgba(56, 189, 248, 0.18);
          animation: voice-bubble-in 0.2s ease-out;
          overflow: hidden;
        }
        @keyframes voice-bubble-in {
          from { opacity: 0; transform: translateY(8px) scale(0.92); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .voice-canvas-overlay--bubble .voice-canvas-controls {
          top: 4px;
          right: 4px;
          gap: 4px;
        }
        .voice-canvas-overlay--bubble .voice-canvas-btn {
          width: 22px;
          height: 22px;
          font-size: 11px;
          background: transparent;
          border: none;
        }
        .voice-canvas-overlay--bubble .voice-canvas-btn--off {
          display: none; /* the bubble keeps the session; turn it off from the composer */
        }
      `}</style>
    </div>
  );
}
