import fs from 'fs/promises';
import path from 'path';

export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  source: string;
}

const SKILL_ROOTS = [
  '.opencode/skills',
  '.agents/skills',
  'skills',
] as const;
const MAX_SKILLS = 16;
const MAX_SKILL_CHARS = 12_000;

/** Load project-local skills without allowing a missing or malformed skill to
 * prevent the agent from starting. Project skills are intentionally explicit:
 * each skill lives in a directory containing SKILL.md. */
export async function loadSkills(workspaceRoot: string): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];

  for (const root of SKILL_ROOTS) {
    if (skills.length >= MAX_SKILLS) break;
    const rootPath = path.join(workspaceRoot, root);
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = await fs.readdir(rootPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || skills.length >= MAX_SKILLS) continue;
      const source = path.join(root, entry.name, 'SKILL.md');
      try {
        const raw = await fs.readFile(path.join(workspaceRoot, source), 'utf8');
        const parsed = parseSkill(raw, entry.name, source);
        if (parsed) skills.push(parsed);
      } catch {
        // A broken optional skill should not block the coding agent.
      }
    }
  }

  return skills;
}

function parseSkill(raw: string, fallbackName: string, source: string): SkillDefinition | null {
  const frontmatter = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  const metadata = new Map<string, string>();
  if (frontmatter) {
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = line.match(/^([\w-]+):\s*["']?(.+?)["']?\s*$/);
      if (match) metadata.set(match[1], match[2]);
    }
  }

  const instructions = raw
    .slice(frontmatter?.[0].length ?? 0)
    .trim()
    .slice(0, MAX_SKILL_CHARS);
  if (!instructions) return null;

  return {
    name: metadata.get('name') || fallbackName,
    description: metadata.get('description') || `Project skill: ${fallbackName}`,
    instructions,
    source,
  };
}

export function formatSkillsForPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';
  return [
    '## Project Skills',
    'The following optional skills are available. Apply a skill when it matches the task; do not invent requirements from unrelated skills.',
    ...skills.map((skill) => `\n### ${skill.name}\n${skill.description}\nSource: ${skill.source}\n\n${skill.instructions}`),
  ].join('\n');
}
