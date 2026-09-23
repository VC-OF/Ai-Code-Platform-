import { NextRequest, NextResponse } from 'next/server';
import { agentManager } from '@/lib/agentManager';

export const runtime = 'nodejs';

/** Deliver the user's answer to a running agent's ask_user question. */
export async function POST(req: NextRequest) {
  try {
    const { projectId, answer } = await req.json();
    if (!projectId || typeof answer !== 'string') {
      return NextResponse.json(
        { error: 'projectId and answer are required' },
        { status: 400 }
      );
    }
    const delivered = agentManager.provideUserInput(projectId, answer);
    return NextResponse.json({ delivered });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
