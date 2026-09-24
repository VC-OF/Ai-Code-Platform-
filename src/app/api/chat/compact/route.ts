import { NextRequest, NextResponse } from 'next/server';
import { messageDb, getDb } from '@/lib/db';
import { getContextWindow } from '@/lib/models';
import { config } from '@/lib/config';
import {
  splitForCompaction,
  serializeForSummary,
  SUMMARIZE_SYSTEM_PROMPT,
  compactMessages,
  estimateTokens,
  estimateMessageTokens,
  type ContextMessage,
} from '@/lib/contextManager';
import { callLLM } from '@/lib/llmClient';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = body.projectId as string;
    const model = (body.model as string) || config.DEFAULT_MODEL;

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const windowSize = getContextWindow(model);
    const dbMessages = messageDb.getRecent(projectId, 500);

    if (dbMessages.length < 4) {
      return NextResponse.json({
        success: true,
        compacted: false,
        message: 'Context is already minimal (less than 4 messages).',
        windowSize,
        before: {
          messages: dbMessages.length,
          tokens: dbMessages.reduce((s, m) => s + estimateTokens(m.content || ''), 0),
        },
        after: {
          messages: dbMessages.length,
          tokens: dbMessages.reduce((s, m) => s + estimateTokens(m.content || ''), 0),
        },
      });
    }

    const contextMessages: ContextMessage[] = dbMessages.map((m) => {
      let toolCalls: unknown = undefined;
      if (m.tool_calls) {
        try {
          toolCalls = JSON.parse(m.tool_calls);
        } catch {}
      }
      return {
        role: m.role as ContextMessage['role'],
        content: m.content,
        tool_calls: toolCalls,
        tool_call_id: m.tool_call_id ?? undefined,
        tool_name: m.tool_name ?? undefined,
      };
    });

    const tokensBefore = contextMessages.reduce(
      (sum, m) => sum + estimateMessageTokens(m),
      0
    );
    const messagesBefore = contextMessages.length;

    // Split messages keeping the 6 most recent messages
    const split = splitForCompaction(contextMessages, 6);
    let summaryText = '';

    if (split && split.evicted.length > 0) {
      try {
        const summaryResp = await callLLM(
          { model },
          [
            { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
            { role: 'user', content: serializeForSummary(split.evicted) },
          ],
          undefined,
          { toolChoice: 'none' }
        );
        summaryText = summaryResp.content?.trim() || '';
      } catch (err) {
        console.warn('[compact] LLM summary failed, falling back to local compaction:', err);
      }
    }

    if (!summaryText) {
      // Local heuristic compaction
      const compacted = compactMessages(contextMessages, {
        model,
        targetRatio: 0.6,
        minRatio: 0.4,
        preserveLastN: 6,
      });
      return NextResponse.json({
        success: true,
        compacted: true,
        method: 'heuristic',
        windowSize,
        before: { messages: messagesBefore, tokens: tokensBefore },
        after: { messages: compacted.messages.length, tokens: compacted.tokensAfter },
      });
    }

    // Replace the evicted message records in the database with the compressed summary message
    const evictedIds = dbMessages
      .slice(split!.head.length, split!.head.length + split!.evicted.length)
      .map((m) => m.id);

    const firstEvicted = dbMessages[split!.head.length];
    const turnIndex = firstEvicted?.turn_index ?? 0;

    const db = getDb();
    const transaction = db.transaction(() => {
      if (evictedIds.length > 0) {
        const placeholders = evictedIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...evictedIds);
      }

      messageDb.insert({
        id: `msg_compact_${Date.now()}`,
        project_id: projectId,
        role: 'user',
        content:
          '[Context summary — earlier conversation was compacted. This brief is your memory of that span:]\n\n' +
          summaryText,
        tool_calls: null,
        tool_call_id: null,
        tool_name: null,
        turn_index: turnIndex,
        tokens_used: estimateTokens(summaryText),
      });
    });

    transaction();

    const updatedDbMessages = messageDb.getRecent(projectId, 500);
    const tokensAfter = updatedDbMessages.reduce(
      (sum, m) => sum + estimateTokens(m.content || ''),
      0
    );

    return NextResponse.json({
      success: true,
      compacted: true,
      method: 'llm_summary',
      windowSize,
      before: { messages: messagesBefore, tokens: tokensBefore },
      after: { messages: updatedDbMessages.length, tokens: tokensAfter },
      summary: summaryText.slice(0, 300) + (summaryText.length > 300 ? '…' : ''),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
