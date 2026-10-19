'use client';

import { useEffect, useRef } from 'react';

/**
 * Live microphone level (0..1 RMS) for visualizers. Opens its own
 * getUserMedia stream while `enabled` and samples it in a rAF loop; the
 * latest level lands in `levelRef` so canvas loops can read it without
 * re-rendering React 60 times a second.
 */
export function useMicLevel(enabled: boolean) {
  const levelRef = useRef(0);

  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.getUserMedia) {
      levelRef.current = 0;
      return;
    }
    let disposed = false;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      .then((s) => {
        if (disposed) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AudioContextClass();
        void ctx.resume();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);

        const tick = () => {
          if (disposed) return;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          // Smooth toward the target so the halo breathes instead of jittering
          const target = Math.min(1, rms * 6);
          levelRef.current += (target - levelRef.current) * 0.25;
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => {
        // Mic denied: the visualizer just stays idle; voice mode reports the error itself
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      levelRef.current = 0;
      stream?.getTracks().forEach((t) => t.stop());
      if (ctx) {
        try {
          void ctx.close();
        } catch {
          // already closed
        }
      }
    };
  }, [enabled]);

  return levelRef;
}
