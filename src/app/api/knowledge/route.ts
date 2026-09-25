import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/projects';
import { getWorkspaceRoot } from '@/lib/workspace';
import { listKnowledgeItems, saveKnowledgeItem, deleteKnowledgeItem } from '@/lib/knowledge';

// ids become file names under .knowledge/ — block path traversal
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

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

  const items = await listKnowledgeItems(getWorkspaceRoot(projectId));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, id, title, summary, tags, content } = body;
    if (!projectId || !title || !summary || content === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (id !== undefined && (typeof id !== 'string' || !ID_PATTERN.test(id))) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const item = await saveKnowledgeItem(getWorkspaceRoot(projectId), {
      id,
      title,
      summary,
      tags,
      content,
    });

    return NextResponse.json({ success: true, item });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');
  const id = searchParams.get('id');

  if (!projectId || !id) {
    return NextResponse.json({ error: 'Missing projectId or id' }, { status: 400 });
  }
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const success = await deleteKnowledgeItem(getWorkspaceRoot(projectId), id);
  return NextResponse.json({ success });
}
