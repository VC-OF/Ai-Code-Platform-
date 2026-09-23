import { NextRequest, NextResponse } from 'next/server';
import { agentManager } from '@/lib/agentManager';

export const runtime = 'nodejs';

/** Queue a user message into a running agent turn (mid-run steering).
 *  The loop injects it before its next LLM step. */
export async function POST(req: NextRequest) {
  try {
    const { projectId, content } = await req.json();
    if (!projectId || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json(
        { error: 'projectId and content are required' },
        { status: 400 }
      );
    }
    const queued = agentManager.queueUserMessage(projectId, content);
    return NextResponse.json({ queued });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
