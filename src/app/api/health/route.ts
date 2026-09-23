import { NextResponse } from 'next/server';
import { dbHealthCheck } from '@/lib/db';
import { workspaceLocks } from '@/lib/workspaceLock';
import { streamRegistry } from '@/lib/cancellation';

export const runtime = 'nodejs';

export async function GET() {
  const dbStatus = dbHealthCheck();
  const lockStatus = workspaceLocks.getStatus();
  const streamStatus = streamRegistry.getStatus();

  return NextResponse.json({
    status: dbStatus.ok ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    database: dbStatus,
    locks: lockStatus,
    streams: streamStatus,
  });
}
