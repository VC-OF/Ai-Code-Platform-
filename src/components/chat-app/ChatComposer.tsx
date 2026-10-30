'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ChatAttachment } from '@/lib/db';
import { MODEL_OPTIONS, groupModelOptions } from '@/lib/modelOptions';

interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface ChatComposerProps {
  onSendMessage: (text: string, attachments?: ChatAttachment[]) => void;
  isStreaming: boolean;
  onStopStreaming?: () => void;
  className?: string;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  onOpenProject?: () => void;
  showToolbar?: boolean;
  lastAssistantMessage?: string;
}

function formatModelLabel(id: string): string {
  if (!id) return 'Model';
  const found = MODEL_OPTIONS.find((m) => m.value === id);
  if (found) {
    // Simplify for pill display
    return found.label.replace(/\s*\(.*?\)/g, '');
  }
  if (id.includes('claude-3-7-sonnet') || id.includes('claude-3.7-sonnet')) return 'Sonnet 3.7';
  if (id.includes('claude-3-5-sonnet') || id.includes('claude-3.5-sonnet')) return 'Sonnet 3.5';
  if (id.includes('sonnet')) return 'Sonnet 5';
  if (id.includes('gemini-flash-latest') || id.includes('gemini-2.0-flash')) return 'Gemini Flash';
  if (id.includes('gemini-pro')) return 'Gemini Pro';
  if (id.includes('deepseek-r1')) return 'DeepSeek R1';
  if (id.includes('deepseek-chat')) return 'DeepSeek V3';
  if (id.includes('gpt-4o')) return 'GPT-4o';
  if (id.includes('o3-mini')) return 'o3-mini';
  if (id.includes('kimi')) return 'Kimi K3';
  return id.replace(/^(openrouter:|anthropic\/|openai\/)/, '').slice(0, 16);
}

const SPEECH_LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'zh-CN', label: 'Chinese (Mandarin)' },
  { code: 'ja-JP', label: 'Japanese' },
];

