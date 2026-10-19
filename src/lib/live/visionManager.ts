/**
 * Vision Manager for Gemini Live:
 * - Captures screen share or camera stream
 * - Extracts JPEG frames at 1-2 FPS with adaptive downscaling
 * - Encodes frames as base64 for Gemini Live ingestion
 * - Exposes active MediaStream for local PiP preview
 */

import { VisionSource } from './types';

export class VisionManager {
  private currentStream: MediaStream | null = null;
  private currentSource: VisionSource = 'none';
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private frameTimer: NodeJS.Timeout | null = null;
  private onFrameChunk: ((base64Jpeg: string) => void) | null = null;
  private onSourceChange: ((source: VisionSource) => void) | null = null;

  constructor(
    onFrameChunk?: (base64Jpeg: string) => void,
    onSourceChange?: (source: VisionSource) => void
  ) {
    if (onFrameChunk) this.onFrameChunk = onFrameChunk;
    if (onSourceChange) this.onSourceChange = onSourceChange;
  }

  public setFrameHandler(handler: (base64Jpeg: string) => void) {
    this.onFrameChunk = handler;
  }

  public setSourceChangeHandler(handler: (source: VisionSource) => void) {
    this.onSourceChange = handler;
  }

  public getSource(): VisionSource {
    return this.currentSource;
  }

  public getStream(): MediaStream | null {
    return this.currentStream;
  }

  /**
   * Start screen sharing
   */
  public async startScreenShare(): Promise<MediaStream> {
    this.stopVision();

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'monitor',
      },
      audio: false,
    });

    this.setupStream(stream, 'screen');
    return stream;
  }

  /**
   * Start camera video
   */
  public async startCamera(): Promise<MediaStream> {
    this.stopVision();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
      audio: false,
    });

    this.setupStream(stream, 'camera');
    return stream;
  }

  /**
   * Stop any active vision stream
   */
  public stopVision(): void {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }

    if (this.currentStream) {
      for (const track of this.currentStream.getTracks()) {
        track.stop();
      }
      this.currentStream = null;
    }

    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }

    this.currentSource = 'none';
    if (this.onSourceChange) {
      this.onSourceChange('none');
    }
  }

  private setupStream(stream: MediaStream, source: VisionSource) {
    this.currentStream = stream;
    this.currentSource = source;

    // Track user stopping share via browser UI
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.onended = () => {
        this.stopVision();
      };
    }

    // Hidden video element to read video dimensions
    this.videoEl = document.createElement('video');
    this.videoEl.autoplay = true;
    this.videoEl.muted = true;
    this.videoEl.playsInline = true;
    this.videoEl.srcObject = stream;
    void this.videoEl.play();

    this.canvasEl = document.createElement('canvas');

    if (this.onSourceChange) {
      this.onSourceChange(source);
    }

    // Send a frame every 1000ms (1 FPS)
    this.frameTimer = setInterval(() => {
      this.captureAndSendFrame();
    }, 1000);

    // Also send first frame immediately once video is playing
    setTimeout(() => {
      this.captureAndSendFrame();
    }, 400);
  }

  private captureAndSendFrame() {
    if (!this.videoEl || !this.canvasEl || !this.onFrameChunk) return;
    if (this.videoEl.readyState < 2) return;

    let width = this.videoEl.videoWidth;
    let height = this.videoEl.videoHeight;
    if (!width || !height) return;

    // Downscale maintaining aspect ratio to max 1024px for low latency
    const maxDim = 1024;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    this.canvasEl.width = width;
    this.canvasEl.height = height;

    const ctx = this.canvasEl.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(this.videoEl, 0, 0, width, height);

    // Export to JPEG quality 0.65
    const dataUrl = this.canvasEl.toDataURL('image/jpeg', 0.65);
    const base64 = dataUrl.split(',')[1];
    if (base64) {
      this.onFrameChunk(base64);
    }
  }

  public cleanup(): void {
    this.stopVision();
    this.canvasEl = null;
  }
}
