'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NarrationEvent } from '@/lib/voice/narration';
import {
  ConversationController,
  narrationLevel,
  type ConversationEnv,
  type HeardUtterance,
  type SteerOutcome,
} from '@/lib/voice/conversation';
import { toSpeakable } from '@/lib/voice/speechText';
import { missingVoiceReason, resolveProviderVoice } from '@/lib/voice/settings';
import type { VoiceProviderInfo } from '@/lib/voice/providers';
import { useSpeech } from './useSpeech';
import { useListening } from './useListening';
import { useVoiceSettings } from './useVoiceSettings';

export interface VoiceConversationOptions {
  /** An agent turn is streaming */
  running: boolean;
  pendingQuestion: { question: string; options?: string[] } | null;
  /** Cancel the running turn; resolve false when the request failed */
  onStop: () => Promise<boolean | void> | boolean | void;
  /** Answer the pending ask_user question */
  onAnswer: (answer: string) => void;
  /** Queue a message into the running turn */
  onSteer: (text: string) => Promise<SteerOutcome> | SteerOutcome;
  /** Start a new turn */
  onPrompt: (text: string) => void;
}

export type VoicePhase = 'off' | 'listening' | 'speaking' | 'thinking' | 'unsupported' | 'error';

export type { HeardUtterance, SteerOutcome };

const NARRATOR_TICK_MS = 300;
const READ_ALOUD_MAX_CHARS = 3_000;

/**
 * Hands-free conversation with the agent: narrates stream events, listens
 * continuously and routes what the user says (stop, be quiet, answer, steer,
 * new request) through ConversationController. Owned by ChatPanel;
 * MessageInput renders its controls.
 */
