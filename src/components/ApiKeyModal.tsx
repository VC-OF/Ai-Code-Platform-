'use client';

import { useState, useEffect } from 'react';
import s from './ApiKeyModal.module.css';

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


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={s.scrim} onClick={onClose}>
      <div
        className={s.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-keys-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.header}>
          <div>
            <h2 id="api-keys-title" className={s.title}>API keys</h2>
            <p className={s.desc}>Bring your own provider keys. They are stored encrypted in workspace settings.</p>
          </div>
          <button type="button" onClick={onClose} className={s.iconBtn} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={s.body}>
          {loading ? (
            <div className={s.desc}>Loading keys…</div>
          ) : (
            SUPPORTED_KEYS.map((k) => {
              const hasConfigured = Boolean(maskedKeys[k.envKey]);
              const isSaving = savingKey === k.envKey;
              const isSuccess = savedSuccess[k.envKey];

              return (
                <div key={k.id} className={s.row}>
                  <div className={s.rowHead}>
                    <span className={s.rowName}>{k.name.replace(/ API Key$/, '')}</span>
                    <code className={s.mono}>{k.envKey}</code>
                    {hasConfigured && <span className={s.status}>Active</span>}
                    <a href={k.docUrl} target="_blank" rel="noreferrer" className={s.link}>
                      Get a key
                    </a>
                  </div>
                  <p className={s.desc}>{k.description}</p>

                  {hasConfigured && (
                    <div className={s.current}>
                      <span className={s.mono}>{maskedKeys[k.envKey]}</span>
                      <button type="button" onClick={() => handleRemove(k.envKey)} className={s.textBtn}>
                        Remove
                      </button>
                    </div>
                  )}

                  <div className={s.inputRow}>
                    <input
                      type="password"
                      aria-label={`${k.name} value`}
                      placeholder={hasConfigured ? 'Enter a new key to replace' : k.placeholder}
                      value={keys[k.envKey] || ''}
                      onChange={(e) => setKeys((prev) => ({ ...prev, [k.envKey]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave(k.envKey);
                      }}
                      className={s.input}
                    />
                    <button
                      type="button"
                      onClick={() => handleSave(k.envKey)}
                      disabled={isSaving || !keys[k.envKey]?.trim()}
                      className={s.btn}
                    >
                      {isSaving ? 'Saving…' : isSuccess ? 'Saved' : 'Save'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className={s.footer}>
          <span className={s.desc}>Keys are decrypted only for backend API calls.</span>
          <button type="button" onClick={onClose} className={`${s.btn} ${s.btnPrimary}`}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
