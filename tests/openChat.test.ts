import { describe, it, expect } from 'vitest';
import { conversationDb } from '@/lib/db';
import { extractArtifacts, extractThinking } from '@/lib/chatArtifacts';
import { GET as listConversations, POST as createConversation } from '@/app/api/conversations/route';
import { GET as getConversation, PATCH as updateConversation, DELETE as deleteConversation } from '@/app/api/conversations/[id]/route';
import { NextRequest } from 'next/server';

describe('Open Chat: Database & Model Layer', () => {
  const testUserId = `test-user-${Date.now()}`;

  it('creates and lists conversations with pinning order', () => {
    const c1 = conversationDb.create({
      user_id: testUserId,
      title: 'First Chat',
      model: 'claude-3-7-sonnet',
      pinned: false,
    });
    const c2 = conversationDb.create({
      user_id: testUserId,
      title: 'Second Chat (Pinned)',
      model: 'gpt-4o',
      pinned: true,
    });

    const list = conversationDb.list(testUserId);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // Pinned chat must come first
    expect(list[0].id).toBe(c2.id);
    expect(list[0].pinned).toBe(1);

    // Cleanup
    conversationDb.delete(c1.id);
    conversationDb.delete(c2.id);
  });

  it('adds messages, thinking metadata, and artifacts to a conversation', () => {
    const convo = conversationDb.create({
      title: 'Artifacts Demo Chat',
      model: 'claude-3-7-sonnet',
    });

    const userMsg = conversationDb.addMessage({
      conversation_id: convo.id,
      role: 'user',
      content: 'Build me an interactive calculator',
    });
    expect(userMsg.role).toBe('user');

    const assistantMsg = conversationDb.addMessage({
      conversation_id: convo.id,
      role: 'assistant',
      content: 'Here is your calculator app.',
      thinking: 'Analyzing requirements: HTML layout, calculator logic, arithmetic operations.',
      thinking_ms: 1450,
      artifacts: [
        {
          id: 'calc-app',
          title: 'Interactive Calculator',
          type: 'html',
          language: 'html',
          content: '<div class="calc">Calculator</div>',
        },
      ],
      model: 'claude-3-7-sonnet',
    });

    expect(assistantMsg.thinking).toContain('Analyzing requirements');
    expect(assistantMsg.thinking_ms).toBe(1450);

    const fetched = conversationDb.get(convo.id);
    expect(fetched).toBeDefined();
    expect(fetched!.messages.length).toBe(2);
    expect(fetched!.messages[1].role).toBe('assistant');
    expect(fetched!.messages[1].artifacts).toContain('Interactive Calculator');

    // Cleanup
    conversationDb.delete(convo.id);
  });

  it('updates conversation title, model, and pinned state', () => {
    const convo = conversationDb.create({
      title: 'Old Title',
      model: 'gpt-4o-mini',
    });

    const ok = conversationDb.update(convo.id, {
      title: 'Updated Title',
      model: 'claude-3-7-sonnet',
      pinned: true,
    });
    expect(ok).toBe(true);

    const updated = conversationDb.get(convo.id);
    expect(updated?.title).toBe('Updated Title');
    expect(updated?.model).toBe('claude-3-7-sonnet');
    expect(updated?.pinned).toBe(1);

    // Delete
    expect(conversationDb.delete(convo.id)).toBe(true);
    expect(conversationDb.get(convo.id)).toBeUndefined();
  });
});

describe('Open Chat: Artifact & Thinking Extraction', () => {
  it('extracts <think> blocks cleanly', () => {
    const raw = `<think>
Consider the edge cases: empty array, negative integers, overflow.
Optimal strategy is two pointers with O(n) complexity.
</think>
Here is the solution to your problem.`;

    const { thinking, cleanText } = extractThinking(raw);
    expect(thinking).toContain('Optimal strategy is two pointers');
    expect(cleanText).toBe('Here is the solution to your problem.');
  });

  it('extracts Claude-style <antArtifact> tags into ExtractedArtifact', () => {
    const raw = `I have generated the interactive component for you:

<antArtifact identifier="counter-app" type="application/vnd.ant.code" language="html" title="Interactive Counter Widget">
<!DOCTYPE html>
<html>
  <body>
    <button onclick="count++">Increment</button>
  </body>
</html>
</antArtifact>

Let me know if you need any adjustments!`;

    const { cleanText, artifacts } = extractArtifacts(raw);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].id).toBe('counter-app');
    expect(artifacts[0].title).toBe('Interactive Counter Widget');
    expect(artifacts[0].type).toBe('html');
    expect(artifacts[0].content).toContain('<button onclick="count++">');
    expect(cleanText).toContain(':::artifact{id="counter-app"');
  });

  it('extracts standalone SVG vector graphics and Mermaid diagrams into artifacts', () => {
    const rawSvg = `Here is your vector icon:

\`\`\`svg
<svg width="100" height="100" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="blue" />
</svg>
\`\`\`
Hope this helps!`;

    const result = extractArtifacts(rawSvg);
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].type).toBe('svg');
    expect(result.artifacts[0].content).toContain('<circle cx="50"');
  });
});