export function useVoiceConversation(options: VoiceConversationOptions) {
  const { settings, updateSettings } = useVoiceSettings();
  const [active, setActive] = useState(false);
  const [providers, setProviders] = useState<VoiceProviderInfo[] | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [heard, setHeard] = useState<HeardUtterance | null>(null);
  // A spoken stop or steer that could not be carried out
  const [problem, setProblem] = useState<string | null>(null);
  const [providersRequest, setProvidersRequest] = useState(0);

  const speech = useSpeech({
    engine: settings.engine,
    voice: resolveProviderVoice(settings, providers),
    browserVoice: settings.browserVoice,
    rate: settings.rate,
    pitch: settings.pitch,
    missingVoice: missingVoiceReason(settings, providers, providersError),
  });

  const latest = useRef({ options, active, settings, speech });
  useLayoutEffect(() => {
    latest.current = { options, active, settings, speech };
  });

  const controllerRef = useRef<ConversationController | null>(null);
  const controller = useCallback(() => {
    controllerRef.current ??= new ConversationController((): ConversationEnv => {
      const { options: o, settings: s, speech: sp } = latest.current;
      return {
        speech: {
          speak: sp.speak,
          cancel: sp.cancel,
          isSpeaking: () => sp.speaking,
          recentSpoken: sp.recentSpoken,
          currentText: sp.currentText,
        },
        running: o.running,
        pendingQuestion: o.pendingQuestion,
        bargeIn: s.bargeIn,
        onStop: o.onStop,
        onAnswer: o.onAnswer,
        onSteer: o.onSteer,
        onPrompt: o.onPrompt,
        onHeard: setHeard,
        onProblem: setProblem,
      };
    });
    return controllerRef.current;
  }, []);

  // Provider voices for server engines (and the settings panel)
  const needProviders = settings.engine !== 'browser' || providersRequest > 0;
  useEffect(() => {
    if (!needProviders) return;
    let cancelled = false;
    fetch('/api/voice')
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { providers?: VoiceProviderInfo[]; error?: string };
        if (cancelled) return;
        if (!res.ok || !Array.isArray(data.providers)) throw new Error(data.error || `HTTP ${res.status}`);
        setProviders(data.providers);
        setProvidersError(null);
        // A key may have been added since a server voice failed: give it another try
        latest.current.speech.unblockServer();
      })
      .catch((err: unknown) => {
        if (!cancelled) setProvidersError(`Could not list voices (${err instanceof Error ? err.message : String(err)}).`);
      });
    return () => {
      cancelled = true;
    };
  }, [needProviders, providersRequest]);

  const refreshProviders = useCallback(() => setProvidersRequest((n) => n + 1), []);

  // A key saved or removed in Settings → API keys changes which server voices
  // work: re-read providers (which also lifts a "missing key" block)
  useEffect(() => {
    const onChanged = () => refreshProviders();
    window.addEventListener('oc-settings-changed', onChanged);
    return () => window.removeEventListener('oc-settings-changed', onChanged);
  }, [refreshProviders]);

  /** Feed every processed stream event; speaks when voice mode or "read replies" is on. */
  const narrate = useCallback(
    (event: NarrationEvent) => {
      const { active: on, settings: s } = latest.current;
      controller().narrate(event, narrationLevel(on, s));
    },
    [controller]
  );

  /** Call when a stream starts; `replay` skips the history a reconnect replays. */
  const beginTurn = useCallback((opts: { replay?: boolean } = {}) => controller().beginTurn(opts), [controller]);

  const narrating = active || settings.readReplies;
  useEffect(() => {
    if (!narrating) return;
    const id = setInterval(() => controller().tick(), NARRATOR_TICK_MS);
    return () => clearInterval(id);
  }, [narrating, controller]);

  const handleFinal = useCallback((text: string) => controller().handleFinal(text), [controller]);
  const handleInterim = useCallback((interim: string) => controller().handleInterim(interim), [controller]);

  const listening = useListening({
    enabled: active,
    // Without barge-in the mic closes while the agent talks so it cannot hear itself
    paused: !settings.bargeIn && speech.speaking,
    onFinal: handleFinal,
    onInterim: handleInterim,
  });

  const setVoiceMode = useCallback(
    (on: boolean) => {
      const { speech: sp } = latest.current;
      setActive(on);
      setHeard(null);
      setProblem(null);
      sp.clearError();
      if (!on) {
        sp.cancel();
        controller().reset();
        return;
      }
      // Spoken from the click, which also unlocks audio playback
      sp.speak(
        listening.supported ? 'Voice mode on. I am listening.' : 'Voice input needs Chrome or Edge, but I will read my replies aloud.',
        { priority: 'high' }
      );
    },
    [listening.supported, controller]
  );

  const toggle = useCallback(() => setVoiceMode(!latest.current.active), [setVoiceMode]);
  const clearProblem = useCallback(() => setProblem(null), []);

  /** Read one message aloud (or stop if it is the one being read). */
  const readAloud = useCallback((markdown: string, tag: string) => {
    const { speech: sp } = latest.current;
    if (sp.currentTag === tag) {
      sp.cancel();
      return;
    }
    const text = toSpeakable(markdown, READ_ALOUD_MAX_CHARS);
    if (!text) return;
    sp.cancel();
    sp.speak(text, { priority: 'high', tag });
  }, []);

  const testVoice = useCallback(() => {
    const { speech: sp } = latest.current;
    sp.cancel();
    sp.clearError();
    // Testing is how the user checks a fixed key or voice, so do not skip the server voice
    sp.unblockServer();
    sp.speak("Hi! This is how I'll sound while I work on your project.", { priority: 'high' });
  }, []);

  let phase: VoicePhase = 'off';
  if (active) {
    if (speech.speaking) phase = 'speaking';
    else if (!listening.supported) phase = 'unsupported';
    else if (listening.error && !listening.listening) phase = 'error';
    else if (options.running) phase = 'thinking';
    else phase = 'listening';
  }

  // What was heard before the microphone failed is stale: the error takes its place
  const [prevPhase, setPrevPhase] = useState(phase);
  if (phase !== prevPhase) {
    setPrevPhase(phase);
    if (phase === 'error') setHeard(null);
  }

  return {
    active,
    phase,
    toggle,
    setVoiceMode,
    settings,
    updateSettings,
    providers,
    providersError,
    refreshProviders,
    speech,
    listening,
    heard,
    problem,
    clearProblem,
    narrate,
    beginTurn,
    readAloud,
    testVoice,
  };
}

export type VoiceConversation = ReturnType<typeof useVoiceConversation>;
