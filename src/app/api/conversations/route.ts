import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { conversationDb } from '@/lib/db';
import { getDefaultModel } from '@/lib/models';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const conversations = conversationDb.list(user?.id);
    return NextResponse.json({ conversations });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New Chat';
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : getDefaultModel();

    const conversation = conversationDb.create({
      user_id: user?.id ?? null,
      title,
      model,
      pinned: !!body.pinned,
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
