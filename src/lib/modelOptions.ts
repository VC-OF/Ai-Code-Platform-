/** Models offered in the model picker and by /model. Client-safe. */
export interface ModelOption {
  value: string;
  label: string;
  group: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { group: 'Ollama Cloud', value: 'nemotron-3-ultra:cloud', label: 'nemotron-3-ultra:cloud (default)' },
  { group: 'Ollama Cloud', value: 'nemotron-3-super:cloud', label: 'nemotron-3-super:cloud' },
  { group: 'Anthropic', value: 'openrouter:anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet' },
  { group: 'Anthropic', value: 'openrouter:anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { group: 'Anthropic', value: 'claude-3-5-sonnet', label: 'claude-3-5-sonnet (direct)' },
  { group: 'DeepSeek', value: 'openrouter:deepseek/deepseek-r1', label: 'DeepSeek R1' },
  { group: 'DeepSeek', value: 'openrouter:deepseek/deepseek-chat', label: 'DeepSeek V3' },
  { group: 'DeepSeek', value: 'deepseek-r1', label: 'deepseek-r1 (direct)' },
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
