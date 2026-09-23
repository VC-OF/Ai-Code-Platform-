import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { workspaceLocks } from '@/lib/workspaceLock';
import { streamRegistry } from '@/lib/cancellation';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const db = getDb();
    
    // Gather tool execution logs
    const totalRuns = db.prepare('SELECT count(*) as count FROM tool_log').get() as { count: number };
    const successRuns = db.prepare('SELECT count(*) as count FROM tool_log WHERE success = 1').get() as { count: number };
    const avgDuration = db.prepare('SELECT avg(duration_ms) as avg_ms FROM tool_log').get() as { avg_ms: number };

    // Gather usage statistics
    const tokenStats = db.prepare(`
      SELECT
        model,
        sum(prompt_tokens) as prompt,
        sum(completion_tokens) as completion,
        count(distinct project_id) as project_count
      FROM usage_log
      GROUP BY model
    `).all() as {
      model: string;
      prompt: number;
      completion: number;
      project_count: number;
    }[];

    // Calculate error rates
    const errorRate = totalRuns.count > 0 
      ? ((totalRuns.count - successRuns.count) / totalRuns.count) * 100 
      : 0;

    return NextResponse.json({
      timestamp: Date.now(),
      metrics: {
        tool_execution: {
          total: totalRuns.count,
          success: successRuns.count,
          failed: totalRuns.count - successRuns.count,
          error_rate_pct: parseFloat(errorRate.toFixed(2)),
          average_duration_ms: Math.round(avgDuration.avg_ms || 0),
        },
        usage: tokenStats.map(row => ({
          model: row.model,
          prompt_tokens: row.prompt,
          completion_tokens: row.completion,
          total_tokens: row.prompt + row.completion,
          projects_active: row.project_count,
        })),
        system: {
          active_locks: Object.keys(workspaceLocks.getStatus()).filter(id => workspaceLocks.get(id).isLocked()).length,
          active_streams: Object.values(streamRegistry.getStatus()).filter(Boolean).length,
        }
      }
    });

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
