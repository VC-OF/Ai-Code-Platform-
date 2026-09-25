import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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

const GLOBAL_SKILL_ROOTS = [
  path.join(process.cwd(), 'skills'),
  path.join(os.homedir(), '.gemini', 'antigravity-ide', 'builtin', 'skills'),
  path.join(os.homedir(), '.gemini', 'config', 'skills'),
];

const MAX_SKILLS = 32;
const MAX_SKILL_CHARS = 12_000;

export interface LoadSkillsOptions {
  includeGlobal?: boolean;
}

/** Load project-local skills and open-source Google Antigravity global skills
 * without allowing a missing or malformed skill to prevent the agent from starting.
 * Project skills take precedence over global skills with the same name. */
export async function loadSkills(
  workspaceRoot: string,
  options?: LoadSkillsOptions
): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];
  const seenNames = new Set<string>();

  // 1. Scan workspace-local skill directories first
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
        if (parsed && !seenNames.has(parsed.name.toLowerCase())) {
          seenNames.add(parsed.name.toLowerCase());
          skills.push(parsed);
        }
      } catch {
        // A broken optional skill should not block the coding agent.
      }
    }
  }

  // 2. Scan global / open-source Google Antigravity skills if requested or running in application mode
  const shouldIncludeGlobal =
    options?.includeGlobal ?? (process.env.NODE_ENV !== 'test');

  if (shouldIncludeGlobal && skills.length < MAX_SKILLS) {
    for (const globalRoot of GLOBAL_SKILL_ROOTS) {
      if (skills.length >= MAX_SKILLS) break;
      let entries: { name: string; isDirectory(): boolean }[];
      try {
        entries = await fs.readdir(globalRoot, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || skills.length >= MAX_SKILLS) continue;
        const sourcePath = path.join(globalRoot, entry.name, 'SKILL.md');
        try {
          const raw = await fs.readFile(sourcePath, 'utf8');
          const parsed = parseSkill(raw, entry.name, `global:${entry.name}`);
          if (parsed && !seenNames.has(parsed.name.toLowerCase())) {
            seenNames.add(parsed.name.toLowerCase());
            skills.push(parsed);
          }
        } catch {
          // Ignore missing or unreadable skills
        }
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

export const LOAD_SKILL_HINT =
  'When a task matches a skill, call load_skill with its name to get the full instructions before starting.';

/** One listing line for a skill (name + one-line description). This is all the
 * model sees until it calls load_skill — full instructions load on demand. */
export function formatSkillListing(skill: SkillDefinition): string {
  const oneLine = skill.description.replace(/\s+/g, ' ').trim().slice(0, 240);
  return `- ${skill.name}: ${oneLine}`;
}

export function formatSkillsForPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';
  return [
    '## Skills',
    `${LOAD_SKILL_HINT} Do not apply a skill that does not match the task.`,
    '',
    ...skills.map(formatSkillListing),
  ].join('\n');
}

/** Whether a skill came from the project workspace or a global root. */
export function skillGroup(skill: SkillDefinition): 'project' | 'global' {
  return skill.source.startsWith('global:') ? 'global' : 'project';
}

/** Case-insensitive lookup used by the load_skill tool. */
export function findSkill(skills: SkillDefinition[], name: string): SkillDefinition | undefined {
  const needle = name.trim().toLowerCase();
  return skills.find((s) => s.name.toLowerCase() === needle);
}
