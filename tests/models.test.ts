import { describe, it, expect } from 'vitest';
import { resolveProvider, getModelInfo, PROVIDERS } from '@/lib/models';
import { MODEL_OPTIONS, groupModelOptions } from '@/lib/modelOptions';
import { matchModel } from '@/lib/slashCommands';

describe('Gemini model support', () => {
  it('registers gemini in PROVIDERS', () => {
    const provider = PROVIDERS.find((p) => p.id === 'gemini');
    expect(provider).toBeDefined();
    expect(provider?.keyEnv).toBe('GEMINI_API_KEY');
    expect(provider?.prefix).toBe('gemini');
  });

  it('resolves gemini models direct and prefixed with aliases', () => {
    const configDirect = resolveProvider('gemini-flash-latest', { GEMINI_API_KEY: 'AQ.test-key' });
    expect(configDirect.name).toBe('gemini');
    expect(configDirect.apiKey).toBe('AQ.test-key');
    expect(configDirect.model).toBe('gemini-flash-latest');
    expect(configDirect.missingKeyError).toBeUndefined();

    // Deprecated/versioned model names resolve to active aliases
    const configAliased = resolveProvider('gemini-2.0-flash', { GEMINI_API_KEY: 'AQ.test-key' });
    expect(configAliased.name).toBe('gemini');
    expect(configAliased.model).toBe('gemini-flash-latest');

    const configPrefixed = resolveProvider('gemini:gemini-2.0-flash', { GEMINI_API_KEY: 'AQ.test-key' });
    expect(configPrefixed.name).toBe('gemini');
    expect(configPrefixed.apiKey).toBe('AQ.test-key');
    expect(configPrefixed.model).toBe('gemini-flash-latest');

    const configMissing = resolveProvider('gemini-flash-latest', {});
    expect(configMissing.missingKeyError).toBeDefined();
    expect(configMissing.missingKeyError).toContain('GEMINI_API_KEY');
  });

  it('provides correct metadata for gemini models', () => {
    const info = getModelInfo('gemini-flash-latest');
    expect(info.contextWindow).toBe(1_000_000);
    expect(info.vision).toBe(true);
  });

  it('includes Google Gemini in MODEL_OPTIONS and groupModelOptions', () => {
    const groups = groupModelOptions(MODEL_OPTIONS);
    const geminiGroup = groups.find(([group]) => group === 'Google Gemini');
    expect(geminiGroup).toBeDefined();
    expect(geminiGroup?.[1].some((opt) => opt.value === 'gemini-flash-latest')).toBe(true);

    const match = matchModel('gemini flash', MODEL_OPTIONS);
    expect(match.match?.value).toBe('gemini-flash-latest');
  });

  it('correctly resolves metadata for org-prefixed and OpenRouter models', () => {
    const claudeInfo = getModelInfo('openrouter:anthropic/claude-3-5-sonnet');
    expect(claudeInfo.contextWindow).toBe(200_000);
    expect(claudeInfo.vision).toBe(true);
    expect(claudeInfo.costPer1kIn).toBe(0.003);

    const kimiInfo = getModelInfo('moonshotai/kimi-latest');
    expect(kimiInfo.contextWindow).toBe(1_048_576);
    expect(kimiInfo.vision).toBe(true);

    const bareKimi = getModelInfo('kimi-k3');
    expect(bareKimi.contextWindow).toBe(1_048_576);
    expect(bareKimi.vision).toBe(true);

    const groqInfo = getModelInfo('llama-3.3-70b-versatile');
    expect(groqInfo.costPer1kIn).toBeGreaterThan(0);
    expect(groqInfo.costPer1kOut).toBeGreaterThan(0);
  });

  it('detects sensible default models based on configured keys', () => {
    const geminiDefault = resolveProvider(undefined, { GEMINI_API_KEY: 'AQ.key' });
    expect(geminiDefault.name).toBe('gemini');
    expect(geminiDefault.model).toBe('gemini-flash-latest');

    const openaiDefault = resolveProvider(undefined, { OPENAI_API_KEY: 'sk-test' });
    expect(openaiDefault.name).toBe('default');
    expect(openaiDefault.model).toBe('gpt-4o-mini');

    const groqDefault = resolveProvider(undefined, { GROQ_API_KEY: 'gsk-test' });
    expect(groqDefault.name).toBe('groq');
    expect(groqDefault.model).toBe('llama-3.3-70b-versatile');
  });
});


describe('current-generation models', () => {
  it.each([
    ['openrouter:openai/gpt-6-astra', 1_050_000, 0.01, 0.05],
    ['openrouter:anthropic/claude-opus-5.5', 1_000_000, 0.004, 0.02],
    ['openrouter:anthropic/claude-sonnet-5.5', 1_000_000, 0.002, 0.01],
    ['openrouter:anthropic/claude-haiku-5.5', 1_000_000, 0.0001, 0.0005],
    ['openrouter:anthropic/claude-fable-5.1', 1_000_000, 0.01, 0.05],
  ])('%s resolves to its registry entry', (id, ctx, inCost, outCost) => {
    const info = getModelInfo(id);
    expect(info.contextWindow).toBe(ctx);
    expect(info.costPer1kIn).toBe(inCost);
    expect(info.costPer1kOut).toBe(outCost);
    expect(info.vision).toBe(true);
  });
});
