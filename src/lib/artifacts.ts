import fs from 'fs/promises';
import path from 'path';
import { getProject } from './projects';

export interface ArtifactItem {
  id: string;
  title: string;
  type: 'markdown' | 'plan' | 'diagram' | 'diff' | 'report' | 'code';
  description?: string;
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

function getArtifactsDir(workspace: string): string {
  return path.join(workspace, '.artifacts');
}

export async function listArtifacts(workspace: string): Promise<ArtifactItem[]> {
  const dir = getArtifactsDir(workspace);
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const artifacts: ArtifactItem[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), 'utf-8');
        const parsed = JSON.parse(raw) as ArtifactItem;
        artifacts.push(parsed);
      } catch {}
    }

    // If empty, auto-generate a starter project architecture artifact
    if (artifacts.length === 0) {
      const starter: ArtifactItem = {
        id: 'starter_arch_overview',
        title: 'Project Architecture & Standards',
        type: 'report',
        description: 'Core project structure, standards, and verified workflows',
        content: `# Project Architecture & Standards

> [!NOTE]
> This artifact is persistently stored in your project and automatically synchronizes with agent updates.

## Overview
- **Workspace**: Active Open Code repository
- **Framework**: Modern React & Next.js full-stack architecture
- **Design System**: Tailored dark-mode tokens, Monaco in-editor AI, and responsive preview viewports

> [!TIP]
> Use the \`create_artifact\` agent tool or the top navigation bar to create design specs, API contracts, and architecture diagrams.

## Established Workflows
- **Inline Editing**: Press \`Ctrl+I\` / \`Cmd+I\` inside any Monaco code file.
- **Preview Verification**: Run autonomous browser checks via the Preview Audit button.
- **Rollback Checkpoints**: Save and restore Git checkpoint snapshots with multi-file visual diffs.
`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveArtifact(workspace, starter);
      artifacts.push(starter);
    }

    return artifacts.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.error('Failed to list artifacts:', err);
    return [];
  }
}

export async function getArtifact(workspace: string, id: string): Promise<ArtifactItem | null> {
  const dir = getArtifactsDir(workspace);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const filePath = path.join(dir, `${id}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ArtifactItem;
  } catch {
    return null;
  }
}

export async function saveArtifact(
  workspace: string,
  data: Partial<ArtifactItem> & { title: string; content: string }
): Promise<ArtifactItem> {
  const dir = getArtifactsDir(workspace);
  await fs.mkdir(dir, { recursive: true });

  const id = data.id || `art_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  assertSafeId(id);
  const now = Date.now();

  const existing = await getArtifact(workspace, id);
  const artifact: ArtifactItem = {
    id,
    title: data.title,
    type: data.type || 'markdown',
    description: data.description || '',
    content: data.content,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(artifact, null, 2), 'utf-8');
  return artifact;
}

export async function deleteArtifact(workspace: string, id: string): Promise<boolean> {
  const dir = getArtifactsDir(workspace);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return false;
  const filePath = path.join(dir, `${id}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
