import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { conversationDb } from '@/lib/db';
import { getLLMClient, LLMMessage } from '@/lib/llmClient';
import { extractArtifacts, extractThinking } from '@/lib/chatArtifacts';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const OPEN_CHAT_SYSTEM_PROMPT = `You are Open Chat, an advanced AI conversational and coding assistant built into the Open Code platform.
You are equivalent in capability, intelligence, and elegance to Claude Chat.

Key Guidelines:
1. Interactive Artifacts:
   When writing substantive, interactive, or self-contained content (web apps, HTML/JS widgets, SVG illustrations, Mermaid diagrams, or React components), wrap them in an artifact tag so the user can interact with them directly in the Artifacts Canvas:
   <antArtifact identifier="unique-id" type="application/vnd.ant.code" language="html|svg|mermaid|tsx|markdown" title="Descriptive Title">
   ... code ...
   </antArtifact>
   - For HTML: include full responsive styling (<style>) and interactive script (<script>) so it renders beautifully in a sandbox.
   - For SVG: provide valid self-contained <svg> markup.
   - For Mermaid: provide valid Mermaid syntax (flowchart, sequenceDiagram, classDiagram, etc.).
   - For React: provide standard TypeScript/JSX components.

2. Extended Thinking & Reasoning:
   When working through complex algorithms, designs, or technical proofs, enclose your internal reasoning in <think>...</think> tags before presenting the final response.

3. Formatting & Math:
   - Use standard GitHub Flavored Markdown.
   - Format math using LaTeX: inline $x^2$ or block $$e^{i\\pi} + 1 = 0$$.
   - Be concise, helpful, and technically accurate.
`;

export async function POST(req: NextRequest, context: RouteContext) {
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

    const body = await req.json().catch(() => ({}));
    const userPrompt = typeof body.content === 'string' ? body.content.trim() : '';
    const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!userPrompt && rawAttachments.length === 0) {
      return NextResponse.json({ error: 'Message content or attachment is required' }, { status: 400 });
    }

    const modelToUse = (typeof body.model === 'string' && body.model.trim()) || conversation.model;

    // Auto-update conversation title if it was "New Chat"
    if (conversation.title === 'New Chat' || !conversation.title) {
      const titleSource = userPrompt || (rawAttachments[0]?.name ? `Attachment: ${rawAttachments[0].name}` : 'New Chat');
      const summaryTitle = titleSource.length > 36 ? titleSource.slice(0, 36) + '…' : titleSource;
      conversationDb.update(id, { title: summaryTitle, model: modelToUse });
    }

    // Save user message to database with attachments
    conversationDb.addMessage({
      conversation_id: id,
      role: 'user',
      content: userPrompt || (rawAttachments.length > 0 ? `[Sent ${rawAttachments.length} attachment${rawAttachments.length > 1 ? 's' : ''}]` : ''),
      attachments: rawAttachments,
      model: modelToUse,
    });

    // Prepare message history for LLM
    const previousMessages: LLMMessage[] = conversation.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    // Format user prompt with attachments (text files injected into prompt, images as vision parts)
    let augmentedPromptText = userPrompt;
    const textAttachments = rawAttachments.filter((a: { isImage?: boolean; textContent?: string }) => !a.isImage && a.textContent);
    const imageAttachments = rawAttachments.filter((a: { isImage?: boolean; dataUrl?: string; url?: string }) => a.isImage && (a.dataUrl || a.url));

    if (textAttachments.length > 0) {
      augmentedPromptText += '\n\n' + textAttachments.map((a: { name: string; textContent?: string }) => (
        `--- Attached File: ${a.name} ---\n\`\`\`\n${a.textContent || ''}\n\`\`\`\n--- End File ---`
      )).join('\n\n');
    }

    let userMessageParam: LLMMessage;
    if (imageAttachments.length > 0) {
      userMessageParam = {
        role: 'user',
        content: [
          { type: 'text', text: augmentedPromptText || 'Analyze the attached image(s).' },
          ...imageAttachments.map((img: { dataUrl?: string; url?: string }) => ({
            type: 'image_url' as const,
            image_url: { url: img.dataUrl || img.url || '' },
          })),
        ],
      };
    } else {
      userMessageParam = {
        role: 'user',
        content: augmentedPromptText,
      };
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: OPEN_CHAT_SYSTEM_PROMPT },
      ...previousMessages,
      userMessageParam,
    ];

    // SSE Stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        const startTime = Date.now();
        let fullRawResponse = '';
        let fullThinking = '';
        let isInThinkTag = false;

        try {
          const { client, apiModel } = await getLLMClient(modelToUse);
          const responseStream = await client.chat.completions.create({
            model: apiModel,
            messages,
            stream: true,
          });

          for await (const chunk of responseStream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            // Check provider-native reasoning content (DeepSeek R1 / o1 / o3)
            const reasoningDelta = (delta as unknown as { reasoning_content?: string }).reasoning_content;
            if (reasoningDelta) {
              fullThinking += reasoningDelta;
              sendEvent('thinking', { delta: reasoningDelta });
              continue;
            }

            const textDelta = delta.content || '';
            if (!textDelta) continue;

            fullRawResponse += textDelta;

            // Handle inline <think> and </think> delimiters
            if (textDelta.includes('<think>')) {
              isInThinkTag = true;
              const parts = textDelta.split('<think>');
              if (parts[0]) sendEvent('text', { delta: parts[0] });
              if (parts[1]) {
                fullThinking += parts[1];
                sendEvent('thinking', { delta: parts[1] });
              }
              continue;
            }

            if (isInThinkTag) {
              if (textDelta.includes('</think>')) {
                isInThinkTag = false;
                const parts = textDelta.split('</think>');
                if (parts[0]) {
                  fullThinking += parts[0];
                  sendEvent('thinking', { delta: parts[0] });
                }
                if (parts[1]) sendEvent('text', { delta: parts[1] });
              } else {
                fullThinking += textDelta;
                sendEvent('thinking', { delta: textDelta });
              }
              continue;
            }

            sendEvent('text', { delta: textDelta });
          }

          const thinkingMs = Date.now() - startTime;

          // Extract final thinking and artifacts from accumulated response
          const { thinking: extractedThink, cleanText } = extractThinking(fullRawResponse);
          const finalThinking = fullThinking.trim() || extractedThink || null;
          const { artifacts, cleanText: finalText } = extractArtifacts(cleanText || fullRawResponse);

          // If artifacts were generated, stream artifact event
          if (artifacts.length > 0) {
            sendEvent('artifacts', { artifacts });
          }

          // Persist assistant message to database
          const assistantMsg = conversationDb.addMessage({
            conversation_id: id,
            role: 'assistant',
            content: finalText,
            thinking: finalThinking,
            thinking_ms: finalThinking ? thinkingMs : null,
            artifacts,
            model: modelToUse,
          });

          sendEvent('done', {
            id: assistantMsg.id,
            content: finalText,
            thinking: finalThinking,
            thinking_ms: finalThinking ? thinkingMs : null,
            artifacts,
          });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const userMessage = `I couldn't get a response from the selected AI model. ${errorMessage}`;
          sendEvent('text', { delta: userMessage });

          const assistantMsg = conversationDb.addMessage({
            conversation_id: id,
            role: 'assistant',
            content: userMessage,
            model: modelToUse,
          });
          sendEvent('done', {
            id: assistantMsg.id,
            content: userMessage,
            thinking: null,
            thinking_ms: null,
            artifacts: [],
          });        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
