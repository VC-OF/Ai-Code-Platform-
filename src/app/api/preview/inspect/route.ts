import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/projects';
import { getWorkspaceRoot } from '@/lib/workspace';
import { getPreviewStatus } from '@/lib/previewManager';
import { checkPreviewInBrowser } from '@/lib/browserCheck';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const preview = getPreviewStatus(projectId);
  if (preview.status !== 'running' || !preview.url) {
    return NextResponse.json({
      success: false,
      status: 'offline',
      error: `Preview server is not running (status: ${preview.status}). Start preview first to run browser verification.`,
    });
  }

  try {
    const relPath = searchParams.get('path') || '/';
    const targetUrl = `${preview.url}${relPath.startsWith('/') ? relPath : `/${relPath}`}`;
    const screenshotRelPath = `.preview/audit_${Date.now()}.png`;

    const result = await checkPreviewInBrowser(targetUrl, getWorkspaceRoot(projectId), screenshotRelPath);
    const totalProblems =
      result.pageErrors.length + result.consoleErrors.length + result.failedRequests.length;

    return NextResponse.json({
      success: true,
      status: totalProblems === 0 ? 'clean' : 'issues_detected',
      totalProblems,
      title: result.title,
      consoleErrors: result.consoleErrors,
      consoleWarnings: result.consoleWarnings,
      pageErrors: result.pageErrors,
      failedRequests: result.failedRequests,
      visibleTextPreview: result.visibleText.slice(0, 1000),
      screenshotPath: result.screenshotPath,
      checkedUrl: targetUrl,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
