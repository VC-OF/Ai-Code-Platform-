import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

export const runtime = 'nodejs';

const ATTACHMENTS_DIR = path.join(process.cwd(), '.platform', 'attachments');

export async function POST(req: NextRequest) {
  try {
    await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });

    const contentType = req.headers.get('content-type') || '';
    const attachments = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const files = formData.getAll('files');

      for (const item of files) {
        if (!(item instanceof File)) continue;

        const id = `att-${crypto.randomUUID().slice(0, 12)}`;
        const name = item.name || 'attachment';
        const type = item.type || 'application/octet-stream';
        const size = item.size;
        const isImage = type.startsWith('image/');

        const buffer = Buffer.from(await item.arrayBuffer());
        const safeExt = path.extname(name) || (isImage ? '.png' : '.txt');
        const fileNameOnDisk = `${id}${safeExt}`;
        const filePath = path.join(ATTACHMENTS_DIR, fileNameOnDisk);

        await fs.writeFile(filePath, buffer);

        let textContent: string | undefined = undefined;
        let dataUrl: string | undefined = undefined;

        if (isImage) {
          // Provide base64 data URI for vision models
          const b64 = buffer.toString('base64');
          dataUrl = `data:${type};base64,${b64}`;
        } else if (
          type.startsWith('text/') ||
          name.endsWith('.ts') ||
          name.endsWith('.tsx') ||
          name.endsWith('.js') ||
          name.endsWith('.jsx') ||
          name.endsWith('.json') ||
          name.endsWith('.md') ||
          name.endsWith('.py') ||
          name.endsWith('.html') ||
          name.endsWith('.css') ||
          name.endsWith('.sh') ||
          name.endsWith('.sql')
        ) {
          // Extract text content for LLM ingestion
          textContent = buffer.toString('utf-8');
        }

        attachments.push({
          id,
          name,
          size,
          type,
          url: `/api/chat/attachments?id=${encodeURIComponent(fileNameOnDisk)}`,
          dataUrl,
          textContent: textContent?.slice(0, 100_000), // Cap at 100k chars for safety
          isImage,
        });
      }
    } else {
      // JSON payload (e.g. pasted image or base64)
      const body = await req.json().catch(() => ({}));
      if (body.name && body.dataUrl) {
        const id = `att-${crypto.randomUUID().slice(0, 12)}`;
        const name = body.name;
        const type = body.type || 'image/png';
        const isImage = type.startsWith('image/');
        const matches = body.dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        const buffer = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(body.dataUrl);

        const safeExt = path.extname(name) || (isImage ? '.png' : '.txt');
        const fileNameOnDisk = `${id}${safeExt}`;
        const filePath = path.join(ATTACHMENTS_DIR, fileNameOnDisk);
        await fs.writeFile(filePath, buffer);

        attachments.push({
          id,
          name,
          size: buffer.length,
          type,
          url: `/api/chat/attachments?id=${encodeURIComponent(fileNameOnDisk)}`,
          dataUrl: body.dataUrl,
          isImage,
        });
      }
    }

    return NextResponse.json({
      success: true,
      attachments,
    });
  } catch (err) {
    console.error('Failed to process attachments:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to upload attachments' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get('id');
    if (!fileId) {
      return NextResponse.json({ error: 'File id required' }, { status: 400 });
    }

    // Security check to prevent directory traversal
    const safeBaseName = path.basename(fileId);
    const filePath = path.join(ATTACHMENTS_DIR, safeBaseName);

    const buffer = await fs.readFile(filePath);
    const ext = path.extname(safeBaseName).toLowerCase();

    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.json': 'application/json',
      '.txt': 'text/plain; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
