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
  /** Accepts image_url content parts (the view_image tool attaches images
   *  to the conversation only when this is true) */
  vision: boolean;
}

const DEFAULT_MODEL_INFO: ModelInfo = {
  // Unknown models: a conservative guess. The real limit is learned from the
  // provider's "context length" error on first overflow (recordContextWindow).
  contextWindow: 128_000,
  costPer1kIn: 0,
  costPer1kOut: 0,
  vision: false,
};

/**
 * Exact-name entries win; otherwise the longest matching prefix is used
 * (so "llama-3.1-8b-instant" matches the "llama-3.1" prefix entry).
 */
const MODELS: Record<string, Partial<ModelInfo>> = {
  // OpenAI (GPT-6 Astra: agentic/computer-use flagship, 2026-09; reached via OpenRouter)
  'gpt-6-astra':               { contextWindow: 1_050_000, costPer1kIn: 0.01,  costPer1kOut: 0.05, vision: true },
  'gpt-6-astra-pro':           { contextWindow: 1_050_000, costPer1kIn: 0.01,  costPer1kOut: 0.05, vision: true },
  'gpt-6.1-sol':               { contextWindow: 1_050_000, costPer1kIn: 0.002, costPer1kOut: 0.01, vision: true },
  'gpt-4o':                    { contextWindow: 128_000, costPer1kIn: 0.0025,  costPer1kOut: 0.01,   vision: true },
  'gpt-4o-mini':               { contextWindow: 128_000, costPer1kIn: 0.00015, costPer1kOut: 0.0006, vision: true },
  'gpt-4-turbo':               { contextWindow: 128_000, costPer1kIn: 0.01,    costPer1kOut: 0.03,   vision: true },
  'o3-mini':                   { contextWindow: 200_000, costPer1kIn: 0.0011,  costPer1kOut: 0.0044 },
  'o1':                        { contextWindow: 200_000, costPer1kIn: 0.015,   costPer1kOut: 0.06,   vision: true },
  // Anthropic (current generation; OpenRouter ids use dots, e.g. anthropic/claude-opus-5.5)
  'claude-opus-5.5':           { contextWindow: 1_000_000, costPer1kIn: 0.004,  costPer1kOut: 0.02,   vision: true },
  'claude-sonnet-5.5':         { contextWindow: 1_000_000, costPer1kIn: 0.002,  costPer1kOut: 0.01,   vision: true },
  // Haiku 5.5 doubles to $0.50/$2.50 per MTok above 100K prompt tokens
  'claude-haiku-5.5':          { contextWindow: 1_000_000, costPer1kIn: 0.0001, costPer1kOut: 0.0005, vision: true },
  'claude-fable-5.1':          { contextWindow: 1_000_000, costPer1kIn: 0.01,   costPer1kOut: 0.05,   vision: true },
  'claude-3-7-sonnet':         { contextWindow: 200_000, costPer1kIn: 0.003,   costPer1kOut: 0.015,  vision: true },
  'claude-3-5-sonnet':         { contextWindow: 200_000, costPer1kIn: 0.003,   costPer1kOut: 0.015,  vision: true },
  'claude-3-haiku':            { contextWindow: 200_000, costPer1kIn: 0.00025, costPer1kOut: 0.00125, vision: true },
  // DeepSeek
  'deepseek-r1':               { contextWindow: 128_000, costPer1kIn: 0.00055, costPer1kOut: 0.00219},
  'deepseek-chat':             { contextWindow: 128_000, costPer1kIn: 0.00014, costPer1kOut: 0.00028},
  // Google Gemini
  'gemini-flash-latest':       { contextWindow: 1_000_000, costPer1kIn: 0.0001,   costPer1kOut: 0.0004, vision: true },
  'gemini-pro-latest':         { contextWindow: 2_000_000, costPer1kIn: 0.00125,  costPer1kOut: 0.005,  vision: true },
  'gemini-3.8-flash':          { contextWindow: 1_000_000, costPer1kIn: 0.000075, costPer1kOut: 0.0003, vision: true },
  'gemini-3.1-pro-preview':    { contextWindow: 2_000_000, costPer1kIn: 0.00125,  costPer1kOut: 0.005,  vision: true },
  'gemini-2.5-flash':          { contextWindow: 1_000_000, costPer1kIn: 0.000075, costPer1kOut: 0.0003, vision: true },
  'gemini-2.0-flash':          { contextWindow: 1_000_000, costPer1kIn: 0.0001,   costPer1kOut: 0.0004, vision: true },
  'gemini-2.0-flash-lite':     { contextWindow: 1_000_000, costPer1kIn: 0.000075, costPer1kOut: 0.0003, vision: true },
  'gemini-flash-lite-latest':  { contextWindow: 1_000_000, costPer1kIn: 0.000075, costPer1kOut: 0.0003, vision: true },
  'gemini-2.5-pro':            { contextWindow: 2_000_000, costPer1kIn: 0.00125,  costPer1kOut: 0.005,  vision: true },
  'gemini-1.5-pro':            { contextWindow: 2_000_000, costPer1kIn: 0.00125,  costPer1kOut: 0.005,  vision: true },
  'gemini-1.5-flash':          { contextWindow: 1_000_000, costPer1kIn: 0.000075, costPer1kOut: 0.0003, vision: true },
  // Moonshot AI / Kimi (via OpenRouter)
  'moonshotai/kimi-k3':          { contextWindow: 1_048_576, costPer1kIn: 0.003,    costPer1kOut: 0.015,  vision: true },
  'moonshotai/kimi-latest':     { contextWindow: 1_048_576, costPer1kIn: 0.00036,  costPer1kOut: 0.00913, vision: true },
  'moonshotai/kimi-k2.7-code':   { contextWindow: 262_144,   costPer1kIn: 0.00067,  costPer1kOut: 0.00335 },
  'moonshotai/kimi-k2.6':        { contextWindow: 262_144,   costPer1kIn: 0.00065,  costPer1kOut: 0.00341 },
  'moonshotai/kimi-k2.5':        { contextWindow: 262_144,   costPer1kIn: 0.00045,  costPer1kOut: 0.00225 },
  'moonshotai/kimi-k2-thinking': { contextWindow: 262_144,   costPer1kIn: 0.0006,   costPer1kOut: 0.0025 },
  'moonshotai/kimi-k2-0905':     { contextWindow: 262_144,   costPer1kIn: 0.0006,   costPer1kOut: 0.0025 },
  'moonshotai/kimi-k2':          { contextWindow: 131_072,   costPer1kIn: 0.00057,  costPer1kOut: 0.0023 },
  // OpenRouter Free Models
  'openrouter/free':                              { contextWindow: 200_000, costPer1kIn: 0, costPer1kOut: 0 },
  'qwen/qwen3.8-27b:free':                        { contextWindow: 262_144, costPer1kIn: 0, costPer1kOut: 0 },
  'nvidia/nemotron-3-ultra-550b-a55b:free':       { contextWindow: 1_000_000, costPer1kIn: 0, costPer1kOut: 0 },
  'google/gemma-4-31b-it:free':                   { contextWindow: 262_144, costPer1kIn: 0, costPer1kOut: 0 },
  'meta-llama/llama-3.3-70b-instruct:free':       { contextWindow: 128_000, costPer1kIn: 0, costPer1kOut: 0 },
  // Groq-hosted
  'llama-3.3-70b-versatile':   { contextWindow: 128_000, costPer1kIn: 0.00059, costPer1kOut: 0.00079 },
  'llama-3.1-8b-instant':      { contextWindow: 128_000, costPer1kIn: 0.00005, costPer1kOut: 0.00008 },
  'meta-llama/llama-4-scout-17b-16e-instruct': { contextWindow: 128_000, costPer1kIn: 0.0003, costPer1kOut: 0.0006, vision: true },
  'qwen/qwen3-32b':            { contextWindow: 128_000, costPer1kIn: 0.0005,  costPer1kOut: 0.0005 },
  'qwen/qwen3.6-27b':          { contextWindow: 128_000, costPer1kIn: 0.0002,  costPer1kOut: 0.0004 },
  'openai/gpt-oss-120b':       { contextWindow: 128_000, costPer1kIn: 0.0006,  costPer1kOut: 0.0012 },
  'openai/gpt-oss-20b':        { contextWindow: 128_000, costPer1kIn: 0.0001,  costPer1kOut: 0.0002 },
  'qwen/qwen3.8-27b':          { contextWindow: 128_000, costPer1kIn: 0.0002,  costPer1kOut: 0.0004 },
  'allam-2-7b':                { contextWindow: 128_000, costPer1kIn: 0.0001,  costPer1kOut: 0.0001 },
  // Ollama cloud
  // Ollama Cloud serves these with a 262,144-token window ("model maximum
  // context length: 262144"), not the 1M+ the model cards advertise
  'nemotron-3-ultra:cloud':    { contextWindow: 262_144 },
  'nemotron-3-super:cloud':    { contextWindow: 262_144 },
  'minimax-m3:cloud':          { contextWindow: 128_000 },
  'qwen3-coder-next:cloud':    { contextWindow: 128_000 },
  'glm-5.2:cloud':             { contextWindow: 128_000 },
  'gemma4:31b':                { contextWindow: 128_000, vision: true },
  'gpt-oss:120b':              { contextWindow: 128_000 },
  'gpt-oss:20b':               { contextWindow: 128_000 },
  'nemotron-3-nano:30b':       { contextWindow: 128_000 },
  'nemotron-3-super':          { contextWindow: 262_144 },
  'nemotron-3-ultra':          { contextWindow: 262_144 },
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

  // Strip org namespace, e.g. "anthropic/claude-3-5-sonnet" -> "claude-3-5-sonnet",
  // "openai/gpt-4o" -> "gpt-4o", "google/gemini-2.5-flash" -> "gemini-2.5-flash"
  const slash = model.indexOf('/');
  if (slash > 0) {
    const stripped = model.slice(slash + 1);
    const exactStripped = MODELS[stripped];
    if (exactStripped) return { ...DEFAULT_MODEL_INFO, ...exactStripped };

    let bestStrippedPrefix = '';
    for (const key of Object.keys(MODELS)) {
      if (stripped.startsWith(key) && key.length > bestStrippedPrefix.length) {
        bestStrippedPrefix = key;
      }
    }
    if (bestStrippedPrefix) return { ...DEFAULT_MODEL_INFO, ...MODELS[bestStrippedPrefix] };
  } else {
    // If model has no slash (e.g. "kimi-k3"), check if an org-prefixed key in MODELS matches
    for (const [key, info] of Object.entries(MODELS)) {
      if (key.endsWith(`/${model}`)) {
        return { ...DEFAULT_MODEL_INFO, ...info };
      }
    }
  }

  // Also check Gemini aliases if applicable
  const geminiAliased = GEMINI_MODEL_ALIASES[model.toLowerCase()];
  if (geminiAliased && MODELS[geminiAliased]) {
    return { ...DEFAULT_MODEL_INFO, ...MODELS[geminiAliased] };
  }

  return DEFAULT_MODEL_INFO;
}

