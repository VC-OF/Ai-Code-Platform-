import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { computeContextBreakdown } from '@/lib/contextBreakdown';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId') || 'default';
    const model = searchParams.get('model') || config.DEFAULT_MODEL;

    const breakdown = await computeContextBreakdown({ projectId, model });
    const { windowSize, messageCount, messageTokens } = breakdown;

    return NextResponse.json({
      projectId,
      ...breakdown,
      // Backwards-compatible fields (context badge): history tokens only
      currentTokens: messageTokens,
      ratio: messageTokens / windowSize,
      compactTarget: Math.floor(windowSize * 0.4),
      canCompact: messageCount >= 4,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
