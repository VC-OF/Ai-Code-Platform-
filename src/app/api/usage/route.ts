import { NextRequest, NextResponse } from 'next/server';
import { usageDb } from '@/lib/db';

export const runtime = 'nodejs';

/** Per-project token usage for /cost and /usage. */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
  }
  try {
    return NextResponse.json({ models: usageDb.getModelBreakdown(projectId) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
