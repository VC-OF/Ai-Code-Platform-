import { NextRequest, NextResponse } from 'next/server';
import { getDockerStatus, listDockerContainers } from '@/lib/dockerService';
import { isDockerMode } from '@/lib/safeExec';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get('refresh') === 'true';
    const includeContainers = searchParams.get('containers') === 'true';

    const status = await getDockerStatus(forceRefresh);
    const containers = includeContainers && status.available ? await listDockerContainers(true) : [];

    return NextResponse.json({
      ...status,
      sandboxModeActive: isDockerMode(),
      containers,
    });
  } catch (err) {
    return NextResponse.json(
      {
        available: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
