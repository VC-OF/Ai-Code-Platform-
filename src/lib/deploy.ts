import crossSpawn from "cross-spawn";
import { execFile } from "child_process";
import { getDecryptedEnv } from "./settingsStore";

/**
 * Vercel deploy, shared by the UI button (/api/deploy) and the agent's
 * deploy_app tool. Token from per-project settings, global settings, or
 * server env. CLI runs via argument arrays — no shell.
 */

const DEPLOY_TIMEOUT_MS = 4 * 60_000;

export async function resolveVercelToken(
  projectId: string
): Promise<string | undefined> {
  const secrets = await getDecryptedEnv(projectId);
  return secrets.VERCEL_TOKEN || process.env.VERCEL_TOKEN || undefined;
}

export interface DeployResult {
  url: string | null;
  output: string;
}

export async function deployToVercel(
  projectId: string,
  root: string
): Promise<DeployResult> {
  const token = await resolveVercelToken(projectId);
  if (!token) {
    throw new Error(
      "No VERCEL_TOKEN configured. Create a token at vercel.com/account/tokens " +
        "and add it as VERCEL_TOKEN in Settings → Environment Variables."
    );
  }

  const args = [
    "--yes", "vercel",
    "deploy",
    "--prod",
    "--yes",
    "--name", `open-code-${projectId}`.toLowerCase().slice(0, 52),
  ];

  const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      let stdout = "";
      let stderr = "";
      // Token goes via env (the Vercel CLI reads VERCEL_TOKEN) so it never
      // appears in the process list / argv.
      const proc = crossSpawn("npx", args, {
        cwd: root,
        env: { ...process.env, VERCEL_TOKEN: token },
      });

      const timer = setTimeout(() => {
        // On Windows npx spawns a tree (cmd -> node -> vercel); kill it all.
        if (process.platform === "win32" && proc.pid) {
          execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], () => {});
        } else {
          try { proc.kill("SIGTERM"); } catch {}
        }
        reject(new Error("Deploy timed out after 4 minutes"));
      }, DEPLOY_TIMEOUT_MS);

      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    }
  );

  // The CLI prints the deployment URL on stdout; progress goes to stderr
  const urlMatch = (result.stdout + "\n" + result.stderr).match(
    /https:\/\/[a-z0-9-]+\.vercel\.app/i
  );

  if (result.code !== 0 && !urlMatch) {
    throw new Error(
      `Deploy failed: ${(result.stderr || result.stdout).slice(-1500)}`
    );
  }

  return {
    url: urlMatch?.[0] ?? null,
    output: result.stderr.slice(-2000),
  };
}
