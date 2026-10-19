export type LiveConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type LiveVoice = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede';

export interface LiveTranscript {
  id: string;
  role: 'user' | 'gemini';
  text: string;
  timestamp: number;
}

export type VisionSource = 'none' | 'screen' | 'camera';

export interface LiveSessionConfig {
  apiKey: string;
  voice: LiveVoice;
  systemInstruction?: string;
  projectName?: string;
  activeFile?: string;
  activeCode?: string;
}

export interface LiveRealtimeChunk {
  mimeType: string;
  data: string; // base64
}