describe('Open Chat: API Endpoints', () => {
  it('handles GET and POST /api/conversations', async () => {
    // POST new conversation
    const createReq = new NextRequest('http://localhost:3000/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        title: 'API Integration Test',
        model: 'claude-3-7-sonnet',
      }),
    });

    const createRes = await createConversation(createReq);
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    expect(createData.conversation.title).toBe('API Integration Test');
    const convoId = createData.conversation.id;

    // GET /api/conversations
    const listReq = new NextRequest('http://localhost:3000/api/conversations');
    const listRes = await listConversations(listReq);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.conversations.some((c: { id: string }) => c.id === convoId)).toBe(true);

    // GET /api/conversations/[id]
    const getRes = await getConversation(new NextRequest(`http://localhost:3000/api/conversations/${convoId}`), {
      params: Promise.resolve({ id: convoId }),
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.conversation.id).toBe(convoId);

    // PATCH /api/conversations/[id]
    const patchRes = await updateConversation(
      new NextRequest(`http://localhost:3000/api/conversations/${convoId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Patched Title', pinned: true }),
      }),
      { params: Promise.resolve({ id: convoId }) }
    );
    expect(patchRes.status).toBe(200);

    // DELETE /api/conversations/[id]
    const deleteRes = await deleteConversation(
      new NextRequest(`http://localhost:3000/api/conversations/${convoId}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: convoId }) }
    );
    expect(deleteRes.status).toBe(200);
  });

  it('handles POST /api/conversations/[id]/messages and streams response', async () => {
    // 1. Create a conversation
    const createReq = new NextRequest('http://localhost:3000/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Streaming Test Chat',
        model: 'claude-3-7-sonnet',
      }),
    });
    const createRes = await createConversation(createReq);
    const createData = await createRes.json();
    const convoId = createData.conversation.id;

    // 2. Post a message to stream
    const { POST: postMessage } = await import('@/app/api/conversations/[id]/messages/route');
    const msgReq = new NextRequest(`http://localhost:3000/api/conversations/${convoId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: 'Create an SVG logo with glowing gradients',
        model: 'claude-3-7-sonnet',
      }),
    });

    const streamRes = await postMessage(msgReq, {
      params: Promise.resolve({ id: convoId }),
    });

    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream');

    const reader = streamRes.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let accumulatedSSE = '';
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      accumulatedSSE += decoder.decode(value, { stream: true });
    }

    // Verify events were emitted in SSE stream
    expect(accumulatedSSE).toContain('event: done');
    expect(accumulatedSSE).toContain('event: text');
    if (accumulatedSSE.includes("I couldn't get a response from the selected AI model.")) {
      expect(accumulatedSSE).toContain('No API key set on the server');
      expect(accumulatedSSE).not.toContain('Interactive Application Preview');
    }

    // Verify conversation was updated in DB
    const updatedConvo = conversationDb.get(convoId);
    expect(updatedConvo).toBeDefined();
    expect(updatedConvo!.messages.length).toBe(2);
    expect(updatedConvo!.messages[0].role).toBe('user');
    expect(updatedConvo!.messages[0].content).toBe('Create an SVG logo with glowing gradients');
    expect(updatedConvo!.messages[1].role).toBe('assistant');
    expect(updatedConvo!.messages[1].content.length).toBeGreaterThan(0);

    // Cleanup
    conversationDb.delete(convoId);
  });

  it('stores and retrieves message attachments', () => {
    const convo = conversationDb.create({
      title: 'Attachment Test Chat',
      model: 'claude-3-7-sonnet',
    });

    const attachments = [
      {
        id: 'att-12345',
        name: 'sample.py',
        size: 120,
        type: 'text/x-python',
        textContent: 'print("hello world")',
      },
      {
        id: 'att-67890',
        name: 'chart.png',
        size: 2048,
        type: 'image/png',
        isImage: true,
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
    ];

    const msg = conversationDb.addMessage({
      conversation_id: convo.id,
      role: 'user',
      content: 'Analyze this script and chart',
      attachments,
    });

    expect(msg.attachments).toBeDefined();
    const parsed = JSON.parse(msg.attachments!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('sample.py');
    expect(parsed[1].isImage).toBe(true);

    const fetched = conversationDb.get(convo.id);
    expect(fetched!.messages[0].attachments).toBeDefined();

    conversationDb.delete(convo.id);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import ModeToggle from '@/components/layout/ModeToggle';

describe('Open Chat: ModeToggle Component', () => {
  it('renders both options with Open Code active', () => {
    const html = renderToStaticMarkup(
      React.createElement(ModeToggle, { activeMode: 'code', onModeChange: () => {} })
    );
    expect(html).toContain('Open Code');
    expect(html).toContain('Open Chat');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('mode-toggle-btn--active');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Workspace mode switcher"');
  });

  it('renders both options with Open Chat active', () => {
    const html = renderToStaticMarkup(
      React.createElement(ModeToggle, { activeMode: 'chat', onModeChange: () => {} })
    );
    expect(html).toContain('Open Code');
    expect(html).toContain('Open Chat');
    expect(html).toContain('mode-toggle-icon--claude');
  });
});

