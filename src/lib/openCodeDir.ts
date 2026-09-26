import fs from "fs/promises";
import path from "path";

/**
 * `<workspace>/.open-code/` holds platform-generated artefacts that are not
 * part of the user's project: browser screenshots, execute_code scratch
 * runs and their figures, matplotlib config. It is kept out of git (via the
 * project's own .gitignore when one exists) and out of agent checkpoints
 * (see CHECKPOINT_EXCLUDES in agentLoop.ts).
 */
export const OPEN_CODE_DIR = ".open-code";

/** Add .open-code/ to an existing .gitignore; never create one. */
export async function ensureOpenCodeIgnored(workspace: string): Promise<void> {
  const gi = path.join(workspace, ".gitignore");
  try {
    const cur = await fs.readFile(gi, "utf8");
    if (/^\/?\.open-code\/?\s*$/m.test(cur)) return;
    await fs.appendFile(gi, `${cur.endsWith("\n") || cur === "" ? "" : "\n"}${OPEN_CODE_DIR}/\n`);
  } catch {
    // no .gitignore — leave it alone
  }
}

/** Workspace-relative path (forward slashes) of a file under .open-code/. */
export function openCodePath(...segments: string[]): string {
  return [OPEN_CODE_DIR, ...segments].join("/");
}
