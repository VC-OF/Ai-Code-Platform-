import { NextRequest, NextResponse } from 'next/server';
import { streamRegistry } from '@/lib/cancellation';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = body.projectId;
    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }
    const cancelled = streamRegistry.cancel(projectId, 'User clicked stop');
    return NextResponse.json({ success: true, cancelled });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
