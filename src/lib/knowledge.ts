import fs from 'fs/promises';
import path from 'path';

export interface KnowledgeItem {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  content: string;
  createdAt: number;
  updatedAt: number;
}

// ids become file names — reject anything that could traverse out of the dir
function assertSafeId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid id: '${id}'`);
  }
}

function getKnowledgeDir(workspace: string): string {
  return path.join(workspace, '.knowledge');
}

export async function listKnowledgeItems(workspace: string): Promise<KnowledgeItem[]> {
  const dir = getKnowledgeDir(workspace);
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const items: KnowledgeItem[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), 'utf-8');
        const parsed = JSON.parse(raw) as KnowledgeItem;
        items.push(parsed);
      } catch {}
    }

    // Auto-seed initial starter knowledge items if empty
    if (items.length === 0) {
      const defaultKIs: KnowledgeItem[] = [
        {
          id: 'ki_arch_patterns',
          title: 'Repository Architecture & Conventions',
          summary: 'Core layout, Next.js App Router rules, and dark theme design tokens.',
          tags: ['architecture', 'design-tokens', 'nextjs'],
          content: `### Architecture & Tech Stack
- Framework: Next.js 14+ (App Router).
- Styling: Tailored CSS variables with vibrant glassmorphic dark palette.
- State: React local state with optimistic updates and local storage caching.
- Monaco Editor: In-editor AI editing enabled via Ctrl+I with direct AST range replacement.`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'ki_verification_rules',
          title: 'Autonomous Verification & Quality Gate',
          summary: 'Verification standards before completing tasks, including browser DOM inspection.',
          tags: ['verification', 'quality', 'browser-audit'],
          content: `### Verification Standards
- Always run linting or syntax verification after modifying code.
- Test preview pages for uncaught runtime errors or blank page renderings using Playwright browser check.
- Keep file diffs minimal and preserve unrelated comments and existing code structures.`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      for (const ki of defaultKIs) {
        await saveKnowledgeItem(workspace, ki);
        items.push(ki);
      }
    }

    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.error('Failed to list knowledge items:', err);
    return [];
  }
}

export async function getKnowledgeItem(workspace: string, id: string): Promise<KnowledgeItem | null> {
  const dir = getKnowledgeDir(workspace);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const filePath = path.join(dir, `${id}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as KnowledgeItem;
  } catch {
    return null;
  }
}

export async function saveKnowledgeItem(
  workspace: string,
  data: Partial<KnowledgeItem> & { title: string; summary: string; content: string }
): Promise<KnowledgeItem> {
  const dir = getKnowledgeDir(workspace);
  await fs.mkdir(dir, { recursive: true });

  const id = data.id || `ki_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  assertSafeId(id);
  const now = Date.now();

  const existing = await getKnowledgeItem(workspace, id);
  const item: KnowledgeItem = {
    id,
    title: data.title,
    summary: data.summary,
    tags: Array.isArray(data.tags) ? data.tags : ['general'],
    content: data.content,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(item, null, 2), 'utf-8');
  return item;
}

export async function deleteKnowledgeItem(workspace: string, id: string): Promise<boolean> {
  const dir = getKnowledgeDir(workspace);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return false;
  const filePath = path.join(dir, `${id}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export function formatKnowledgeForPrompt(items: KnowledgeItem[]): string {
  if (!items || items.length === 0) return '';

  const formatted = items
    .map(
      (ki) =>
        `### [KI: ${ki.title}] (Tags: ${ki.tags.join(', ')})
**Summary**: ${ki.summary}
${ki.content}`
    )
    .join('\n\n');

  return `## Knowledge Items (KI) Memory System
Curated, localized context about this specific repository to help you avoid redundant work and adhere to established patterns:

${formatted}`;
}
