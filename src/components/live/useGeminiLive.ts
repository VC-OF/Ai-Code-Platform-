'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioManager } from '@/lib/live/audioManager';
import { VisionManager } from '@/lib/live/visionManager';
import { GeminiLiveClient } from '@/lib/live/geminiLiveClient';
import {
  LiveConnectionState,
  LiveTranscript,
  LiveVoice,
  VisionSource,
} from '@/lib/live/types';

interface UseGeminiLiveOptions {
  projectName?: string;
  activeFile?: string | null;
  activeCode?: string | null;
}

export function useGeminiLive(options: UseGeminiLiveOptions = {}) {
  const [connectionState, setConnectionState] = useState<LiveConnectionState>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [visionSource, setVisionSource] = useState<VisionSource>('none');
  const [visionStream, setVisionStream] = useState<MediaStream | null>(null);
  const [voice, setVoice] = useState<LiveVoice>('Puck');
  const [transcripts, setTranscripts] = useState<LiveTranscript[]>([]);
  const [currentAiSpeech, setCurrentAiSpeech] = useState<string>('');
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [apiKey, setApiKey] = useState<string>('');
  const [hasServerKey, setHasServerKey] = useState<boolean>(false);
  const [loadingKey, setLoadingKey] = useState(true);

  const audioMgrRef = useRef<AudioManager | null>(null);
  const visionMgrRef = useRef<VisionManager | null>(null);
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const levelIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check server for GEMINI_API_KEY on mount
  useEffect(() => {
    async function checkKey() {
      let foundKey = '';
      try {
        const res = await fetch('/api/live/key');
        if (res.ok) {
          const data = await res.json();
          if (data.hasKey && data.apiKey) {
            foundKey = data.apiKey as string;
            setApiKey(foundKey);
            setHasServerKey(true);
          }
        }
      } catch {
        // Fall back to localStorage below
      } finally {
        // Only consult localStorage when the server had no key (don't clobber it)
        if (!foundKey) {
          const localKey = localStorage.getItem('oc-gemini-api-key') || '';
          if (localKey) {
            setApiKey(localKey);
          }
        }
        setLoadingKey(false);
      }
    }
    void checkKey();
  }, []);

  // Save API key
  const saveKey = useCallback(async (key: string) => {
    const trimmed = key.trim();
    setApiKey(trimmed);
    localStorage.setItem('oc-gemini-api-key', trimmed);
    try {
      await fetch('/api/live/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      setHasServerKey(true);
    } catch {
      // Local storage is already set
    }
  }, []);

  // Audio chunk handler: send mic audio to Gemini Live
  const handleAudioChunk = useCallback((base64Pcm: string) => {
    if (clientRef.current && clientRef.current.getState() === 'connected') {
      clientRef.current.sendMediaChunk('audio/pcm;rate=16000', base64Pcm);
    }
  }, []);

  // Vision frame handler: send screen/camera JPEG frames to Gemini Live
  const handleFrameChunk = useCallback((base64Jpeg: string) => {
    if (clientRef.current && clientRef.current.getState() === 'connected') {
      clientRef.current.sendMediaChunk('image/jpeg', base64Jpeg);
    }
  }, []);

  // Initialize managers
  useEffect(() => {
    const audioMgr = new AudioManager(handleAudioChunk);
    const visionMgr = new VisionManager(
      handleFrameChunk,
      (source) => {
        setVisionSource(source);
        setVisionStream(visionMgr.getStream());
      }
    );

    const client = new GeminiLiveClient({
      onStateChange: (state, err) => {
        setConnectionState(state);
        if (err) setErrorMessage(err);
        if (state === 'connected') {
          setErrorMessage(null);
          // Start mic once connected
          void audioMgr.startMicrophone().catch((mErr) => {
            console.warn('Microphone start error:', mErr);
          });
        } else if (state === 'disconnected' || state === 'error') {
          audioMgr.stopPlayback();
        }
      },
      onAudioOutput: (base64Pcm) => {
        audioMgr.playPcmChunk(base64Pcm);
      },
      onInterrupted: () => {
        audioMgr.stopPlayback();
        setCurrentAiSpeech('');
      },
      onTranscriptChunk: (text) => {
        setCurrentAiSpeech((prev) => prev + text);
      },
      onTurnComplete: () => {
        setCurrentAiSpeech((prev) => {
          if (prev.trim()) {
            setTranscripts((t) => [
              ...t.slice(-25),
              {
                id: Math.random().toString(36).substring(2, 9),
                role: 'gemini',
                text: prev.trim(),
                timestamp: Date.now(),
              },
            ]);
          }
          return '';
        });
      },
    });

    audioMgrRef.current = audioMgr;
    visionMgrRef.current = visionMgr;
    clientRef.current = client;

    // Visualizer polling interval (30ms for 30fps smooth metering)
    levelIntervalRef.current = setInterval(() => {
      const levels = audioMgr.getVisualizerLevels();
      setInputLevel(levels.inputLevel);
      setOutputLevel(levels.outputLevel);
    }, 32);

    return () => {
      if (levelIntervalRef.current) clearInterval(levelIntervalRef.current);
      audioMgr.cleanup();
      visionMgr.cleanup();
      client.disconnect();
    };
  }, [handleAudioChunk, handleFrameChunk]);

  // Connect to Gemini Live session
  const connect = useCallback((keyOverride?: string) => {
    const keyToUse = keyOverride || apiKey;
    if (!keyToUse) {
      setErrorMessage('Google Gemini API Key is required');
      return;
    }

    setErrorMessage(null);
    setCurrentAiSpeech('');

    clientRef.current?.connect({
      apiKey: keyToUse,
      voice,
      projectName: options.projectName,
      activeFile: options.activeFile || undefined,
      activeCode: options.activeCode || undefined,
    });
  }, [apiKey, voice, options.projectName, options.activeFile, options.activeCode]);

  // Disconnect session
  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    audioMgrRef.current?.stopMicrophone();
    audioMgrRef.current?.stopPlayback();
    visionMgrRef.current?.stopVision();
    setVisionSource('none');
    setVisionStream(null);
    setCurrentAiSpeech('');
  }, []);

  // Toggle microphone mute
  const toggleMute = useCallback(() => {
    if (!audioMgrRef.current) return;
    const nextMuted = !isMuted;
    audioMgrRef.current.setMuted(nextMuted);
    setIsMuted(nextMuted);
  }, [isMuted]);

  // Screen share controls
  const startScreenShare = useCallback(async () => {
    if (!visionMgrRef.current) return;
    try {
      const stream = await visionMgrRef.current.startScreenShare();
      setVisionSource('screen');
      setVisionStream(stream);
    } catch (err) {
      console.warn('Failed to start screen share:', err);
    }
  }, []);

  // Camera controls
  const startCamera = useCallback(async () => {
    if (!visionMgrRef.current) return;
    try {
      const stream = await visionMgrRef.current.startCamera();
      setVisionSource('camera');
      setVisionStream(stream);
    } catch (err) {
      console.warn('Failed to start camera:', err);
    }
  }, []);

  const stopVision = useCallback(() => {
    visionMgrRef.current?.stopVision();
    setVisionSource('none');
    setVisionStream(null);
  }, []);

  // Send current code context to live session
  const sendCodeContext = useCallback((filename: string, code: string) => {
    if (clientRef.current && clientRef.current.getState() === 'connected') {
      const message = `Here is the current code in ${filename}:\n\`\`\`\n${code.slice(0, 5000)}\n\`\`\``;
      clientRef.current.sendTextMessage(message);
      setTranscripts((t) => [
        ...t,
        {
          id: Math.random().toString(36).substring(2, 9),
          role: 'user',
          text: `[Sent code context from ${filename}]`,
          timestamp: Date.now(),
        },
      ]);
    }
  }, []);

  // Send manual text prompt into live turn
  const sendTextMessage = useCallback((text: string) => {
    if (clientRef.current && clientRef.current.getState() === 'connected' && text.trim()) {
      clientRef.current.sendTextMessage(text.trim());
      setTranscripts((t) => [
        ...t,
        {
          id: Math.random().toString(36).substring(2, 9),
          role: 'user',
          text: text.trim(),
          timestamp: Date.now(),
        },
      ]);
    }
  }, []);

  return {
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
    sendTextMessage,
  };
}
