import { NextRequest, NextResponse } from 'next/server';
import { getLLMClient } from '@/lib/llmClient';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { prompt, code, language, instruction, model } = await req.json();

    if (!instruction && !prompt) {
      return NextResponse.json({ error: 'Instruction or prompt is required' }, { status: 400 });
    }

    const { client, apiModel } = await getLLMClient(model);

    const systemPrompt = `You are an expert AI code editor. You perform precise inline code transformations.
Output ONLY the replacement code. Do not include markdown code fences (like \`\`\`), do not include explanations or conversational text. Output pure, valid code.`;

    const userMessage = `Language: ${language || 'typescript'}
Instruction: ${instruction || prompt}

Original Code:
${code || ''}

Provide ONLY the updated code replacement:`;

    const response = await client.chat.completions.create({
      model: apiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
    });

    let result = response.choices[0]?.message?.content || '';

    // Strip wrapping markdown code blocks if the model accidentally included them
    if (result.startsWith('```')) {
      const lines = result.split('\n');
      lines.shift(); // remove opening ```
      if (lines.length > 0 && lines[lines.length - 1].trim() === '```') {
        lines.pop(); // remove closing ```
      }
      result = lines.join('\n');
    }

    return NextResponse.json({
      success: true,
      replacement: result,
      model: apiModel,
    });
  } catch (err) {
    console.error('Error in inline AI completion:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
