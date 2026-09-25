'use client';

import { useState, useEffect } from 'react';

interface ApiKeyModalProps {
  onClose: () => void;
}

interface KeyConfig {
  id: string;
  name: string;
  envKey: string;
  placeholder: string;
  description: string;
  docUrl: string;
}

const SUPPORTED_KEYS: KeyConfig[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter API Key',
    envKey: 'OPENROUTER_API_KEY',
    placeholder: 'sk-or-v1-...',
    description: 'Access Claude 3.7 Sonnet, DeepSeek R1, GPT-4o, Llama 3.3 and 100+ models with one key.',
    docUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI API Key',
    envKey: 'OPENAI_API_KEY',
    placeholder: 'sk-proj-...',
    description: 'Direct OpenAI access for GPT-4o, GPT-4o-mini, o1, and o3-mini.',
    docUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic API Key',
    envKey: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-api03-...',
    description: 'Direct Anthropic access for Claude 3.7 Sonnet & 3.5 Sonnet.',
    docUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'groq',
    name: 'Groq API Key',
    envKey: 'GROQ_API_KEY',
    placeholder: 'gsk_...',
    description: 'Ultra-low latency inference for Llama 3.3 70B and Qwen models.',
    docUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek API Key',
    envKey: 'DEEPSEEK_API_KEY',
    placeholder: 'sk-...',
    description: 'Direct official API for DeepSeek R1 reasoning & DeepSeek V3 chat.',
    docUrl: 'https://platform.deepseek.com/api_keys',
  },
];

export default function ApiKeyModal({ onClose }: ApiKeyModalProps) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [maskedKeys, setMaskedKeys] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Load existing masked keys from server settings store
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          const masked: Record<string, string> = {};
          if (Array.isArray(data.vars)) {
            for (const item of data.vars) {
              if (item.key && item.value) {
                masked[item.key] = item.value;
              }
            }
          }
          setMaskedKeys(masked);
        }
      } catch (err) {
        console.error('Failed to load settings', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSave = async (envKey: string) => {
    const rawVal = keys[envKey];
    if (!rawVal || !rawVal.trim()) return;

    setSavingKey(envKey);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: envKey, value: rawVal.trim() }),
      });
      if (res.ok) {
        setSavedSuccess((prev) => ({ ...prev, [envKey]: true }));
        setMaskedKeys((prev) => ({
          ...prev,
          [envKey]: `${rawVal.slice(0, 3)}••••••••${rawVal.slice(-4)}`,
        }));
        setKeys((prev) => ({ ...prev, [envKey]: '' }));
        setTimeout(() => {
          setSavedSuccess((prev) => ({ ...prev, [envKey]: false }));
        }, 2500);
      } else {
        alert('Failed to save API key. Please check server logs.');
      }
    } catch (err) {
      alert(`Error saving: ${String(err)}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleRemove = async (envKey: string) => {
    if (!confirm(`Remove ${envKey}?`)) return;
    setSavingKey(envKey);
    try {
      const res = await fetch('/api/settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: envKey }),
      });
      if (res.ok) {
        setMaskedKeys((prev) => {
          const next = { ...prev };
          delete next[envKey];
          return next;
        });
      }
    } catch (err) {
      alert(`Error deleting: ${String(err)}`);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#12141c] border border-white/10 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden text-white font-sans animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#161922]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Model Hub & API Keys (BYOK)</h2>
              <p className="text-[11px] text-slate-400">Configure your own API keys. Encrypted securely in workspace settings store.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="text-center py-8 text-xs text-slate-400 font-mono">Loading configured keys...</div>
          ) : (
            SUPPORTED_KEYS.map((k) => {
              const hasConfigured = Boolean(maskedKeys[k.envKey]);
              const isSaving = savingKey === k.envKey;
              const isSuccess = savedSuccess[k.envKey];

              return (
                <div
                  key={k.id}
                  className="bg-[#181b26] border border-white/5 hover:border-white/10 rounded-lg p-4 transition-all"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200">{k.name}</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5">
                        {k.envKey}
                      </span>
                      {hasConfigured && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-medium">
                          Active
                        </span>
                      )}
                    </div>
                    <a
                      href={k.docUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1"
                    >
                      <span>Get Key</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <path d="M15 3h6v6M10 14L21 3"/>
                      </svg>
                    </a>
                  </div>

                  <p className="text-[11.5px] text-slate-400 mb-3">{k.description}</p>

                  {hasConfigured && (
                    <div className="flex items-center justify-between mb-2.5 px-3 py-1.5 bg-black/30 rounded border border-white/5 text-xs font-mono text-slate-300">
                      <span className="text-slate-400">Current: {maskedKeys[k.envKey]}</span>
                      <button
                        onClick={() => handleRemove(k.envKey)}
                        className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline ml-3 cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      placeholder={hasConfigured ? 'Enter new key to replace...' : k.placeholder}
                      value={keys[k.envKey] || ''}
                      onChange={(e) =>
                        setKeys((prev) => ({ ...prev, [k.envKey]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave(k.envKey);
                      }}
                      className="flex-1 bg-black/40 border border-white/10 focus:border-indigo-500/60 rounded px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none font-mono transition-colors"
                    />
                    <button
                      onClick={() => handleSave(k.envKey)}
                      disabled={isSaving || !keys[k.envKey]?.trim()}
                      className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-xs font-medium text-white transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                    >
                      {isSaving ? (
                        <span>Saving...</span>
                      ) : isSuccess ? (
                        <span className="text-emerald-300">Saved ✓</span>
                      ) : (
                        <span>Save Key</span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 bg-[#161922] flex items-center justify-between text-xs text-slate-400">
          <span>Keys are stored encrypted and decrypted only during backend API calls.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white font-medium transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
