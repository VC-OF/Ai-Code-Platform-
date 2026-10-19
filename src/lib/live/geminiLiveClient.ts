/**
 * Gemini Live Client:
 * Manages WebSocket session with Gemini Multimodal Live API (BidiGenerateContent)
 */

import { LiveConnectionState, LiveSessionConfig } from './types';

export interface GeminiLiveCallbacks {
  onStateChange: (state: LiveConnectionState, error?: string) => void;
  onAudioOutput: (base64Pcm: string) => void;
  onInterrupted: () => void;
  onTranscriptChunk: (text: string) => void;
  onTurnComplete: () => void;
}

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private state: LiveConnectionState = 'disconnected';
  private config: LiveSessionConfig | null = null;
  private callbacks: GeminiLiveCallbacks;

  constructor(callbacks: GeminiLiveCallbacks) {
    this.callbacks = callbacks;
  }

  public getState(): LiveConnectionState {
    return this.state;
  }

  /**
   * Connect to Gemini Live WebSocket
   */
  public connect(config: LiveSessionConfig): void {
    if (this.ws) {
      this.disconnect();
    }

    this.config = config;
    this.setState('connecting');

    const apiKey = config.apiKey.trim();
    if (!apiKey) {
      this.setState('error', 'Google Gemini API Key is required');
      return;
    }

    const host = 'generativelanguage.googleapis.com';
    const path = '/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
    const url = `wss://${host}${path}?key=${encodeURIComponent(apiKey)}`;

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState('error', `Failed to open connection: ${msg}`);
      return;
    }

    this.ws.onopen = () => {
      this.sendSetupMessage();
    };

    this.ws.onmessage = async (event) => {
      let data = event.data;
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        data = await data.text();
      } else if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
        data = new TextDecoder().decode(data);
      }
      this.handleMessage(data);
    };

    this.ws.onerror = () => {
      this.setState('error', 'WebSocket connection error');
    };

    this.ws.onclose = (e) => {
      if (this.state !== 'disconnected') {
        const reason = e.reason || (e.code !== 1000 ? `Closed (code ${e.code})` : undefined);
        this.setState(e.code === 1000 ? 'disconnected' : 'error', reason);
      }
      this.ws = null;
    };
  }

  /**
   * Send the initial Setup message with model and voice parameters
   */
  private sendSetupMessage() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.config) return;

    let sysPrompt =
      'You are Gemini Live, an expert real-time AI pair programmer and coding companion. ' +
      'You have live vision and live voice capabilities. You can see the user\'s screen or camera and hear them speak. ' +
      'Keep answers spoken, natural, concise, and helpful. You are collaborating in a code editor environment.';

    if (this.config.projectName) {
      sysPrompt += ` Active project: "${this.config.projectName}".`;
    }
    if (this.config.activeFile) {
      sysPrompt += ` Current active file in editor: "${this.config.activeFile}".`;
    }
    if (this.config.systemInstruction) {
      sysPrompt += ` Additional guidance: ${this.config.systemInstruction}`;
    }

    const setupMsg = {
      setup: {
        model: 'models/gemini-3.8-live',
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.config.voice || 'Puck',
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: sysPrompt }],
        },
      },
    };

    this.ws.send(JSON.stringify(setupMsg));
  }

  /**
   * Handle incoming WebSocket events from Gemini
   */
  private handleMessage(data: unknown) {
    if (typeof data !== 'string') return;

    try {
      const msg = JSON.parse(data);

      // 1. Setup completed confirmation
      if (msg.setupComplete) {
        this.setState('connected');
        // If code snapshot was provided at launch, send it as initial turn
        if (this.config?.activeCode && this.config.activeFile) {
          this.sendTextMessage(
            `Context of current active file (${this.config.activeFile}):\n\`\`\`\n${this.config.activeCode.slice(0, 4000)}\n\`\`\``
          );
        }
        return;
      }

      // 2. Server turn content
      if (msg.serverContent) {
        const sc = msg.serverContent;

        // Interruption (barge-in): user began speaking while model was outputting
        if (sc.interrupted) {
          this.callbacks.onInterrupted();
        }

        // Output parts (audio PCM chunks + text)
        if (sc.modelTurn?.parts && Array.isArray(sc.modelTurn.parts)) {
          for (const part of sc.modelTurn.parts) {
            // Audio PCM inlineData
            if (part.inlineData?.data) {
              this.callbacks.onAudioOutput(part.inlineData.data);
            }
            // Transcribed text
            if (part.text) {
              this.callbacks.onTranscriptChunk(part.text);
            }
          }
        }

        if (sc.turnComplete) {
          this.callbacks.onTurnComplete();
        }
      }
    } catch {
      // Ignored parse error on malformed message
    }
  }

  /**
   * Stream a real-time media chunk (audio PCM or JPEG frame)
   */
  public sendMediaChunk(mimeType: string, base64Data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType,
            data: base64Data,
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Send a text message turn into the live session (e.g. user prompt or code context)
   */
  public sendTextMessage(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };

    this.ws.send(JSON.stringify(payload));
  }

  public disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close(1000, 'User disconnected');
      } catch {}
      this.ws = null;
    }
    this.setState('disconnected');
  }

  private setState(state: LiveConnectionState, error?: string) {
    this.state = state;
    this.callbacks.onStateChange(state, error);
  }
}
