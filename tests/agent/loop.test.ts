import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockLLMClient } from '../helpers/mockLLM';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';
import { executeTool, createTurnContext } from '@/lib/tools';

describe('agent loop and mock llm tests', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({
      'src/math.ts': 'export function square(n: number) { return n * n; }\n',
    });
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  describe('MockLLMClient turn orchestration', () => {
    it('processes complete mock turns with reads, edits, and verification', async () => {
      const client = new MockLLMClient();
      client.agentTurn({
        readFiles: ['src/math.ts'],
        editFiles: [
          {
            path: 'src/math.ts',
            oldText: 'return n * n;',
            newText: 'return Math.pow(n, 2);',
          },
        ],
        runLint: true,
        runTests: true,
        finalMessage: 'Refactored square function with tests.',
      });

      // Turn 1: Read files
      const completion1 = await client.createCompletion([]);
      expect(completion1.choices[0].message.tool_calls).toHaveLength(1);
      expect(completion1.choices[0].message.tool_calls![0].function.name).toBe('read_file');

      // Turn 2: Edit files
      const completion2 = await client.createCompletion([]);
      expect(completion2.choices[0].message.tool_calls).toHaveLength(1);
      expect(completion2.choices[0].message.tool_calls![0].function.name).toBe('edit_file');

      // Turn 3: Run lint
      const completion3 = await client.createCompletion([]);
      expect(completion3.choices[0].message.tool_calls![0].function.name).toBe('run_lint');

      // Turn 4: Run tests
      const completion4 = await client.createCompletion([]);
      expect(completion4.choices[0].message.tool_calls![0].function.name).toBe('run_tests');

      // Turn 5: Final text message
      const completion5 = await client.createCompletion([]);
      expect(completion5.choices[0].message.content).toBe('Refactored square function with tests.');
      expect(completion5.choices[0].message.tool_calls).toBeNull();

      client.assertExhausted();
    });

    it('handles simulated LLM error responses with status codes', async () => {
      const client = new MockLLMClient();
      client.error('Rate limit reached', 429);

      await expect(client.createCompletion([])).rejects.toThrow('Rate limit reached');
      client.assertExhausted();
    });

    it('asserts exhausted correctly when unconsumed items remain', async () => {
      const client = new MockLLMClient();
      client.text('Step 1');
      client.text('Step 2');

      await client.createCompletion([]);
      expect(() => client.assertExhausted()).toThrow('1 unused responses remaining');
    });
  });

  describe('Agent turn context and tool execution workflow', () => {
    it('executes simulated turn tools and respects verification constraints', async () => {
      const ctx = createTurnContext();

      // Read file first
      const readRes = await executeTool(
        'read_file',
        { path: 'src/math.ts' },
        ws.root,
        ctx
      );
      expect(readRes.success).toBe(true);
      expect(ctx.filesRead.has('src/math.ts')).toBe(true);

      // Edit file
      const editRes = await executeTool(
        'edit_file',
        {
          path: 'src/math.ts',
          oldText: 'return n * n;',
          newText: 'return Math.pow(n, 2);',
        },
        ws.root,
        ctx
      );
      expect(editRes.success).toBe(true);
      expect(ctx.filesEdited.has('src/math.ts')).toBe(true);
      expect(editRes.changedFile).toBe('src/math.ts');

      // When the loop sees a changed file, it marks hasEdits
      if (editRes.changedFile) {
        ctx.hasEdits = true;
      }
      expect(ctx.hasEdits).toBe(true);

      // Verify that edits without lint/test leave verification flag incomplete
      const needsVerification = ctx.hasEdits && !ctx.hasRunLint && !ctx.hasRunTests;
      expect(needsVerification).toBe(true);

      // Run verification (lint)
      const lintRes = await executeTool('run_lint', {}, ws.root, ctx);
      expect(lintRes.success).toBe(true);
      ctx.hasRunLint = true;

      // Verification is now satisfied
      const stillNeedsVerification = ctx.hasEdits && !ctx.hasRunLint && !ctx.hasRunTests;
      expect(stillNeedsVerification).toBe(false);
    });
  });
});
