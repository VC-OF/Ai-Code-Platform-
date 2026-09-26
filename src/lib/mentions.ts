import fs from 'fs/promises';
import { safeResolve } from './safeResolve';

/**
 * `@path` mentions in a user message: each one that resolves to a file or
 * directory inside the workspace is attached below the message. Paths that
 * escape the workspace are rejected; unknown paths stay plain text.
 */

export const MAX_MENTION_CHARS = 20_000;
const MAX_MENTIONS = 10;
const MAX_DIR_ENTRIES = 200;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next']);

// "@" at the start or after whitespace/an opening bracket — not emails
const MENTION = /(^|[\s(["'])@([^\s@`'"<>()[\]{}]+)/g;

export function extractMentions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MENTION)) {
    const raw = m[2].replace(/[.,;:!?]+$/, '');
    if (raw && !out.includes(raw)) out.push(raw);
  }
  return out;
}

export async function resolveMentions(
  text: string,
  workspace: string
): Promise<{ text: string; attached: string[] }> {
  const attached: string[] = [];
  const blocks: string[] = [];
  for (const ref of extractMentions(text).slice(0, MAX_MENTIONS)) {
    let full: string;
    try {
      full = safeResolve(workspace, ref);
    } catch {
      continue; // traversal / blocked path
    }
    try {
      const stat = await fs.stat(full);
      if (stat.isDirectory()) {
        const entries = (await fs.readdir(full, { withFileTypes: true }))
          .filter((e) => !SKIP_DIRS.has(e.name))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort();
        const shown = entries.slice(0, MAX_DIR_ENTRIES);
        const more = entries.length > shown.length ? `\n… ${entries.length - shown.length} more` : '';
        blocks.push(`[Attached directory @${ref}]\n\`\`\`\n${shown.join('\n') || '(empty)'}${more}\n\`\`\``);
      } else if (stat.isFile()) {
        let content = await fs.readFile(full, 'utf8');
        if (content.length > MAX_MENTION_CHARS) {
          content = `${content.slice(0, MAX_MENTION_CHARS)}\n…[truncated at ${MAX_MENTION_CHARS} chars]`;
        }
        blocks.push(`[Attached file @${ref}]\n\`\`\`\n${content}\n\`\`\``);
      } else {
        continue;
      }
      attached.push(ref);
    } catch {
      // Not found — leave the mention as text
    }
  }
  return { text: blocks.length ? `${text}\n\n${blocks.join('\n\n')}` : text, attached };
}
