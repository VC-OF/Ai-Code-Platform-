import type { ChatCompletionMessageParam } from 'openai/resources';

export type MockResponse =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; calls: MockToolCall[] }
  | { type: 'error'; message: string; status?: number };

export interface MockToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ─── Mock LLM Client ─────────────────────────────────────────────────────────
export class MockLLMClient {
  private queue: MockResponse[] = [];
  public calls: Array<{
    messages: ChatCompletionMessageParam[];
    response: MockResponse;
  }> = [];

  // Queue a plain text response
  text(content: string): this {
    this.queue.push({ type: 'text', content });
    return this;
  }

  // Queue a tool call response
  toolCalls(calls: MockToolCall[]): this {
    this.queue.push({ type: 'tool_calls', calls });
    return this;
  }

  // Queue an error response
  error(message: string, status = 500): this {
    this.queue.push({ type: 'error', message, status });
    return this;
  }

  // Simulate a complete agent turn
  agentTurn(opts: {
    readFiles?: string[];
    editFiles?: Array<{
      path: string;
      oldText: string;
      newText: string;
    }>;
    runLint?: boolean;
    runTests?: boolean;
    finalMessage?: string;
  }): this {
    const calls: MockToolCall[] = [];

    // Read files first
    for (const p of opts.readFiles ?? []) {
      calls.push({
        id: `call-read-${p.replace(/\//g, '-')}`,
        name: 'read_file',
        arguments: { path: p },
      });
    }

    if (calls.length > 0) {
      this.toolCalls(calls);
    }

    // Edit files
    for (const edit of opts.editFiles ?? []) {
      this.toolCalls([
        {
          id: `call-edit-${edit.path.replace(/\//g, '-')}`,
          name: 'edit_file',
          arguments: {
            path: edit.path,
            oldText: edit.oldText,
            newText: edit.newText,
          },
        },
      ]);
    }

    // Run lint
    if (opts.runLint) {
      this.toolCalls([
        {
          id: 'call-lint',
          name: 'run_lint',
          arguments: {},
        },
      ]);
    }

    // Run tests
    if (opts.runTests) {
      this.toolCalls([
        {
          id: 'call-tests',
          name: 'run_tests',
          arguments: {},
        },
      ]);
    }

    // Final message
    this.text(opts.finalMessage ?? 'Done! Changes applied successfully.');
    return this;
  }

  // Called by agent loop instead of real LLM
  async createCompletion(messages: ChatCompletionMessageParam[]) {
    const response = this.queue.shift();
    if (!response) {
      throw new Error(
        `MockLLMClient: No more responses queued. ` +
        `Received ${messages.length} messages.`
      );
    }

    this.calls.push({ messages, response });

    if (response.type === 'error') {
      const err = new Error(response.message) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    return mockCompletionResponse(response);
  }

  // Assert all queued responses were used
  assertExhausted() {
    if (this.queue.length > 0) {
      throw new Error(
        `MockLLMClient: ${this.queue.length} unused responses remaining`
      );
    }
  }
}

// Build a fake OpenAI-style completion object
function mockCompletionResponse(response: MockResponse) {
  if (response.type === 'text') {
    return {
      id: `mock-${Date.now()}`,
      choices: [
        {
          message: {
            role: 'assistant',
            content: response.content,
            tool_calls: null,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    };
  }

  if (response.type === 'tool_calls') {
    return {
      id: `mock-${Date.now()}`,
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: response.calls.map((c) => ({
              id: c.id,
              type: 'function',
              function: {
                name: c.name,
                arguments: JSON.stringify(c.arguments),
              },
            })),
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 80,
        total_tokens: 280,
      },
    };
  }

  throw new Error('Unknown mock response type');
}
