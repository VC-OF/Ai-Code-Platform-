'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSpeechRecognition, type SpeechRecognitionLike } from './speechRecognition';
import { MediaRecorderTranscriber, isRecorderSupported } from './serverTranscriber';

export interface ListeningOptions {
  enabled: boolean;
  /** Controlled pause, e.g. while the agent is speaking */
  paused?: boolean;
  /** BCP 47 tag; defaults to the browser language */
  lang?: string;
  onFinal: (text: string) => void;
  /** Live partial transcript (barge-in detection) */
  onInterim?: (text: string) => void;
}

export const MIC_BLOCKED_MESSAGE =
  'Microphone access is blocked. Allow the microphone for this site (the icon in the address bar), then turn voice mode off and on.';
const NO_MIC_MESSAGE = 'No microphone was found. Connect one, then turn voice mode off and on.';

const subscribeNothing = () => () => {};
const recognitionSupported = () => getSpeechRecognition() !== null || isRecorderSupported();

/**
 * Continuous speech recognition with interim results. Restarts itself when
 * the browser ends a session (silence timeouts, network blips), backing off
 * when sessions keep failing; microphone permission errors stop it for good.
 */
export function useListening({ enabled, paused = false, lang, onFinal, onInterim }: ListeningOptions) {
  const supported = useSyncExternalStore(subscribeNothing, recognitionSupported, () => false);
  const [manualPaused, setManualPaused] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const transcriberRef = useRef<MediaRecorderTranscriber | null>(null);

  const handlers = useRef({ onFinal, onInterim });
  useLayoutEffect(() => {
    handlers.current = { onFinal, onInterim };
  });

  // A fresh start clears the previous session's error (adjusted during render)
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (enabled) setError(null);
  }

  const active = enabled && supported && !paused && !manualPaused;

  useEffect(() => {
    if (!active) return;
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    const language = lang || navigator.language || 'en-US';

    let disposed = false;
    let fatal = false;
    let failures = 0;
    let recognition: SpeechRecognitionLike | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(start, ms);
    };

    const start = () => {
      if (disposed || fatal) return;
      const rec = new Recognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = language;
      const startedAt = Date.now();
      let sessionError = '';

      rec.onstart = () => {
        if (!disposed) setCapturing(true);
      };
      rec.onresult = (event) => {
        if (disposed) return;
        failures = 0;
        setError(null);
        let partial = '';
        const { results } = event;
        for (let i = event.resultIndex ?? 0; i < results.length; i++) {
          const result = results[i];
          const transcript = result?.[0]?.transcript ?? '';
          if (result?.isFinal) {
            const text = transcript.replace(/\s+/g, ' ').trim();
            if (text) handlers.current.onFinal(text);
          } else {
            partial += transcript;
          }
        }
        const live = partial.replace(/\s+/g, ' ').trim();
        setInterim(live);
        if (live) handlers.current.onInterim?.(live);
      };
      rec.onerror = (event) => {
        sessionError = event.error ?? 'unknown';
        if (sessionError === 'not-allowed' || sessionError === 'service-not-allowed') {
          fatal = true;
          setError(MIC_BLOCKED_MESSAGE);
        } else if (sessionError === 'audio-capture') {
          fatal = true;
          setError(NO_MIC_MESSAGE);
        } else if (sessionError === 'language-not-supported') {
          fatal = true;
          setError(`Speech recognition does not support ${language}.`);
        } else if (sessionError === 'network') {
          setError('Speech recognition lost its connection. Retrying…');
        }
        // "no-speech" and "aborted" are routine; onend restarts
      };
      rec.onend = () => {
        if (recognition === rec) recognition = null;
        if (disposed) return;
        setCapturing(false);
        setInterim('');
        if (fatal) return;
        const routine = !sessionError || sessionError === 'no-speech' || sessionError === 'aborted';
        const shortLived = Date.now() - startedAt < 1_000;
        failures = routine && !shortLived ? 0 : failures + 1;
        schedule(failures === 0 ? 150 : Math.min(300 * 2 ** (failures - 1), 8_000));
      };

      recognition = rec;
      try {
        rec.start();
      } catch {
        // start() throws if a previous session is still closing
        recognition = null;
        failures += 1;
        schedule(Math.min(300 * 2 ** (failures - 1), 8_000));
      }
    };

    schedule(0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      const rec = recognition;
      recognition = null;
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.onstart = null;
        try {
          if (rec.abort) rec.abort();
          else rec.stop();
        } catch {
          // already stopped
        }
      }
      // The aborted session's partial was discarded; do not show it on resume
      setCapturing(false);
      setInterim('');
    };
  }, [active, lang]);

  // ── Server transcription fallback (no Web Speech API) ────────────────────
  // Records with MediaRecorder, then POSTs the clip to /api/voice/stt.
  // Utterances arrive as final text only; there is no live partial.
  // The engine is derived during render (recognizer when present, recorder
  // otherwise), so the effect body never calls setState synchronously.
  const hasRecognizer = getSpeechRecognition() !== null;
  useEffect(() => {
    if (!active || hasRecognizer || !isRecorderSupported()) return;
    let disposed = false;
    let transcriber: MediaRecorderTranscriber | null = null;

    const run = async () => {
      transcriber = new MediaRecorderTranscriber();
      transcriberRef.current = transcriber;
      try {
        await transcriber.start(
          (text) => {
            if (!disposed) handlers.current.onFinal(text);
          },
          (err) => {
            if (disposed) return;
            setError(err);
          }
        );
        setCapturing(true);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
          setCapturing(false);
        }
      }
    };
    void run();

    return () => {
      disposed = true;
      transcriberRef.current = null;
      transcriber?.stop();
      setCapturing(false);
    };
  }, [active, hasRecognizer]);

  const pause = useCallback(() => setManualPaused(true), []);
  const resume = useCallback(() => setManualPaused(false), []);

  // Derived input engine: the live browser recognizer when available, the
  // server transcriber otherwise, null when neither exists (unsupported).
  const mode: 'recognizer' | 'server' | null = !supported
    ? null
    : hasRecognizer
      ? 'recognizer'
      : 'server';

  return {
    supported,
    /** How the microphone input is recognized: live browser recognizer or recorded clips sent to a server */
    mode,
    /** The microphone is open right now */
    listening: active && capturing,
    interim: active && mode === 'recognizer' ? interim : '',
    error,
    pause,
    resume,
    paused: paused || manualPaused,
  };
}

export type ListeningController = ReturnType<typeof useListening>;
