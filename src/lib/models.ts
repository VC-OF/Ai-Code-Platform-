/**
 * Central model registry — the single source of truth for per-model
 * metadata (context window, cost) and provider routing.
 *
 * Everything that previously kept its own copy of this data
 * (llmClient, contextManager, usageTracker, db) imports from here.
 */

// ─── Model metadata ──────────────────────────────────────────────────────────
export interface ModelInfo {
  contextWindow: number;
  /** USD per 1k prompt tokens */
  costPer1kIn: number;
  /** USD per 1k completion tokens */
  costPer1kOut: number;
}

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 2_000_000,
  costPer1kIn: 0,
  costPer1kOut: 0,
};

/**
 * Exact-name entries win; otherwise the longest matching prefix is used
 * (so "llama-3.1-8b-instant" matches the "llama-3.1" prefix entry).
 */
const MODELS: Record<string, Partial<ModelInfo>> = {
  // OpenAI
  'gpt-4o':                    { contextWindow: 128_000, costPer1kIn: 0.0025,  costPer1kOut: 0.01   },
  'gpt-4o-mini':               { contextWindow: 128_000, costPer1kIn: 0.00015, costPer1kOut: 0.0006 },
  'gpt-4-turbo':               { contextWindow: 128_000, costPer1kIn: 0.01,    costPer1kOut: 0.03   },
  // Anthropic (via OpenAI-compatible gateways)
  'claude-3-5-sonnet':         { contextWindow: 200_000, costPer1kIn: 0.003,   costPer1kOut: 0.015  },
  'claude-3-haiku':            { contextWindow: 200_000, costPer1kIn: 0.00025, costPer1kOut: 0.00125},
  // Groq-hosted
  'llama-3.3-70b-versatile':   { contextWindow: 128_000 },
  'llama-3.1-8b-instant':      { contextWindow: 128_000 },
  'meta-llama/llama-4-scout-17b-16e-instruct': { contextWindow: 128_000 },
  'qwen/qwen3-32b':            { contextWindow: 128_000 },
  'qwen/qwen3.6-27b':          { contextWindow: 128_000 },
  'openai/gpt-oss-120b':       { contextWindow: 128_000 },
  'openai/gpt-oss-20b':        { contextWindow: 128_000 },
  'qwen/qwen3.8-27b':          { contextWindow: 128_000 },
  'allam-2-7b':                { contextWindow: 128_000 },
  // Ollama cloud
  'nemotron-3-ultra:cloud':    { contextWindow: 2_000_000 },
  'nemotron-3-super:cloud':    { contextWindow: 2_000_000 },
  'minimax-m3:cloud':          { contextWindow: 128_000 },
  'qwen3-coder-next:cloud':    { contextWindow: 128_000 },
  'glm-5.2:cloud':             { contextWindow: 128_000 },
  'gemma4:31b':                { contextWindow: 128_000 },
  'gpt-oss:120b':              { contextWindow: 128_000 },
  'gpt-oss:20b':               { contextWindow: 128_000 },
  'nemotron-3-nano:30b':       { contextWindow: 128_000 },
  'nemotron-3-super':          { contextWindow: 2_000_000 },
  'nemotron-3-ultra':          { contextWindow: 2_000_000 },
  // Ollama local
  'qwen2.5-coder:32b':         { contextWindow: 32_000 },
  'llama3.1':                  { contextWindow: 32_000 },
  'codellama:34b':             { contextWindow: 16_000 },
};

export function getModelInfo(rawModel: string): ModelInfo {
  // "openrouter:foo/bar" → look up "foo/bar"
  const colon = rawModel.indexOf(':');
  const prefixed =
    colon > 0 && PROVIDERS.some((p) => p.prefix === rawModel.slice(0, colon));
  const model = prefixed ? rawModel.slice(colon + 1) : rawModel;

  const exact = MODELS[model];
  if (exact) return { ...DEFAULT_MODEL_INFO, ...exact };

  let bestPrefix = '';
  for (const key of Object.keys(MODELS)) {
    if (model.startsWith(key) && key.length > bestPrefix.length) {
      bestPrefix = key;
    }
  }
  if (bestPrefix) return { ...DEFAULT_MODEL_INFO, ...MODELS[bestPrefix] };
  return DEFAULT_MODEL_INFO;
}

