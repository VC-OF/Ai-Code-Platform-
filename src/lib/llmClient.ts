import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources';
import { resolveProvider, getContextWindow as registryContextWindow } from './models';
import { getDecryptedEnv } from './settingsStore';

export type LLMMessage = ChatCompletionMessageParam;
export type LLMTool = ChatCompletionTool;
export type LLMToolChoice = ChatCompletionToolChoiceOption;

export interface LLMConfig {
  provider?: string;
  model: string;
}

/** Provider API keys added via the Settings UI (global scope) overlay env
 *  vars, so a key pasted in the browser works without a server restart. */
async function settingsKeys(): Promise<Record<string, string>> {
  try {
    return await getDecryptedEnv();
  } catch {
    return {};
  }
}

export async function getLLMClient(
  model?: string
): Promise<{ client: OpenAI; provider: string; apiModel: string }> {
  const provider = resolveProvider(model, await settingsKeys());
  if (provider.missingKeyError) {
    throw new Error(provider.missingKeyError);
  }
  return {
    client: new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL }),
    provider: provider.name,
    // Provider prefixes ("openrouter:x") are routing syntax, not part of
    // the model name the API receives
    apiModel: provider.model ?? model ?? getModel(),
  };
}

/** Models tried in order when the primary fails before producing output.
 *  Example: LLM_FALLBACKS=openrouter:meta-llama/llama-3.3-70b-instruct,llama3.1:latest */
function getFallbackModels(): string[] {
  return (process.env.LLM_FALLBACKS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getModel() {
  return process.env.LLM_MODEL || process.env.OPENAI_MODEL || "nemotron-3-ultra:cloud";
}

/** Upper bound on tokens per reply. Without it providers apply their own
 *  (often small) default and long file writes get cut off mid-tool-call.
 *  Override with LLM_MAX_OUTPUT_TOKENS. */
export function getMaxOutputTokens(): number {
  const n = Number(process.env.LLM_MAX_OUTPUT_TOKENS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 16_384;
}

/** Providers that cap output below our request reject it outright;
 *  detect that so the call can be retried with the provider default. */
function isMaxTokensRejection(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /max_tokens|max_completion_tokens|maximum.*tokens|num_predict/i.test(msg) &&
    /(400|invalid|exceed|too large|must be|less than)/i.test(msg);
}

// Providers that rejected max_tokens once; skip it for them afterwards
const noMaxTokens = new Set<string>();

export function getContextWindow(model: string): number {
  return registryContextWindow(model);
}

// Circuit Breaker State mapping
interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

const circuitBreakers = new Map<string, CircuitBreakerState>();
const FAILURE_THRESHOLD = 5;
const RECOVERY_MS = 30_000;

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'AbortError' ||
    err.name === 'APIUserAbortError' ||
    err.name === 'CancelledError' ||
    /aborted|cancelled/i.test(err.message)
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    provider: string;
  }
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, provider } = options;
  const cb = circuitBreakers.get(provider) ??
    { failures: 0, lastFailure: 0, state: 'closed' as const };

  if (cb.state === 'open') {
    if (Date.now() - cb.lastFailure > RECOVERY_MS) {
      cb.state = 'half-open';
      cb.failures = 0;
    } else {
      const remainingSec = Math.ceil((RECOVERY_MS - (Date.now() - cb.lastFailure)) / 1000);
      throw new Error(`Provider ${provider} is cooling down after errors (${remainingSec}s remaining). Please try again shortly.`);
    }
  }

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      cb.failures = 0;
      cb.state = 'closed';
      circuitBreakers.set(provider, cb);
      return result;
    } catch (err) {
      lastError = err as Error;

      // User cancellations are not provider failures: no retry, no breaker hit
      if (isAbortError(err)) throw err;

      cb.failures++;
      cb.lastFailure = Date.now();

      if (cb.failures >= FAILURE_THRESHOLD) {
        cb.state = 'open';
        circuitBreakers.set(provider, cb);
        throw new Error(`Circuit breaker tripped for ${provider}`);
      }

      circuitBreakers.set(provider, cb);

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * (2 ** (attempt - 1)) + Math.random() * 500;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

async function callOnce(
  model: string,
  messages: LLMMessage[],
  tools?: LLMTool[],
  opts?: { toolChoice?: LLMToolChoice; signal?: AbortSignal }
) {
  const { client, provider, apiModel } = await getLLMClient(model);

  return withRetry(
    async () => {
      const request = (withLimit: boolean) => client.chat.completions.create({
        model: apiModel,
        messages,
        tools: tools?.length ? tools : undefined,
        tool_choice: opts?.toolChoice,
        ...(withLimit ? { max_tokens: getMaxOutputTokens() } : {}),
      }, { signal: opts?.signal });

      let completion;
      try {
        completion = await request(!noMaxTokens.has(provider));
      } catch (err) {
        if (!isMaxTokensRejection(err)) throw err;
        noMaxTokens.add(provider);
        completion = await request(false);
      }

      return {
        content: completion.choices[0].message.content,
        tool_calls: completion.choices[0].message.tool_calls,
        finish_reason: completion.choices[0].finish_reason ?? null,
        usage: {
          prompt_tokens: completion.usage?.prompt_tokens ?? 0,
          completion_tokens: completion.usage?.completion_tokens ?? 0,
          total_tokens: completion.usage?.total_tokens ?? 0,
        },
      };
    },
    { provider }
  );
}

export async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  tools?: LLMTool[],
  opts?: { toolChoice?: LLMToolChoice; signal?: AbortSignal }
) {
  const chain = [
    config.model,
    ...getFallbackModels().filter((m) => m !== config.model),
  ];

  let lastError: unknown;
  for (const model of chain) {
    try {
      return await callOnce(model, messages, tools, opts);
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
      if (chain.length > 1) {
        console.warn(`[llm] ${model} failed, trying next fallback:`, err);
      }
    }
  }
  throw lastError;
}

