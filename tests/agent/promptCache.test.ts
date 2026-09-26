import { describe, expect, it } from 'vitest';
import { applyCacheBreakpoints, extractCachedTokens, prepareMessages, type LLMMessage } from '@/lib/llmClient';
import { supportsPromptCaching } from '@/lib/models';

const cc = { type: 'ephemeral' };

function convo(): LLMMessage[] {
  return [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'file body' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'u2' },
  ] as LLMMessage[];
}

describe('supportsPromptCaching', () => {
  it('detects Anthropic via OpenRouter and claude-* direct', () => {
    expect(supportsPromptCaching('openrouter:anthropic/claude-sonnet-4', {})).toBe(true);
    expect(supportsPromptCaching('claude-3-5-sonnet', {})).toBe(true);
    expect(supportsPromptCaching('openrouter:openai/gpt-4o', {})).toBe(false);
    expect(supportsPromptCaching('gpt-4o', {})).toBe(false);
  });

  it('honours LLM_PROMPT_CACHE', () => {
    expect(supportsPromptCaching('gpt-4o', { LLM_PROMPT_CACHE: '1' })).toBe(true);
    expect(supportsPromptCaching('claude-3-5-sonnet', { LLM_PROMPT_CACHE: '0' })).toBe(false);
  });
});

describe('applyCacheBreakpoints', () => {
  it('marks the system prompt and the last two user/tool messages', () => {
    const input = convo();
    const out = applyCacheBreakpoints(input);
    expect(out[0].content).toEqual([{ type: 'text', text: 'SYS', cache_control: cc }]);
    expect(out[5].content).toEqual([{ type: 'text', text: 'u2', cache_control: cc }]);
    expect(out[3].content).toEqual([{ type: 'text', text: 'file body', cache_control: cc }]);
    expect(out[1].content).toBe('u1');
    expect(out[4].content).toBe('ok');
    const marks = JSON.stringify(out).match(/cache_control/g) ?? [];
    expect(marks.length).toBeLessThanOrEqual(4);
    // pure
    expect(input[0].content).toBe('SYS');
  });

  it('marks the last part of array content without mutating it', () => {
    const parts = [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:x' } }];
    const input = [{ role: 'user', content: parts }] as LLMMessage[];
    const out = applyCacheBreakpoints(input);
    const content = out[0].content as unknown as Record<string, unknown>[];
    expect(content[1].cache_control).toEqual(cc);
    expect(content[0].cache_control).toBeUndefined();
    expect((parts[1] as Record<string, unknown>).cache_control).toBeUndefined();
  });

  it('leaves other providers unchanged', () => {
    const msgs = convo();
    const out = prepareMessages('gpt-4o', msgs);
    expect(JSON.stringify(out)).not.toContain('cache_control');
  });
});

describe('extractCachedTokens', () => {
  it('reads OpenAI/OpenRouter and Anthropic shapes', () => {
    expect(extractCachedTokens({ prompt_tokens_details: { cached_tokens: 1200 } })).toBe(1200);
    expect(extractCachedTokens({ cache_read_input_tokens: 50 })).toBe(50);
    expect(extractCachedTokens({ prompt_tokens: 10 })).toBe(0);
    expect(extractCachedTokens(undefined)).toBe(0);
  });
});
