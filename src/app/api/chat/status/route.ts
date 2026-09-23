import { NextRequest, NextResponse } from 'next/server';
import { agentManager } from '@/lib/agentManager';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }
    const running = agentManager.isRunning(projectId);
    const status = agentManager.getStatus(projectId);
    return NextResponse.json({ running, status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