export function getContextWindow(model: string): number {
  const envLimit = process.env.CONTEXT_WINDOW || process.env.LLM_CONTEXT_WINDOW;
  if (envLimit) {
    const parsed = parseInt(envLimit, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return getModelInfo(model).contextWindow;
}

export function computeCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const info = getModelInfo(model);
  return (
    (promptTokens / 1000) * info.costPer1kIn +
    (completionTokens / 1000) * info.costPer1kOut
  );
}

// ─── Provider routing ────────────────────────────────────────────────────────
export interface ProviderConfig {
  name: string;
  baseURL: string;
  /** Resolved API key. Empty string means "provider needs no key". */
  apiKey: string;
  /** Model name with any provider prefix stripped (what the API receives) */
  model?: string;
  /** Set when the provider requires a key that is missing from the env. */
  missingKeyError?: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  kind: 'cloud' | 'local';
  baseURL: string;
  keyEnv: string | null;
  /** Explicit model prefix, e.g. "openrouter:model-name" */
  prefix: string | null;
}

/**
 * Every provider here speaks the OpenAI-compatible Chat Completions
 * protocol — adding one is a registry entry, not new client code.
 * Cloud keys resolve from env, overlayable by the encrypted settings store
 * (see resolveKeys in llmClient) so keys added in the UI work immediately.
 */
export const PROVIDERS: ProviderInfo[] = [
  { id: 'groq',       label: 'Groq',        kind: 'cloud', baseURL: 'https://api.groq.com/openai/v1',      keyEnv: 'GROQ_API_KEY',        prefix: null },
  { id: 'openrouter', label: 'OpenRouter',  kind: 'cloud', baseURL: 'https://openrouter.ai/api/v1',        keyEnv: 'OPENROUTER_API_KEY',  prefix: 'openrouter' },
  { id: 'together',   label: 'Together AI', kind: 'cloud', baseURL: 'https://api.together.xyz/v1',         keyEnv: 'TOGETHER_API_KEY',    prefix: 'together' },
  { id: 'ollama',     label: 'Ollama',      kind: 'local', baseURL: 'http://localhost:11434/v1',           keyEnv: null,                  prefix: null },
  { id: 'lmstudio',   label: 'LM Studio',   kind: 'local', baseURL: 'http://localhost:1234/v1',            keyEnv: null,                  prefix: 'lmstudio' },
  { id: 'localai',    label: 'LocalAI',     kind: 'local', baseURL: 'http://localhost:8080/v1',            keyEnv: null,                  prefix: 'localai' },
];

export function providerBaseURL(p: ProviderInfo): string {
  return process.env[`${p.id.toUpperCase()}_BASE_URL`] || p.baseURL;
}

const GROQ_MODEL_PATTERN  = /^(llama-3\.|meta-llama\/|qwen\/|openai\/|groq\/|allam)/;
const OLLAMA_MODEL_PATTERN = /:(cloud|latest|\d+b.*)$|-cloud$|^(nemotron|gemma4|gpt-oss)/;

/**
 * Decide which OpenAI-compatible endpoint serves the given model.
 *
 * Routing rules, in order:
 * 1. Explicit prefix — "openrouter:x", "together:x", "lmstudio:x", "localai:x"
 * 2. Groq-shaped model names (llama-3.*, qwen/*, …)
 * 3. Ollama-shaped tags (*:cloud, *:latest, *:8b)
 * 4. The LLM_BASE_URL / OPENAI_API_BASE default
 *
 * `keys` lets callers overlay decrypted settings-store keys over env vars.
 */
export function resolveProvider(
  model?: string,
  keys: Record<string, string> = {}
): ProviderConfig {
  const targetModel = model || process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'nemotron-3-ultra:cloud';
  const keyFor = (env: string | null) =>
    env ? keys[env] || process.env[env] || '' : '';

  // 1. Explicit provider prefix
  if (targetModel) {
    const colon = targetModel.indexOf(':');
    if (colon > 0) {
      const prefix = targetModel.slice(0, colon);
      const provider = PROVIDERS.find((p) => p.prefix === prefix);
      if (provider) {
        const apiKey = keyFor(provider.keyEnv);
        const needsKey = provider.kind === 'cloud';
        return {
          name: provider.id,
          baseURL: providerBaseURL(provider),
          apiKey: apiKey || (needsKey ? '' : 'local'),
          model: targetModel.slice(colon + 1),
          missingKeyError:
            needsKey && !apiKey
              ? `${provider.keyEnv} is not set. Add it in Settings → Environment Variables (global) or .env.local.`
              : undefined,
        };
      }
    }
  }

  // 2. Groq heuristics
  if (targetModel && GROQ_MODEL_PATTERN.test(targetModel)) {
    const apiKey = keyFor('GROQ_API_KEY');
    return {
      name: 'groq',
      baseURL: providerBaseURL(PROVIDERS.find((p) => p.id === 'groq')!),
      apiKey,
      model: targetModel,
      missingKeyError: apiKey
        ? undefined
        : 'GROQ_API_KEY is not set. Add it in Settings → Environment Variables (global) or .env.local.',
    };
  }

  // 3. Ollama heuristics
  if (targetModel && OLLAMA_MODEL_PATTERN.test(targetModel)) {
    return {
      name: 'ollama',
      baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      apiKey: 'ollama', // Ollama's OpenAI-compatible endpoint ignores the key
      model: targetModel,
    };
  }

  // 4. Default endpoint
  const baseURL =
    process.env.LLM_BASE_URL ||
    process.env.OPENAI_API_BASE ||
    'https://api.openai.com/v1';
  const apiKey =
    keys.LLM_API_KEY || process.env.LLM_API_KEY ||
    keys.OPENAI_API_KEY || process.env.OPENAI_API_KEY ||
    '';
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0|:11434/.test(baseURL);

  return {
    name: 'default',
    baseURL,
    apiKey: apiKey || (isLocal ? 'ollama' : ''),
    model: model || process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'nemotron-3-ultra:cloud',
    missingKeyError:
      apiKey || isLocal
        ? undefined
        : 'No API key set on the server. Add LLM_API_KEY (or OPENAI_API_KEY) to .env.local.',
  };
}
