/**
 * Web Audio manager for Gemini Live:
 * - Captures mic, resamples to 16kHz linear 16-bit PCM mono, sends base64 chunks
 * - Plays model 24kHz linear 16-bit PCM audio chunks with seamless scheduling
 * - Handles barge-in / immediate interruption
 * - Exposes AnalyserNodes for dynamic orb visualizer
 */

export class AudioManager {
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private inputProcessor: ScriptProcessorNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;

  private onAudioChunk: ((base64Pcm: string) => void) | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private nextPlayTime = 0;
  private isMuted = false;
  private isListening = false;

  constructor(onAudioChunk?: (base64Pcm: string) => void) {
    if (onAudioChunk) {
      this.onAudioChunk = onAudioChunk;
    }
  }

  public setChunkHandler(handler: (base64Pcm: string) => void) {
    this.onAudioChunk = handler;
  }

  /**
   * Start microphone recording and streaming PCM chunks.
   */
  public async startMicrophone(): Promise<void> {
    if (this.isListening) return;

    // 1. Get microphone stream
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.inputCtx = new AudioContextClass();
    await this.inputCtx.resume();

    // 2. Set up analyzer for input volume
    this.inputAnalyser = this.inputCtx.createAnalyser();
    this.inputAnalyser.fftSize = 64;

    this.micSource = this.inputCtx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.inputAnalyser);

    // 3. Set up ScriptProcessor for capturing raw PCM
    const bufferSize = 4096;
    this.inputProcessor = this.inputCtx.createScriptProcessor(bufferSize, 1, 1);

    this.inputProcessor.onaudioprocess = (e) => {
      if (this.isMuted || !this.onAudioChunk) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const inputSampleRate = this.inputCtx?.sampleRate || 48000;

      // Downsample to 16000 Hz 16-bit PCM
      const pcm16 = this.downsampleTo16k(inputData, inputSampleRate);
      if (pcm16.length === 0) return;

      const base64 = this.pcm16ToBase64(pcm16);
      this.onAudioChunk(base64);
    };

    this.micSource.connect(this.inputProcessor);
    // Connect to destination via silent gain to keep script processor ticking
    const silentGain = this.inputCtx.createGain();
    silentGain.gain.value = 0;
    this.inputProcessor.connect(silentGain);
    silentGain.connect(this.inputCtx.destination);

    this.isListening = true;
  }

  /**
   * Stop microphone input
   */
  public stopMicrophone(): void {
    if (this.inputProcessor) {
      try {
        this.inputProcessor.disconnect();
      } catch {}
      this.inputProcessor = null;
    }
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {}
      this.micSource = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }
    if (this.inputCtx) {
      try {
        this.inputCtx.close();
      } catch {}
      this.inputCtx = null;
    }
    this.isListening = false;
  }

  /**
   * Initialize output audio context for 24kHz playback
   */
  private getOrCreateOutputContext(): AudioContext {
    if (!this.outputCtx || this.outputCtx.state === 'closed') {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.outputCtx = new AudioContextClass({ sampleRate: 24000 });
      this.outputAnalyser = this.outputCtx.createAnalyser();
      this.outputAnalyser.fftSize = 64;
      this.outputAnalyser.connect(this.outputCtx.destination);
      this.nextPlayTime = this.outputCtx.currentTime;
    }
    if (this.outputCtx.state === 'suspended') {
      void this.outputCtx.resume();
    }
    return this.outputCtx;
  }

  /**
   * Play incoming 24kHz PCM chunk from Gemini Live
   */
  public playPcmChunk(base64Pcm: string): void {
    const ctx = this.getOrCreateOutputContext();
    const pcm16 = this.base64ToPcm16(base64Pcm);
    if (pcm16.length === 0) return;

    // Convert Int16 to Float32 [-1.0, 1.0]
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    if (this.outputAnalyser) {
      source.connect(this.outputAnalyser);
    } else {
      source.connect(ctx.destination);
    }

    const now = ctx.currentTime;
    const startTime = Math.max(now, this.nextPlayTime);
    source.start(startTime);
    this.nextPlayTime = startTime + audioBuffer.duration;
    this.activeSources.push(source);

    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
    };
  }

  /**
   * Interruption / Barge-in: immediately halts any buffered or active model speech
   */
  public stopPlayback(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    }
    this.activeSources = [];
    if (this.outputCtx) {
      this.nextPlayTime = this.outputCtx.currentTime;
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public isMicActive(): boolean {
    return this.isListening;
  }

  /**
   * Calculate current activity levels (0 to 1) for visualization
   */
  public getVisualizerLevels(): { inputLevel: number; outputLevel: number } {
    let inputLevel = 0;
    let outputLevel = 0;

    if (this.inputAnalyser && !this.isMuted && this.isListening) {
      const data = new Uint8Array(this.inputAnalyser.frequencyBinCount);
      this.inputAnalyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      inputLevel = Math.min(1, (sum / data.length) / 80);
    }

    if (this.outputAnalyser && this.activeSources.length > 0) {
      const data = new Uint8Array(this.outputAnalyser.frequencyBinCount);
      this.outputAnalyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      outputLevel = Math.min(1, (sum / data.length) / 70);
    }

    return { inputLevel, outputLevel };
  }

  public cleanup(): void {
    this.stopMicrophone();
    this.stopPlayback();
    if (this.outputCtx) {
      try {
        void this.outputCtx.close();
      } catch {}
      this.outputCtx = null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
    const targetRate = 16000;
    if (inputRate === targetRate) {
      const out = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return out;
    }

    const ratio = inputRate / targetRate;
    const newLen = Math.round(input.length / ratio);
    const result = new Int16Array(newLen);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i++) {
        accum += input[i];
        count++;
      }
      const avg = count > 0 ? accum / count : 0;
      const s = Math.max(-1, Math.min(1, avg));
      result[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7fff;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }

    return result;
  }

  private pcm16ToBase64(pcm: Int16Array): string {
    const bytes = new Uint8Array(pcm.buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToPcm16(base64: string): Int16Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
  }
}
