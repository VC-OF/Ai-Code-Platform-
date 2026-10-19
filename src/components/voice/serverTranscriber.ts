'use client';

// Server-side transcription fallback for browsers without the Web Speech
// API (Firefox, Safari): records mic audio with MediaRecorder in utterance
// chunks and POSTs each clip to /api/voice/stt, which returns final text.
// Keyless from the client — the key lives server-side, like TTS.

const CHUNK_SILENCE_MS = 900; // split utterances on ~0.9 s of quiet
const SILENCE_THRESHOLD = 0.012; // RMS below this counts as quiet
const MIN_UTTERANCE_MS = 350;
const MAX_CHUNK_MS = 20_000; // hard split for continuous speech
const POLL_MS = 100;

export function isRecorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export class MediaRecorderTranscriber {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private chunks: Blob[] = [];
  private chunkStartedAt = 0;
  private quietSince: number | null = null;
  private busy = false;
  private running = false;

  async start(onFinal: (text: string) => void, onError: (message: string) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    this.recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000); // timeslice keeps chunks small while we monitor silence

    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass();
    await this.ctx.resume();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);

    this.running = true;
    this.chunkStartedAt = Date.now();
    this.pollTimer = setInterval(() => {
      if (this.busy || !this.running) return;
      const rms = this.currentRms();
      const now = Date.now();
      const quiet = rms < SILENCE_THRESHOLD;
      if (quiet && this.quietSince === null) this.quietSince = now;
      if (!quiet) this.quietSince = null;

      const chunkMs = now - this.chunkStartedAt;
      const longQuiet = this.quietSince !== null && now - this.quietSince >= CHUNK_SILENCE_MS;
      if (chunkMs >= MIN_UTTERANCE_MS && (longQuiet || chunkMs >= MAX_CHUNK_MS)) {
        this.flush(onFinal, onError);
        this.chunkStartedAt = now;
        this.quietSince = null;
      }
    }, POLL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      // already stopped
    }
    this.recorder = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        // already closed
      }
      this.ctx = null;
    }
    this.analyser = null;
    this.chunks = [];
  }

  private currentRms(): number {
    if (!this.analyser) return 1; // never treat "unknown" as silence
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  /** Send the buffered clip; continue recording while the request runs. */
  private async flush(onFinal: (text: string) => void, onError: (message: string) => void): Promise<void> {
    if (!this.recorder) return;
    if (this.recorder.state === 'inactive') return;
    this.busy = true;
    this.recorder.stop(); // finalizes the current Blob
    const recorder = this.recorder;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      setTimeout(resolve, 500); // don't hang if onstop never fires
    });
    const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
    this.chunks = [];
    this.recorder = this.stream && !this.running ? null : this.newRecorder(recorder.mimeType);

    if (blob.size < 2000) {
      this.busy = false; // sub-second noise burst: not worth a request
      return;
    }
    try {
      const form = new FormData();
      form.append('audio', new File([blob], 'utterance.webm', { type: blob.type || 'audio/webm' }));
      form.append('provider', 'openai');
      const res = await fetch('/api/voice/stt', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        onError(data.error || `Transcription failed (HTTP ${res.status}).`);
      } else if (data.text && data.text.trim()) {
        onFinal(data.text.trim());
      }
    } catch {
      onError('Transcription request failed. Check the connection and try again.');
    } finally {
      this.busy = false;
    }
  }

  private newRecorder(mimeType: string): MediaRecorder | null {
    if (!this.stream || !this.running) return null;
    try {
      const rec = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      rec.start(1000);
      this.recorder = rec;
      return rec;
    } catch {
      return null;
    }
  }
}