export async function* callLLMStream(
  config: LLMConfig,
  messages: LLMMessage[],
  tools?: LLMTool[],
  opts?: { toolChoice?: LLMToolChoice; signal?: AbortSignal }
) {
  const chain = [
    config.model,
    ...getFallbackModels().filter((m) => m !== config.model),
  ];

  // Fallback applies only up to stream creation — once tokens are flowing,
  // a mid-stream failure surfaces to the caller
  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | null = null;
  let lastError: unknown;

  for (const model of chain) {
    try {
      const { client, provider, apiModel } = await getLLMClient(model);
      const open = (withLimit: boolean) => client.chat.completions.create({
        model: apiModel,
        messages,
        tools: tools?.length ? tools : undefined,
        tool_choice: opts?.toolChoice,
        stream: true,
        // Ask for real token usage in the final chunk. OpenAI-compatible
        // servers that don't support this simply ignore it.
        stream_options: { include_usage: true },
        ...(withLimit ? { max_tokens: getMaxOutputTokens() } : {}),
      }, { signal: opts?.signal });
      try {
        stream = await open(!noMaxTokens.has(provider));
      } catch (err) {
        if (!isMaxTokensRejection(err)) throw err;
        noMaxTokens.add(provider);
        stream = await open(false);
      }
      break;
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
      if (chain.length > 1) {
        console.warn(`[llm] ${model} failed to start stream, trying fallback:`, err);
      }
    }
  }
  if (!stream) throw lastError;

  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    // The usage-only final chunk has an empty choices array
    if (chunk.usage) {
      usage = {
        prompt_tokens: chunk.usage.prompt_tokens ?? 0,
        completion_tokens: chunk.usage.completion_tokens ?? 0,
      };
    }

    if (chunk.choices[0]?.delta?.content) {
      yield { type: 'delta', delta: chunk.choices[0].delta.content };
    }
    // A single chunk may carry deltas for several parallel tool calls
    for (const tc of chunk.choices[0]?.delta?.tool_calls ?? []) {
      yield {
        type: 'tool_call_delta',
        tool_call: {
          index: tc.index,
          id: tc.id,
          name: tc.function?.name,
          args: tc.function?.arguments,
        },
      };
    }
    if (chunk.choices[0]?.finish_reason) {
      finishReason = chunk.choices[0].finish_reason;
    }
  }

  // 'length' means the reply hit the output-token cap and is truncated
  yield { type: 'done', usage, finishReason };
}