// Context limits reported by providers at runtime ("maximum context length:
// N"). Shared on globalThis so every module copy (dev HMR) sees them.
const learnedWindows = ((globalThis as unknown as { __ocLearnedContextWindows?: Map<string, number> })
  .__ocLearnedContextWindows ??= new Map<string, number>());

/** Remember a provider-reported hard limit; it beats the registry AND the
 *  CONTEXT_WINDOW override, because the provider will reject anything larger. */
export function recordContextWindow(model: string, tokens: number): void {
  if (Number.isFinite(tokens) && tokens >= 1_000) learnedWindows.set(model, Math.floor(tokens));
}

export function learnedContextWindow(model: string): number | undefined {
  return learnedWindows.get(model);
}

export function getContextWindow(model: string): number {
  const learned = learnedWindows.get(model);
  if (learned) return learned;
  const envLimit = process.env.CONTEXT_WINDOW || process.env.LLM_CONTEXT_WINDOW;
  if (envLimit) {
    const parsed = parseInt(envLimit, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return getModelInfo(model).contextWindow;
}

// Model names that advertise image input without being in the registry
const VISION_NAME_PATTERN =
  /vision|-vl\b|llava|gemma[34]|pixtral|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|llama-4|llama4|minicpm-v|qwen[\w.-]*-?vl|kimi|mistral-small-3|mistral-medium|nemotron-3-(ultra|super)/i;

/**
 * Whether requests should carry Anthropic `cache_control` breakpoints:
 * Anthropic models via OpenRouter (openrouter:anthropic/*) or claude-*
 * directly. LLM_PROMPT_CACHE=1|0 overrides.
 */
export function supportsPromptCaching(
  model: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  const override = (env.LLM_PROMPT_CACHE ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(override)) return true;
  if (['0', 'false', 'no', 'off'].includes(override)) return false;
  const m = model.trim().toLowerCase();
  return m.startsWith('openrouter:anthropic/') || m.startsWith('claude-');
}

/**
 * Whether the model accepts image content parts. LLM_VISION=1|0 overrides
 * the registry/heuristic for models we don't know about.
 */
export function supportsVision(
  model: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  const override = (env.LLM_VISION ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(override)) return true;
  if (['0', 'false', 'no', 'off'].includes(override)) return false;
  if (getModelInfo(model).vision) return true;
  const colon = model.indexOf(':');
  const bare = colon > 0 && PROVIDERS.some((p) => p.prefix === model.slice(0, colon))
    ? model.slice(colon + 1)
    : model;
  return VISION_NAME_PATTERN.test(bare);
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
  { id: 'gemini',     label: 'Google Gemini', kind: 'cloud', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyEnv: 'GEMINI_API_KEY',    prefix: 'gemini' },
  { id: 'groq',       label: 'Groq',        kind: 'cloud', baseURL: 'https://api.groq.com/openai/v1',      keyEnv: 'GROQ_API_KEY',        prefix: 'groq' },
  { id: 'openrouter', label: 'OpenRouter',  kind: 'cloud', baseURL: 'https://openrouter.ai/api/v1',        keyEnv: 'OPENROUTER_API_KEY',  prefix: 'openrouter' },
  { id: 'deepseek',   label: 'DeepSeek',    kind: 'cloud', baseURL: 'https://api.deepseek.com/v1',          keyEnv: 'DEEPSEEK_API_KEY',    prefix: 'deepseek' },
  { id: 'together',   label: 'Together AI', kind: 'cloud', baseURL: 'https://api.together.xyz/v1',         keyEnv: 'TOGETHER_API_KEY',    prefix: 'together' },
  { id: 'ollama',     label: 'Ollama',      kind: 'local', baseURL: 'http://localhost:11434/v1',           keyEnv: null,                  prefix: null },
  { id: 'lmstudio',   label: 'LM Studio',   kind: 'local', baseURL: 'http://localhost:1234/v1',            keyEnv: null,                  prefix: 'lmstudio' },
  { id: 'localai',    label: 'LocalAI',     kind: 'local', baseURL: 'http://localhost:8080/v1',            keyEnv: null,                  prefix: 'localai' },
];

export function providerBaseURL(p: ProviderInfo): string {
  return process.env[`${p.id.toUpperCase()}_BASE_URL`] || p.baseURL;
}

export const GEMINI_MODEL_ALIASES: Record<string, string> = {
  'gemini-2.0-flash': 'gemini-flash-latest',
  'gemini-2.5-flash': 'gemini-flash-latest',
  'gemini-flash': 'gemini-flash-latest',
  'gemini-2.0-flash-lite': 'gemini-flash-lite-latest',
  'gemini-2.5-pro': 'gemini-pro-latest',
  'gemini-1.5-pro': 'gemini-pro-latest',
  'gemini-pro': 'gemini-pro-latest',
};

const GEMINI_MODEL_PATTERN = /^gemini-/i;
const GROQ_MODEL_PATTERN   = /^(llama-3\.|meta-llama\/|qwen\/|openai\/|groq\/|allam)/;
const OLLAMA_MODEL_PATTERN = /:(cloud|latest|\d+b.*)$|-cloud$|^(nemotron|gemma4|gpt-oss)/;

/**
 * Decide which OpenAI-compatible endpoint serves the given model.
 *
 * Routing rules, in order:
 * 1. Explicit prefix — "gemini:x", "openrouter:x", "together:x", "lmstudio:x", "localai:x"
 * 2. Gemini-shaped model names (gemini-2.5-flash, gemini-2.0-flash, …)
 * 3. Groq-shaped model names (llama-3.*, qwen/*, …)
 * 4. Ollama-shaped tags (*:cloud, *:latest, *:8b)
 * 5. The LLM_BASE_URL / OPENAI_API_BASE default
 *
 * `keys` lets callers overlay decrypted settings-store keys over env vars.
 */
export function getDefaultModel(keys: Record<string, string> = {}): string {
  const envModel = typeof process !== 'undefined' ? (process.env?.LLM_MODEL || process.env?.OPENAI_MODEL) : undefined;
  return envModel || detectDefaultModel(keys);
}

function detectDefaultModel(keys: Record<string, string>): string {
  const keyFor = (env: string | null) => (env && typeof process !== 'undefined' ? keys[env] || process.env?.[env] || '' : '');
  if (keyFor('ANTHROPIC_API_KEY')) return 'claude-3-7-sonnet';
  if (keyFor('GEMINI_API_KEY')) return 'gemini-flash-latest';
  if (keyFor('OPENAI_API_KEY') || keyFor('LLM_API_KEY')) return 'gpt-4o-mini';
  if (keyFor('DEEPSEEK_API_KEY')) return 'deepseek-r1';
  if (keyFor('OPENROUTER_API_KEY')) return 'openrouter:anthropic/claude-opus-5.5';
  if (keyFor('GROQ_API_KEY')) return 'llama-3.3-70b-versatile';
  if (keyFor('TOGETHER_API_KEY')) return 'together:meta-llama/Llama-3.3-70B-Instruct-Turbo';
  return 'claude-3-7-sonnet';
}

export function resolveProvider(
  model?: string,
  keys: Record<string, string> = {}
): ProviderConfig {
  const targetModel = model || process.env.LLM_MODEL || process.env.OPENAI_MODEL || detectDefaultModel(keys);
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
        const rawModel = targetModel.slice(colon + 1);
        const resolvedModel = provider.id === 'gemini' ? (GEMINI_MODEL_ALIASES[rawModel.toLowerCase()] || rawModel) : rawModel;
        return {
          name: provider.id,
          baseURL: providerBaseURL(provider),
          apiKey: apiKey || (needsKey ? '' : 'local'),
          model: resolvedModel,
          missingKeyError:
            needsKey && !apiKey
              ? `${provider.keyEnv} is not set. Add it in Settings → Environment Variables (global) or .env.local.`
              : undefined,
        };
      }
    }
  }

  // 2. Gemini heuristics
  if (targetModel && GEMINI_MODEL_PATTERN.test(targetModel)) {
    const apiKey = keyFor('GEMINI_API_KEY');
    const provider = PROVIDERS.find((p) => p.id === 'gemini')!;
    const resolvedModel = GEMINI_MODEL_ALIASES[targetModel.toLowerCase()] || targetModel;
    return {
      name: 'gemini',
      baseURL: providerBaseURL(provider),
      apiKey,
      model: resolvedModel,
      missingKeyError: apiKey
        ? undefined
        : 'GEMINI_API_KEY is not set. Add it in Keys (top bar) or .env.local.',
    };
  }

  // 3. Groq heuristics
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
    model: targetModel,
    missingKeyError:
      apiKey || isLocal
        ? undefined
        : 'No API key set on the server. Add LLM_API_KEY (or OPENAI_API_KEY) to .env.local.',
  };
}
