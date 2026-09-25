import { NextRequest, NextResponse } from 'next/server';
import { messageDb } from '@/lib/db';
import { getContextWindow } from '@/lib/models';
import { config } from '@/lib/config';
import { estimateMessageTokens, type ContextMessage } from '@/lib/contextManager';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId') || 'default';
    const model = searchParams.get('model') || config.DEFAULT_MODEL;

    const windowSize = getContextWindow(model);
    const dbMessages = messageDb.getRecent(projectId, 500);

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

    const currentTokens = contextMessages.reduce(
      (sum, m) => sum + estimateMessageTokens(m),
      0
    );

    const compactThreshold = Math.floor(windowSize * 0.6);
    const compactTarget = Math.floor(windowSize * 0.4);

    return NextResponse.json({
      projectId,
      model,
      windowSize,
      currentTokens,
      ratio: currentTokens / windowSize,
      messageCount: contextMessages.length,
      compactThreshold,
      compactTarget,
      canCompact: contextMessages.length >= 4,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