export default function ChatComposer({
  onSendMessage,
  isStreaming,
  onStopStreaming,
  className,
  selectedModel = 'gemini-flash-latest',
  onModelChange,
  onOpenProject,
  showToolbar = true,
  lastAssistantMessage,
}: ChatComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Voice Speech-to-Text State
  const [isListening, setIsListening] = useState(false);
  const [speechLang, setSpeechLang] = useState('en-US');
  const [showMicMenu, setShowMicMenu] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Audio Waveform / TTS State
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // Models Menu State
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelSearch, setModelSearch] = useState('');

  // Thinking Effort & Mode Menus
  const [reasoningEffort, setReasoningEffort] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [showEffortMenu, setShowEffortMenu] = useState(false);
  const [runnerMode, setRunnerMode] = useState<'Manual' | 'Auto'>('Manual');
  const [showRunnerMenu, setShowRunnerMenu] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const micMenuRef = useRef<HTMLDivElement | null>(null);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 260)}px`;
    }
  }, [prompt]);

  // Close popup menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModelMenu(false);
      }
      if (micMenuRef.current && !micMenuRef.current.contains(e.target as Node)) {
        setShowMicMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtered models for dropdown
  const filteredModelGroups = useMemo(() => {
    const all = MODEL_OPTIONS;
    if (!modelSearch.trim()) return groupModelOptions(all);
    const q = modelSearch.toLowerCase();
    const filtered = all.filter(
      (m) => m.label.toLowerCase().includes(q) || m.value.toLowerCase().includes(q) || m.group.toLowerCase().includes(q)
    );
    return groupModelOptions(filtered);
  }, [modelSearch]);

  // File Upload Logic
  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      const res = await fetch('/api/chat/attachments', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Upload failed with status ${res.status}`);
      }

      const data = await res.json();
      if (data.attachments && Array.isArray(data.attachments)) {
        setAttachments((prev) => [...prev, ...data.attachments]);
      }
    } catch (err) {
      console.error('Failed to upload files:', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setTimeout(() => setUploadError(null), 4000);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // Drag & drop support on the form
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  // Speech Recognition (Dictation)
  const toggleSpeechRecognition = () => {
    const speechWindow = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const SpeechRec = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRec) {
      alert('Speech recognition is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Safari.');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = speechLang;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: SpeechRecognitionResultEvent) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript;
          }
        }
        if (transcript) {
          setPrompt((prev) => (prev ? `${prev.trim()} ${transcript.trim()}` : transcript.trim()));
        }
      };

      recognition.onerror = (e: unknown) => {
        console.warn('Speech recognition error:', e);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch (err) {
      console.error('Speech recognition start failed:', err);
      setIsListening(false);
    }
  };

  // Audio Waveform / TTS Playback
  const toggleAudioReadout = () => {
    if (isPlayingAudio) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsPlayingAudio(false);
      return;
    }

    const textToRead = lastAssistantMessage || prompt.trim();
    if (!textToRead) {
      // If nothing to read, provide brief audio cue
      return;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();

      // Clean markdown tags & code blocks for clean natural speech
      const cleanText = textToRead
        .replace(/```[\s\S]*?```/g, 'Code block omitted.')
        .replace(/<antArtifact[\s\S]*?<\/antArtifact>/gi, 'Interactive artifact rendered.')
        .replace(/:::artifact[\s\S]*?:::/gi, '')
        .replace(/[*_#`~]/g, '')
        .trim();

      const utterance = new SpeechSynthesisUtterance(cleanText.slice(0, 1500));
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      utterance.onend = () => setIsPlayingAudio(false);
      utterance.onerror = () => setIsPlayingAudio(false);

      window.speechSynthesis.speak(utterance);
      setIsPlayingAudio(true);
    }
  };

  const canSend = prompt.trim().length > 0 || attachments.length > 0;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isStreaming) {
      onStopStreaming?.();
      return;
    }
    if (!canSend) return;
    const trimmed = prompt.trim();

    onSendMessage(trimmed, attachments);
    setPrompt('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={`${className || "w-full max-w-[720px] mx-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"} min-w-0 font-sans relative`}>
      {/* Hidden file input for attachment upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleUploadFiles(e.target.files);
        }}
      />

      <form
        onSubmit={handleSubmit}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="relative flex flex-col rounded-2xl border border-[#e5e2da] dark:border-[#383632] bg-white dark:bg-[#252421] shadow-[0_2px_12px_rgba(0,0,0,0.03)] dark:shadow-xl focus-within:border-[#da7756]/60 transition-all duration-200"
      >
        {/* Uploaded Attachments Preview Bar */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3.5 pt-3 pb-1 border-b border-[#f0eee6] dark:border-[#32302b]">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#f6f5f0] dark:bg-[#2e2d29] border border-[#e8e6df] dark:border-[#3e3c36] text-xs text-[#1f1e1d] dark:text-[#ede8de] group transition-all"
              >
                {att.isImage ? (
                  <div className="w-5 h-5 rounded overflow-hidden shrink-0 bg-black/10 flex items-center justify-center">
                    {att.dataUrl || att.url ? (
                      // 20px thumbnail of a data:/upload URL — next/image adds nothing here
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={att.dataUrl || att.url} alt={att.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[10px]">🖼️</span>
                    )}
                  </div>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-[#8c887e] shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                <span className="max-w-[130px] truncate font-medium">{att.name}</span>
                <span className="text-[10px] text-[#8c887e]">({Math.round(att.size / 1024) || 1}KB)</span>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(att.id)}
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[#8c887e] hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors ml-0.5"
                  title="Remove attachment"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload Spinner / Status Indicator */}
        {isUploading && (
          <div className="flex items-center gap-2 px-4 pt-2 text-xs text-[#da7756] animate-pulse">
            <span className="w-3 h-3 border-2 border-[#da7756] border-t-transparent rounded-full animate-spin" />
            <span>Uploading attachments...</span>
          </div>
        )}

        {uploadError && (
          <div className="px-4 pt-2 text-xs text-red-500 font-medium">
            ⚠️ {uploadError}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="How can I help you today?"
          rows={3}
          aria-label="Message"
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] text-[#1f1e1d] dark:text-[#f5f1e8] placeholder-[#9c978b] dark:placeholder-[#7d796e] focus:outline-none max-h-64 leading-relaxed font-sans"
        />

        {/* Bottom card row: + on left, mic + chevron + waveform + send on right */}
        <div className="flex items-center justify-between px-3.5 pb-3 pt-1">
          {/* Left action: + button for local file attachment & project context */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#737067] dark:text-[#9b968a] hover:text-[#1f1e1d] dark:hover:text-[#ede8de] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              title="Add files or attachments (+)"
              aria-label="Attach files"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* Right actions: Dictation mic + chevron, Audio waveform, and Send button */}
          <div className="flex items-center gap-1 relative">
            {/* Speech Dictation Mic Button */}
            <div className="flex items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
              <button
                type="button"
                onClick={toggleSpeechRecognition}
                className={`p-1.5 rounded-l-lg transition-colors cursor-pointer flex items-center justify-center ${
                  isListening
                    ? 'text-red-500 animate-pulse bg-red-50 dark:bg-red-950/30'
                    : 'text-[#737067] dark:text-[#9b968a] hover:text-[#1f1e1d] dark:hover:text-[#ede8de]'
                }`}
                title={isListening ? 'Stop listening (dictating...)' : 'Voice dictation (speech-to-text)'}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-15a3 3 0 00-3 3v4a3 3 0 006 0V7a3 3 0 00-3-3z" />
                </svg>
              </button>

              {/* Mic Chevron Dropdown Toggle */}
              <button
                type="button"
                onClick={() => setShowMicMenu(!showMicMenu)}
                className="px-1 py-1.5 text-[#737067] dark:text-[#9b968a] hover:text-[#1f1e1d] dark:hover:text-[#ede8de] rounded-r-lg cursor-pointer"
                title="Voice settings and language"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Mic Options Menu */}
            {showMicMenu && (
              <div
                ref={micMenuRef}
                className="absolute right-12 bottom-10 z-50 w-52 py-1.5 rounded-xl bg-white dark:bg-[#252421] border border-[#e5e2da] dark:border-[#383632] shadow-xl text-xs text-[#1f1e1d] dark:text-[#ede8de]"
              >
                <div className="px-3 py-1 font-semibold text-[11px] text-[#737067] dark:text-[#9b968a] uppercase tracking-wider">
                  Dictation Language
                </div>
                {SPEECH_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      setSpeechLang(lang.code);
                      setShowMicMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-[#f0eee6] dark:hover:bg-[#2f2e29] cursor-pointer ${
                      speechLang === lang.code ? 'font-semibold text-[#da7756]' : ''
                    }`}
                  >
                    <span>{lang.label}</span>
                    {speechLang === lang.code && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}

            {/* Audio Waveform / TTS Readout Button */}
            <button
              type="button"
              onClick={toggleAudioReadout}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                isPlayingAudio
                  ? 'text-[#da7756] bg-[#da7756]/10 animate-pulse'
                  : 'text-[#737067] dark:text-[#9b968a] hover:text-[#1f1e1d] dark:hover:text-[#ede8de] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              title={isPlayingAudio ? 'Stop speaking' : 'Read aloud (text-to-speech)'}
            >
              {isPlayingAudio ? (
                <div className="flex items-center gap-[2px] h-4">
                  <span className="w-[3px] h-3 bg-[#da7756] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-[3px] h-4 bg-[#da7756] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-[3px] h-2 bg-[#da7756] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  <span className="w-[3px] h-4 bg-[#da7756] rounded-full animate-bounce" style={{ animationDelay: '450ms' }} />
                </div>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M8 6v12M4 9v6M16 6v12M20 9v6" />
                </svg>
              )}
            </button>

            {/* Send or Stop Button */}
            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStreaming}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-[#da7756] hover:bg-[#c96c4d] text-white shadow-xs transition-transform active:scale-95 cursor-pointer ml-1"
                title="Stop response"
              >
                <span className="w-2.5 h-2.5 rounded-[2px] bg-white"></span>
              </button>
            ) : (
              // Always rendered (like Claude) so the control doesn't jump in; disabled until there's input
              <button
                type="submit"
                aria-label="Send message"
                disabled={!canSend}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-[#da7756] hover:bg-[#c96c4d] text-white shadow-xs transition-transform active:scale-95 cursor-pointer ml-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#da7756] disabled:active:scale-100"
                title="Send message (Enter)"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Below Card Toolbar: Project or folder ⌄ on left, All Available Models / Medium / Manual on right */}
      {showToolbar && (
        <div className="flex items-center justify-between px-2 pt-2.5 text-xs text-[#737067] dark:text-[#9c978b] select-none relative">
          {/* Project or Folder Link */}
          <button
            type="button"
            onClick={() => onOpenProject?.()}
            className="flex items-center gap-1 hover:text-[#1f1e1d] dark:hover:text-[#ede8de] transition-colors cursor-pointer group"
          >
            <span>Project or folder</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="group-hover:translate-y-0.5 transition-transform">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Right Toolbar Controls: Models dropdown, Reasoning effort, Runner mode */}
          <div className="flex items-center gap-3.5 sm:gap-4">
            {/* Interactive Model Selector Dropdown */}
            <div className="relative" ref={modelMenuRef}>
              <button
                type="button"
                onClick={() => setShowModelMenu(!showModelMenu)}
                className="font-semibold text-[#1f1e1d] dark:text-[#ede8de] hover:text-[#da7756] dark:hover:text-[#da7756] transition-colors cursor-pointer flex items-center gap-1"
                title="Change AI model"
              >
                <span>{formatModelLabel(selectedModel)}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* All Available Models Menu */}
              {showModelMenu && (
                <div className="absolute right-0 bottom-7 z-50 w-72 sm:w-80 max-h-[min(320px,45vh)] overflow-hidden rounded-2xl bg-white dark:bg-[#242320] border border-[#e5e2da] dark:border-[#383632] shadow-2xl flex flex-col">
                  {/* Search bar inside models menu */}
                  <div className="p-2.5 border-b border-[#f0eee6] dark:border-[#33312c]">
                    <div className="relative flex items-center">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-[#8c887e] absolute left-2.5 pointer-events-none">
                        <circle cx="11" cy="11" r="8" />
                        <path d="M21 21l-4.35-4.35" />
                      </svg>
                      <input
                        type="text"
                        autoFocus
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search all models..."
                        className="w-full h-7 pl-8 pr-3 text-xs bg-[#f6f5f0] dark:bg-[#2b2a26] border border-[#e5e2da] dark:border-[#383632] rounded-lg text-[#1f1e1d] dark:text-[#ede8de] placeholder-[#8c887e] focus:outline-none focus:border-[#da7756]"
                      />
                    </div>
                  </div>

                  {/* Model categories list */}
                  <div className="flex-1 overflow-y-auto p-1.5 space-y-2">
                    {filteredModelGroups.map(([group, options]) => (
                      <div key={group} className="space-y-0.5">
                        <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-[#8c887e] dark:text-[#78756d]">
                          {group}
                        </div>
                        {options.map((opt) => {
                          const isSelected = selectedModel === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                onModelChange?.(opt.value);
                                setShowModelMenu(false);
                                setModelSearch('');
                              }}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-[#da7756]/10 text-[#da7756] font-semibold'
                                  : 'text-[#1f1e1d] dark:text-[#ede8de] hover:bg-[#f3f1ea] dark:hover:bg-[#2c2b27]'
                              }`}
                            >
                              <div className="flex flex-col truncate pr-2 min-w-0">
                                <span className="truncate">{opt.label}</span>
                                <span className="text-[10px] text-[#8c887e] font-mono truncate">{opt.value}</span>
                              </div>
                              {isSelected && <span className="text-sm font-bold text-[#da7756] shrink-0">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Reasoning Effort Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEffortMenu(!showEffortMenu)}
                className="hover:text-[#1f1e1d] dark:hover:text-[#ede8de] cursor-pointer transition-colors"
                title="Reasoning / thinking effort"
              >
                {reasoningEffort}
              </button>
              {showEffortMenu && (
                <div className="absolute right-0 bottom-7 z-50 w-36 py-1 rounded-xl bg-white dark:bg-[#242320] border border-[#e5e2da] dark:border-[#383632] shadow-xl text-xs">
                  {(['Low', 'Medium', 'High'] as const).map((effort) => (
                    <button
                      key={effort}
                      type="button"
                      onClick={() => {
                        setReasoningEffort(effort);
                        setShowEffortMenu(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-[#f0eee6] dark:hover:bg-[#2f2e29] cursor-pointer ${
                        reasoningEffort === effort ? 'font-semibold text-[#da7756]' : 'text-[#1f1e1d] dark:text-[#ede8de]'
                      }`}
                    >
                      <span>{effort}</span>
                      {reasoningEffort === effort && <span>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Runner Mode Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowRunnerMenu(!showRunnerMenu)}
                className="hover:text-[#1f1e1d] dark:hover:text-[#ede8de] cursor-pointer transition-colors"
                title="Execution mode"
              >
                {runnerMode}
              </button>
              {showRunnerMenu && (
                <div className="absolute right-0 bottom-7 z-50 w-36 py-1 rounded-xl bg-white dark:bg-[#242320] border border-[#e5e2da] dark:border-[#383632] shadow-xl text-xs">
                  {(['Manual', 'Auto'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setRunnerMode(mode);
                        setShowRunnerMenu(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-[#f0eee6] dark:hover:bg-[#2f2e29] cursor-pointer ${
                        runnerMode === mode ? 'font-semibold text-[#da7756]' : 'text-[#1f1e1d] dark:text-[#ede8de]'
                      }`}
                    >
                      <span>{mode}</span>
                      {runnerMode === mode && <span>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
