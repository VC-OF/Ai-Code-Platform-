import { describe, it, expect } from 'vitest';
import { MockLLMClient } from '../helpers/mockLLM';

describe('agent loop mock tests', () => {
  it('processes mock turns successfully', async () => {
    const client = new MockLLMClient();
    client.agentTurn({
      readFiles: ['src/index.ts'],
      finalMessage: 'Success!'
    });

    const completion1 = await client.createCompletion([]);
    expect(completion1.choices[0].message.tool_calls).not.toBeNull();

    const completion2 = await client.createCompletion([]);
    expect(completion2.choices[0].message.content).toBe('Success!');

    client.assertExhausted();
  });
});
