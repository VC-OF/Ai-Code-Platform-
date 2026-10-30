/** Models offered in the model picker and by /model. Client-safe. */
export interface ModelOption {
  value: string;
  label: string;
  group: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { group: 'Google Gemini', value: 'gemini-flash-latest', label: 'Gemini Flash (Recommended)' },
  { group: 'Google Gemini', value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { group: 'Google Gemini', value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { group: 'Google Gemini', value: 'gemini-pro-latest', label: 'Gemini Pro' },
  { group: 'Kimi (Moonshot AI)', value: 'openrouter:moonshotai/kimi-k3', label: 'Kimi K3 (1M Context · Multimodal)' },
  { group: 'Kimi (Moonshot AI)', value: 'openrouter:~moonshotai/kimi-latest', label: 'Kimi Latest (1M Context · Auto-Updated)' },
  { group: 'Kimi (Moonshot AI)', value: 'openrouter:moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code (256k Context · Coding)' },
  { group: 'Kimi (Moonshot AI)', value: 'openrouter:moonshotai/kimi-k2.6', label: 'Kimi K2.6 (256k Context)' },
  { group: 'Kimi (Moonshot AI)', value: 'openrouter:moonshotai/kimi-k2.5', label: 'Kimi K2.5 (256k Context)' },
  { group: 'Kimi (Moonshot AI)', value: 'openrouter:moonshotai/kimi-k2-thinking', label: 'Kimi K2 Thinking (256k Context · Reasoning)' },
  { group: 'Kimi (Moonshot AI)', value: 'openrouter:moonshotai/kimi-k2-0905', label: 'Kimi K2 0905 (256k Context)' },
  { group: 'Kimi (Moonshot AI)', value: 'openrouter:moonshotai/kimi-k2', label: 'Kimi K2 (128k Context)' },
  { group: 'OpenRouter (Free)', value: 'openrouter:openrouter/free', label: 'OpenRouter Free Models Router' },
  { group: 'OpenRouter (Free)', value: 'openrouter:qwen/qwen3.8-27b:free', label: 'Qwen 3.8 27B (Free · 256k Context)' },
  { group: 'OpenRouter (Free)', value: 'openrouter:google/gemma-4-31b-it:free', label: 'Gemma 4 31B (Free · 262k Context)' },
  { group: 'OpenRouter (Free)', value: 'openrouter:meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (Free · 128k Context)' },
  { group: 'Ollama Cloud', value: 'nemotron-3-ultra:cloud', label: 'nemotron-3-ultra:cloud (default)' },
  { group: 'Ollama Cloud', value: 'nemotron-3-super:cloud', label: 'nemotron-3-super:cloud' },
  { group: 'Anthropic', value: 'openrouter:anthropic/claude-opus-5.5', label: 'Claude Opus 5.5 (1M Context · Recommended)' },
  { group: 'Anthropic', value: 'openrouter:anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5 (1M Context · Fast)' },
  { group: 'Anthropic', value: 'openrouter:anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5 (1M Context · Cheapest)' },
  { group: 'Anthropic', value: 'openrouter:anthropic/claude-fable-5.1', label: 'Claude Fable 5.1 (1M Context · Most Capable)' },
  { group: 'Anthropic', value: 'openrouter:anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet' },
  { group: 'Anthropic', value: 'openrouter:anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { group: 'Anthropic', value: 'claude-3-5-sonnet', label: 'claude-3-5-sonnet (direct)' },
  { group: 'DeepSeek', value: 'openrouter:deepseek/deepseek-r1', label: 'DeepSeek R1' },
  { group: 'DeepSeek', value: 'openrouter:deepseek/deepseek-chat', label: 'DeepSeek V3' },
  { group: 'DeepSeek', value: 'deepseek-r1', label: 'deepseek-r1 (direct)' },
  { group: 'OpenAI', value: 'openrouter:openai/gpt-6-astra', label: 'GPT-6 Astra (1M Context · Agentic)' },
  { group: 'OpenAI', value: 'openrouter:openai/gpt-6-astra-pro', label: 'GPT-6 Astra Pro (1M Context)' },
  { group: 'OpenAI', value: 'openrouter:openai/gpt-6.1-sol', label: 'GPT-6.1 Sol (1M Context)' },
  { group: 'OpenAI', value: 'gpt-4o', label: 'gpt-4o' },
  { group: 'OpenAI', value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
  { group: 'OpenAI', value: 'openrouter:openai/o3-mini', label: 'o3-mini' },
  { group: 'Groq', value: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b' },
  { group: 'Groq', value: 'openai/gpt-oss-120b', label: 'gpt-oss-120b' },
  { group: 'Groq', value: 'qwen/qwen3.8-27b', label: 'qwen-3.8-27b' },
];

export function groupModelOptions(options: ModelOption[] = MODEL_OPTIONS): [string, ModelOption[]][] {
  const groups = new Map<string, ModelOption[]>();
  for (const option of options) {
    const list = groups.get(option.group) ?? [];
    list.push(option);
    groups.set(option.group, list);
  }
  return [...groups.entries()];
}
