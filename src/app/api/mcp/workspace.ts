import { projectDb } from "@/lib/db";
import { getWorkspaceRoot } from "@/lib/workspace";

/** Workspace whose `.mcp.json` applies to a request (none without a project). */
export function mcpWorkspaceFor(projectId: string | null | undefined): string | undefined {
  if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) return undefined;
  try {
    const row = projectDb.getById(projectId);
    if (row?.workspace) return row.workspace;
  } catch {}
  return getWorkspaceRoot(projectId);
}
