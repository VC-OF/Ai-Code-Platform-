'use client';

import React, { useEffect, useRef, useState } from 'react';
import GeminiLiveOrb from './GeminiLiveOrb';
import { useGeminiLive } from './useGeminiLive';
import { LiveVoice } from '@/lib/live/types';

interface GeminiLiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName?: string;
  activeFile?: string | null;
  activeCode?: string | null;
}

const VOICES: { id: LiveVoice; name: string; desc: string }[] = [
  { id: 'Puck', name: 'Puck', desc: 'Playful & dynamic' },
  { id: 'Charon', name: 'Charon', desc: 'Deep & calm' },
  { id: 'Kore', name: 'Kore', desc: 'Warm & natural' },
  { id: 'Fenrir', name: 'Fenrir', desc: 'Clear & sharp' },
  { id: 'Aoede', name: 'Aoede', desc: 'Bright & melodic' },
];

export default function GeminiLiveModal({
  isOpen,
  onClose,
  projectName,
  activeFile,
  activeCode,
}: GeminiLiveModalProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [showTranscripts, setShowTranscripts] = useState(false);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  const {
    connectionState,
    errorMessage,
    isMuted,
    visionSource,
    visionStream,
    voice,
    setVoice,
    transcripts,
    currentAiSpeech,
    inputLevel,
    outputLevel,
    apiKey,
    hasServerKey,
    loadingKey,
    saveKey,
    connect,
    disconnect,
    toggleMute,
    startScreenShare,
    startCamera,
    stopVision,
    sendCodeContext,
  } = useGeminiLive({
    projectName,
    activeFile,
    activeCode,
  });

  // Attach live vision stream to PiP video element
  useEffect(() => {
    if (videoPreviewRef.current && visionStream) {
      videoPreviewRef.current.srcObject = visionStream;
    }
  }, [visionStream, visionSource]);

  // Show the API key prompt whenever no usable key is loaded yet
  const showKeyPrompt = !loadingKey && !apiKey && !hasServerKey;

  if (!isOpen) return null;

  const handleStart = () => {
    if (!apiKey) {
      return;
    }
    connect();
  };

  const handleSaveKeyAndStart = async () => {
    if (!inputKey.trim()) return;
    await saveKey(inputKey.trim());
    connect(inputKey.trim());
  };

  const handleSendCode = () => {
    if (activeFile && activeCode) {
      sendCodeContext(activeFile, activeCode);
    }
  };

  // ── Floating Minimized Widget ─────────────────────────────────────────────
  if (isMinimized) {
    return (
      <div className="gemini-live-mini-widget" onClick={() => setIsMinimized(false)}>
        <div className="mini-orb-badge">
          <GeminiLiveOrb
            state={connectionState}
            isMuted={isMuted}
            inputLevel={inputLevel}
            outputLevel={outputLevel}
            size={48}
          />
        </div>
        <div className="mini-info">
          <span className="mini-title">Gemini Live</span>
          <span className="mini-status">
            {connectionState === 'connected'
              ? visionSource !== 'none'
                ? `Seeing (${visionSource})`
                : 'Listening...'
              : connectionState}
          </span>
        </div>
        <button
          type="button"
          className="mini-expand-btn"
          title="Expand Gemini Live"
          onClick={(e) => {
            e.stopPropagation();
            setIsMinimized(false);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>

        <style jsx>{`
          .gemini-live-mini-widget {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 9999;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 14px 8px 8px;
            border-radius: 999px;
            background: rgba(15, 23, 42, 0.88);
            border: 1px solid rgba(56, 189, 248, 0.35);
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 0 20px rgba(56, 189, 248, 0.25);
            backdrop-filter: blur(16px);
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .gemini-live-mini-widget:hover {
            transform: scale(1.03);
            border-color: rgba(56, 189, 248, 0.6);
          }
          .mini-orb-badge {
            width: 44px;
            height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .mini-info {
            display: flex;
            flex-direction: column;
          }
          .mini-title {
            font-size: 13px;
            font-weight: 600;
            color: #f8fafc;
          }
          .mini-status {
            font-size: 11px;
            color: #94a3b8;
          }
          .mini-expand-btn {
            background: transparent;
            border: none;
            color: #94a3b8;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            border-radius: 4px;
          }
          .mini-expand-btn:hover {
            color: #f8fafc;
            background: rgba(255, 255, 255, 0.1);
          }
        `}</style>
      </div>
    );
  }

  // ── Full Modal Dialog ─────────────────────────────────────────────────────
  return (
    <div className="gemini-live-backdrop" onClick={onClose}>
      <div className="gemini-live-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="live-header">
          <div className="live-title-group">
            <div className="live-sparkle-icon">
              <svg viewBox="0 0 24 24" fill="currentColor" width={18} height={18}>
                <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
              </svg>
            </div>
            <div>
              <div className="live-heading">
                <span>Gemini Live</span>
                <span className="live-tag">Real-Time</span>
              </div>
              <div className="live-subheading">
                Multimodal voice & live screen pair programming
              </div>
            </div>
          </div>

          <div className="live-header-actions">
            <button
              type="button"
              className="action-icon-btn"
              title="Minimize to floating orb"
              onClick={() => setIsMinimized(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
            <button
              type="button"
              className="action-icon-btn"
              title="Close"
              onClick={() => {
                disconnect();
                onClose();
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* API Key Prompt */}
        {showKeyPrompt && connectionState === 'disconnected' ? (
          <div className="live-key-prompt">
            <div className="key-icon-wrapper">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width={28} height={28}>
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            </div>
            <h3>Google Gemini API Key Required</h3>
            <p>
              Gemini Live uses Google’s Multimodal Live WebSocket API (<code>gemini-3.8-live</code>) for sub-second bidirectional voice and vision streaming.
            </p>
            <div className="key-input-row">
              <input
                type="password"
                className="key-input"
                placeholder="AIzaSy..."
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveKeyAndStart()}
              />
              <button
                type="button"
                className="primary-btn"
                onClick={handleSaveKeyAndStart}
                disabled={!inputKey.trim()}
              >
                Start Live
              </button>
            </div>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="key-link"
            >
              Get a free API key at Google AI Studio &rarr;
            </a>
          </div>
        ) : (
          <div className="live-body">
            {/* Visualizer Orb & Captions */}
            <div className="live-stage">
              <GeminiLiveOrb
                state={connectionState}
                isMuted={isMuted}
                inputLevel={inputLevel}
                outputLevel={outputLevel}
                size={160}
              />

              {/* Streaming Caption / Transcript Box */}
              <div className="live-caption-box">
                {currentAiSpeech ? (
                  <p className="caption-text speaking">{currentAiSpeech}</p>
                ) : connectionState === 'connected' ? (
                  <p className="caption-text idle">
                    Speak naturally. Share your screen or camera to have Gemini see your code in real time.
                  </p>
                ) : errorMessage ? (
                  <p className="caption-text error">{errorMessage}</p>
                ) : (
                  <p className="caption-text">Session not started</p>
                )}
              </div>

              {/* Vision PiP feed (Screen Share / Camera) */}
              {visionSource !== 'none' && (
                <div className="vision-pip-card">
                  <div className="vision-pip-badge">
                    <span className="pip-dot" />
                    <span>LIVE {visionSource === 'screen' ? 'SCREEN' : 'CAMERA'}</span>
                    <button
                      type="button"
                      className="pip-stop-btn"
                      onClick={stopVision}
                      title="Stop video streaming"
                    >
                      Stop
                    </button>
                  </div>
                  <video
                    ref={videoPreviewRef}
                    autoPlay
                    muted
                    playsInline
                    className="vision-pip-video"
                  />
                </div>
              )}
            </div>

            {/* Transcript Drawer Toggle */}
            {transcripts.length > 0 && (
              <div className="transcript-accordion">
                <button
                  type="button"
                  className="transcript-toggle-btn"
                  onClick={() => setShowTranscripts(!showTranscripts)}
                >
                  <span>Conversation History ({transcripts.length})</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    width={14}
                    height={14}
                    style={{ transform: showTranscripts ? 'rotate(180deg)' : 'rotate(0)' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {showTranscripts && (
                  <div className="transcripts-list">
                    {transcripts.map((t) => (
                      <div key={t.id} className={`transcript-row transcript-row--${t.role}`}>
                        <span className="transcript-sender">
                          {t.role === 'gemini' ? 'Gemini' : 'You'}:
                        </span>
                        <span className="transcript-message">{t.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Control Bar */}
            <div className="live-controls-bar">
              {connectionState === 'connected' ? (
                <>
                  {/* Mic Mute / Unmute */}
                  <button
                    type="button"
                    className={`ctrl-btn ${isMuted ? 'ctrl-btn--muted' : 'ctrl-btn--active'}`}
                    onClick={toggleMute}
                    title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  >
                    {isMuted ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
                      </svg>
                    )}
                    <span>{isMuted ? 'Muted' : 'Mic On'}</span>
                  </button>

                  {/* Screen Share */}
                  <button
                    type="button"
                    className={`ctrl-btn ${visionSource === 'screen' ? 'ctrl-btn--sharing' : ''}`}
                    onClick={visionSource === 'screen' ? stopVision : startScreenShare}
                    title={visionSource === 'screen' ? 'Stop screen share' : 'Share screen with Gemini'}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                    <span>{visionSource === 'screen' ? 'Sharing' : 'Share Screen'}</span>
                  </button>

                  {/* Camera */}
                  <button
                    type="button"
                    className={`ctrl-btn ${visionSource === 'camera' ? 'ctrl-btn--sharing' : ''}`}
                    onClick={visionSource === 'camera' ? stopVision : startCamera}
                    title={visionSource === 'camera' ? 'Stop camera' : 'Start camera'}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    <span>Camera</span>
                  </button>

                  {/* Send Active File */}
                  {activeFile && (
                    <button
                      type="button"
                      className="ctrl-btn ctrl-btn--secondary"
                      onClick={handleSendCode}
                      title={`Send current editor contents (${activeFile}) to Gemini`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                        <polyline points="16 18 22 12 16 6" />
                        <polyline points="8 6 2 12 8 18" />
                      </svg>
                      <span>Send Code</span>
                    </button>
                  )}

                  {/* Disconnect */}
                  <button
                    type="button"
                    className="ctrl-btn ctrl-btn--end"
                    onClick={disconnect}
                    title="End live session"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                    <span>End</span>
                  </button>
                </>
              ) : (
                <div className="launch-row">
                  {/* Voice Selector */}
                  <div className="voice-selector">
                    <label htmlFor="gemini-live-voice" className="voice-label">Voice:</label>
                    <select
                      id="gemini-live-voice"
                      value={voice}
                      onChange={(e) => setVoice(e.target.value as LiveVoice)}
                      className="voice-select"
                    >
                      {VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} ({v.desc})
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    className="primary-btn primary-btn--glow"
                    onClick={handleStart}
                    disabled={connectionState === 'connecting'}
                  >
                    {connectionState === 'connecting' ? 'Connecting...' : 'Start Live Session'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .gemini-live-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(3, 7, 18, 0.7);
          backdrop-filter: blur(10px);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: fadeIn 0.2s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
        .gemini-live-modal {
          width: 100%;
          max-width: 580px;
          background: rgba(15, 23, 42, 0.94);
          border: 1px solid rgba(56, 189, 248, 0.25);
          box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 35px rgba(56, 189, 248, 0.15);
          border-radius: 20px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .live-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 24px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.02);
        }
        .live-title-group {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .live-sparkle-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: linear-gradient(135deg, #0284c7, #8b5cf6);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 16px rgba(139, 92, 246, 0.4);
        }
        .live-heading {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 16px;
          font-weight: 600;
          color: #f8fafc;
        }
        .live-tag {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          padding: 2px 7px;
          border-radius: 999px;
          background: rgba(56, 189, 248, 0.15);
          color: #38bdf8;
          border: 1px solid rgba(56, 189, 248, 0.3);
        }
        .live-subheading {
          font-size: 12px;
          color: #94a3b8;
          margin-top: 1px;
        }
        .live-header-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .action-icon-btn {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: transparent;
          border: 1px solid transparent;
          color: #94a3b8;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .action-icon-btn:hover {
          color: #f8fafc;
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.1);
        }
        .live-body {
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .live-stage {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          min-height: 220px;
        }
        .live-caption-box {
          margin-top: 8px;
          width: 100%;
          min-height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 8px 16px;
        }
        .caption-text {
          font-size: 14px;
          line-height: 1.5;
          margin: 0;
        }
        .caption-text.speaking {
          color: #38bdf8;
          font-weight: 500;
        }
        .caption-text.idle {
          color: #94a3b8;
          font-size: 13px;
        }
        .caption-text.error {
          color: #f87171;
        }
        .vision-pip-card {
          margin-top: 12px;
          width: 100%;
          max-width: 440px;
          border-radius: 12px;
          overflow: hidden;
          background: #020617;
          border: 1px solid rgba(56, 189, 248, 0.3);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
          position: relative;
        }
        .vision-pip-badge {
          position: absolute;
          top: 8px;
          left: 8px;
          right: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 10px;
          border-radius: 6px;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          font-size: 11px;
          font-weight: 600;
          color: #f8fafc;
          z-index: 2;
        }
        .pip-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #ef4444;
          box-shadow: 0 0 8px #ef4444;
          display: inline-block;
          margin-right: 6px;
        }
        .pip-stop-btn {
          background: rgba(239, 68, 68, 0.25);
          border: 1px solid rgba(239, 68, 68, 0.4);
          color: #fca5a5;
          padding: 2px 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 10px;
        }
        .pip-stop-btn:hover {
          background: rgba(239, 68, 68, 0.4);
        }
        .vision-pip-video {
          width: 100%;
          max-height: 180px;
          object-fit: cover;
          display: block;
        }
        .transcript-accordion {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding-top: 12px;
        }
        .transcript-toggle-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 12px;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          cursor: pointer;
          padding: 4px 0;
        }
        .transcript-toggle-btn:hover {
          color: #f8fafc;
        }
        .transcripts-list {
          margin-top: 8px;
          max-height: 140px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding-right: 6px;
        }
        .transcript-row {
          font-size: 12px;
          line-height: 1.4;
          padding: 6px 10px;
          border-radius: 6px;
        }
        .transcript-row--user {
          background: rgba(255, 255, 255, 0.04);
          color: #e2e8f0;
        }
        .transcript-row--gemini {
          background: rgba(56, 189, 248, 0.08);
          color: #38bdf8;
        }
        .transcript-sender {
          font-weight: 600;
          margin-right: 6px;
        }
        .live-controls-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        .ctrl-btn {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 10px 16px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #f8fafc;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ctrl-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.2);
        }
        .ctrl-btn--active {
          background: rgba(56, 189, 248, 0.12);
          border-color: rgba(56, 189, 248, 0.4);
          color: #38bdf8;
        }
        .ctrl-btn--sharing {
          background: rgba(16, 185, 129, 0.15);
          border-color: rgba(16, 185, 129, 0.4);
          color: #34d399;
        }
        .ctrl-btn--muted {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.3);
          color: #f87171;
        }
        .ctrl-btn--end {
          background: rgba(239, 68, 68, 0.18);
          border-color: rgba(239, 68, 68, 0.4);
          color: #fca5a5;
        }
        .ctrl-btn--end:hover {
          background: rgba(239, 68, 68, 0.3);
        }
        .launch-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          gap: 14px;
        }
        .voice-selector {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .voice-label {
          font-size: 13px;
          color: #94a3b8;
        }
        .voice-select {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 8px;
          color: #f8fafc;
          padding: 6px 12px;
          font-size: 13px;
          outline: none;
        }
        .voice-select option {
          background: #0f172a;
          color: #f8fafc;
        }
        .primary-btn {
          background: #0284c7;
          border: none;
          border-radius: 10px;
          color: #ffffff;
          font-size: 13px;
          font-weight: 600;
          padding: 10px 20px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .primary-btn:hover {
          background: #0369a1;
        }
        .primary-btn--glow {
          background: linear-gradient(135deg, #0284c7, #7c3aed);
          box-shadow: 0 0 20px rgba(124, 58, 237, 0.4);
        }
        .primary-btn--glow:hover {
          box-shadow: 0 0 28px rgba(124, 58, 237, 0.6);
          transform: translateY(-1px);
        }
        .live-key-prompt {
          padding: 36px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        .key-icon-wrapper {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.25);
          color: #38bdf8;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
        }
        .live-key-prompt h3 {
          font-size: 17px;
          font-weight: 600;
          color: #f8fafc;
          margin: 0 0 8px 0;
        }
        .live-key-prompt p {
          font-size: 13px;
          line-height: 1.5;
          color: #94a3b8;
          max-width: 440px;
          margin: 0 0 20px 0;
        }
        .key-input-row {
          display: flex;
          gap: 8px;
          width: 100%;
          max-width: 440px;
        }
        .key-input {
          flex: 1;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 10px;
          color: #f8fafc;
          padding: 10px 14px;
          font-size: 13px;
          outline: none;
        }
        .key-input:focus {
          border-color: #38bdf8;
        }
        .key-link {
          font-size: 12px;
          color: #38bdf8;
          margin-top: 14px;
          text-decoration: none;
        }
        .key-link:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
