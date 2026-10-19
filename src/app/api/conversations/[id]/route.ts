import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { conversationDb } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const conversation = conversationDb.get(id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const user = await getCurrentUser(req);
    if (conversation.user_id && user && conversation.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse artifacts JSON strings if present in messages
    const formattedMessages = conversation.messages.map((m) => {
      let parsedArtifacts = null;
      if (m.artifacts) {
        try {
          parsedArtifacts = JSON.parse(m.artifacts);
        } catch {}
      }
      return {
        ...m,
        artifacts: parsedArtifacts,
      };
    });

    return NextResponse.json({
      conversation: {
        ...conversation,
        messages: formattedMessages,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const existing = conversationDb.get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const user = await getCurrentUser(req);
    if (existing.user_id && user && existing.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const updates: { title?: string; pinned?: boolean; model?: string } = {};

    if (typeof body.title === 'string') updates.title = body.title.trim();
    if (typeof body.pinned === 'boolean') updates.pinned = body.pinned;
    if (typeof body.model === 'string') updates.model = body.model.trim();

    const ok = conversationDb.update(id, updates);
    if (!ok) {
      return NextResponse.json({ error: 'Failed to update conversation' }, { status: 400 });
    }

    const updated = conversationDb.get(id);
    return NextResponse.json({ conversation: updated });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const existing = conversationDb.get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const user = await getCurrentUser(req);
    if (existing.user_id && user && existing.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const ok = conversationDb.delete(id);
    return NextResponse.json({ success: ok });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
