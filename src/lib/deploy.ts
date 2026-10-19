import crossSpawn from "cross-spawn";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDecryptedEnv } from "./settingsStore";

const execFileAsync = promisify(execFile);

/**
 * Cloud deployments and repository sync:
 * - Vercel (npx vercel deploy --prod)
 * - Netlify (npx netlify deploy --prod)
 * - Cloudflare Pages (npx wrangler pages deploy)
 * - GitHub (1-click repository creation and push)
 */

const DEPLOY_TIMEOUT_MS = 4 * 60_000;

export async function resolveVercelToken(projectId: string): Promise<string | undefined> {
  const secrets = await getDecryptedEnv(projectId);
  return secrets.VERCEL_TOKEN || process.env.VERCEL_TOKEN || undefined;
}

export async function resolveNetlifyToken(projectId: string): Promise<string | undefined> {
  const secrets = await getDecryptedEnv(projectId);
  return secrets.NETLIFY_AUTH_TOKEN || secrets.NETLIFY_TOKEN || process.env.NETLIFY_AUTH_TOKEN || undefined;
}

export async function resolveCloudflareToken(projectId: string): Promise<string | undefined> {
  const secrets = await getDecryptedEnv(projectId);
  return secrets.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || undefined;
}

export async function resolveGitHubToken(projectId: string): Promise<string | undefined> {
  const secrets = await getDecryptedEnv(projectId);
  return secrets.GITHUB_TOKEN || process.env.GITHUB_TOKEN || undefined;
}

export interface DeployResult {
  url: string | null;
  output: string;
}

function runSpawn(cmd: string, args: string[], cwd: string, env: Record<string, string | undefined>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = crossSpawn(cmd, args, { cwd, env: { ...process.env, ...env } });

    const timer = setTimeout(() => {
      if (process.platform === "win32" && proc.pid) {
        execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], () => {});
      } else {
        try { proc.kill("SIGTERM"); } catch {}
      }
      reject(new Error("Deploy operation timed out after 4 minutes"));
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
  });
}

export async function deployToVercel(projectId: string, root: string): Promise<DeployResult> {
  const token = await resolveVercelToken(projectId);
  if (!token) {
    throw new Error(
      "No VERCEL_TOKEN configured. Add it in Settings → Environment Variables."
    );
  }

  const args = [
    "--yes", "vercel",
    "deploy",
    "--prod",
    "--yes",
    "--name", `open-code-${projectId}`.toLowerCase().slice(0, 52),
  ];

  const result = await runSpawn("npx", args, root, { VERCEL_TOKEN: token });
  const urlMatch = (result.stdout + "\n" + result.stderr).match(
    /https:\/\/[a-z0-9-]+\.vercel\.app/i
  );

  if (result.code !== 0 && !urlMatch) {
    throw new Error(`Vercel deploy failed: ${(result.stderr || result.stdout).slice(-1500)}`);
  }

  return {
    url: urlMatch?.[0] ?? null,
    output: result.stderr.slice(-2000),
  };
}

export async function deployToNetlify(projectId: string, root: string): Promise<DeployResult> {
  const token = await resolveNetlifyToken(projectId);
  if (!token) {
    throw new Error(
      "No NETLIFY_AUTH_TOKEN configured. Add it in Settings → Environment Variables."
    );
  }

  const args = [
    "--yes", "netlify-cli",
    "deploy",
    "--prod",
    "--dir=.",
  ];

  const result = await runSpawn("npx", args, root, { NETLIFY_AUTH_TOKEN: token });
  const urlMatch = (result.stdout + "\n" + result.stderr).match(
    /https:\/\/[a-z0-9-]+\.netlify\.app/i
  );

  if (result.code !== 0 && !urlMatch) {
    throw new Error(`Netlify deploy failed: ${(result.stderr || result.stdout).slice(-1500)}`);
  }

  return {
    url: urlMatch?.[0] ?? null,
    output: (result.stdout + "\n" + result.stderr).slice(-2000),
  };
}

export async function deployToCloudflare(projectId: string, root: string): Promise<DeployResult> {
  const token = await resolveCloudflareToken(projectId);
  if (!token) {
    throw new Error(
      "No CLOUDFLARE_API_TOKEN configured. Add it in Settings → Environment Variables."
    );
  }

  const projectName = `opencode-${projectId}`.toLowerCase().slice(0, 32);
  const args = [
    "--yes", "wrangler",
    "pages", "deploy", ".",
    "--project-name", projectName,
  ];

  const result = await runSpawn("npx", args, root, { CLOUDFLARE_API_TOKEN: token });
  const urlMatch = (result.stdout + "\n" + result.stderr).match(
    /https:\/\/[a-z0-9-]+\.pages\.dev/i
  );

  if (result.code !== 0 && !urlMatch) {
    throw new Error(`Cloudflare Pages deploy failed: ${(result.stderr || result.stdout).slice(-1500)}`);
  }

  return {
    url: urlMatch?.[0] ?? null,
    output: (result.stdout + "\n" + result.stderr).slice(-2000),
  };
}

export async function pushToGitHub(
  projectId: string,
  root: string,
  options?: { repoName?: string; isPrivate?: boolean }
): Promise<DeployResult> {
  const token = await resolveGitHubToken(projectId);
  if (!token) {
    throw new Error(
      "No GITHUB_TOKEN configured. Create a token with 'repo' scope at github.com/settings/tokens and add it in Settings → Environment Variables."
    );
  }

  // 1. Get authenticated user
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "OpenCode-Platform",
    },
  });

  if (!userRes.ok) {
    throw new Error(`GitHub auth failed: ${userRes.statusText}`);
  }

  const user = (await userRes.json()) as { login: string };
  const rawName = options?.repoName || `app-${projectId}`;
  const repoName = rawName.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();

  // 2. Check if repo already exists or create it
  const checkRes = await fetch(`https://api.github.com/repos/${user.login}/${repoName}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "OpenCode-Platform",
    },
  });

  if (checkRes.status === 404) {
    const createRes = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "OpenCode-Platform",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: repoName,
        private: !!options?.isPrivate,
        description: "Created with Open Code Platform",
        auto_init: false,
      }),
    });

    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      throw new Error(`Failed to create GitHub repo: ${errData.message || createRes.statusText}`);
    }
  }

  // 3. Configure git remote and push
  const remoteUrl = `https://x-access-token:${token}@github.com/${user.login}/${repoName}.git`;
  const cleanPublicUrl = `https://github.com/${user.login}/${repoName}`;

  try {
    await execFileAsync("git", ["remote", "remove", "origin"], { cwd: root }).catch(() => {});
    await execFileAsync("git", ["remote", "add", "origin", remoteUrl], { cwd: root });

    // Commit any untracked or staged work before pushing
    await execFileAsync("git", ["add", "-A"], { cwd: root });
    await execFileAsync(
      "git",
      [
        "-c", "user.name=Open Code",
        "-c", "user.email=agent@opencode.local",
        "commit", "-m", "Updates from Open Code Platform",
        "--allow-empty",
      ],
      { cwd: root }
    ).catch(() => {});

    // Determine current branch
    const { stdout: branchOut } = await execFileAsync("git", ["branch", "--show-current"], { cwd: root });
    const branch = branchOut.trim() || "main";

    await execFileAsync("git", ["push", "-u", "origin", branch], { cwd: root });

    return {
      url: cleanPublicUrl,
      output: `Successfully created and pushed repository to ${cleanPublicUrl} (branch: ${branch})`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Git push failed: ${msg}`);
  }
}
