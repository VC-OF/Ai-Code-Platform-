// Text heuristics for replies that fake tool calls or claim unverified work
import { type ContextMessage } from '../contextManager';

/** Heuristic: does `text` contain tool invocations written as plain text
 *  (e.g. `<tool_call>`, `<function=create_file>`, `## create_file ##`, or a
 *  JSON object naming a known tool) instead of native tool calls? */
export function looksLikeTextToolCall(text: string, toolNames: string[]): boolean {
  if (!text) return false;
  if (/<tool_call>|<\/tool_call>|<function=|<\|tool_call|\[TOOL_CALLS\]/i.test(text)) return true;
  if (!toolNames.length) return false;
  const names = toolNames.filter((n) => /^[\w-]+$/.test(n)).join('|');
  if (!names) return false;
  const patterns = [
    new RegExp(`^\\s*#{1,3}\\s*(${names})\\s*#{1,3}\\s*$`, 'm'),
    new RegExp(`"(?:tool|name|tool_name|function)"\\s*:\\s*"(${names})"`),
  ];
  return patterns.some((re) => re.test(text));
}

/** Does a final reply claim work was done (files written, tests run)? */
export function claimsCompletedWork(text: string): boolean {
  return /\b(created|wrote|written|added|implemented|updated|built|generated|ran|executed|tests?\s+(?:all\s+)?pass(?:ed|es)?)\b/i.test(text);
}

/** Providers reject a history where an assistant tool call has no matching
 *  tool result. A turn cut short mid-tool-batch leaves such calls — answer
 *  them with a placeholder so the saved history stays valid. */
export function closeDanglingToolCalls(messages: ContextMessage[]): ContextMessage[] {
  const out: ContextMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    out.push(m);
    const calls = m.tool_calls as { id: string; function?: { name?: string } }[] | undefined;
    if (m.role !== 'assistant' || !Array.isArray(calls) || calls.length === 0) continue;
    const answered = new Set<string>();
    let j = i + 1;
    while (j < messages.length && messages[j].role === 'tool') {
      answered.add(String(messages[j].tool_call_id));
      out.push(messages[j]);
      j++;
    }
    for (const tc of calls) {
      if (!answered.has(tc.id)) {
        out.push({
          role: 'tool',
          tool_call_id: tc.id,
          tool_name: tc.function?.name,
          content: '[Not run: the turn ended before this tool call executed]',
        } as ContextMessage);
      }
    }
    i = j - 1;
  }
  return out;
}
