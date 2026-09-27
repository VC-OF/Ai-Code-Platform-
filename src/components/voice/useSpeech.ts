'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SpeechPriority } from '@/lib/voice/speechQueue';
import { SpeechEngine, browserSpeechSupported, type SpeechEngineConfig } from './speechEngine';

export interface BrowserVoiceInfo {
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
}

export interface SpeakOptions {
  priority?: SpeechPriority;
  /** Label for the utterance, e.g. which message is being read */
  tag?: string;
}

const subscribeNothing = () => () => {};

/**
 * Text-to-speech with a priority queue. `speak` queues (high priority
 * interrupts), `cancel` stops everything. Server voices fall back to the
 * browser voice when they fail, and the failure is reported in `error`.
 */
export function useSpeech(config: SpeechEngineConfig) {
  const engineRef = useRef<SpeechEngine | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [currentTag, setCurrentTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browserVoices, setBrowserVoices] = useState<BrowserVoiceInfo[]>([]);
  const browserSupported = useSyncExternalStore(subscribeNothing, browserSpeechSupported, () => false);

  const { engine, voice, browserVoice, rate, pitch, missingVoice = null } = config;

  useEffect(() => {
    const instance = new SpeechEngine(
      { engine, voice, browserVoice, rate, pitch, missingVoice },
      {
        onSpeakingChange: (isSpeaking, tag) => {
          setSpeaking(isSpeaking);
          setCurrentTag(tag);
        },
        onError: setError,
      }
    );
    engineRef.current = instance;
    return () => {
      instance.dispose();
      if (engineRef.current === instance) engineRef.current = null;
    };
    // Created once; config changes are pushed by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setConfig({ engine, voice, browserVoice, rate, pitch, missingVoice });
  }, [engine, voice, browserVoice, rate, pitch, missingVoice]);

  useEffect(() => {
    if (!browserSpeechSupported()) return;
    const synth = window.speechSynthesis;
    const read = () =>
      setBrowserVoices(
        synth.getVoices().map((v) => ({ name: v.name, lang: v.lang, default: v.default, localService: v.localService }))
      );
    const id = requestAnimationFrame(read);
    synth.addEventListener('voiceschanged', read);
    return () => {
      cancelAnimationFrame(id);
      synth.removeEventListener('voiceschanged', read);
    };
  }, []);

  const speak = useCallback((text: string, opts?: SpeakOptions) => {
    engineRef.current?.speak(text, opts);
  }, []);

  const cancel = useCallback(() => {
    engineRef.current?.cancel();
  }, []);

  const clearError = useCallback(() => setError(null), []);
  /** Try a server voice that failed with a config error again (e.g. after a key was added). */
  const unblockServer = useCallback(() => {
    engineRef.current?.unblock();
  }, []);
  const recentSpoken = useCallback(() => engineRef.current?.recentSpoken() ?? [], []);
  const currentText = useCallback(() => engineRef.current?.currentText() ?? null, []);

  return {
    speak,
    cancel,
    speaking,
    currentTag,
    error,
    clearError,
    unblockServer,
    browserSupported,
    browserVoices,
    recentSpoken,
    currentText,
  };
}

export type SpeechController = ReturnType<typeof useSpeech>;
