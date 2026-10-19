import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceRoot, ensureWorkspace } from "@/lib/workspace";
import {
  deployToVercel,
  deployToNetlify,
  deployToCloudflare,
  pushToGitHub,
  resolveVercelToken,
  resolveNetlifyToken,
  resolveCloudflareToken,
  resolveGitHubToken,
} from "@/lib/deploy";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") || "default";

  const vercel = !!(await resolveVercelToken(projectId));
  const netlify = !!(await resolveNetlifyToken(projectId));
  const cloudflare = !!(await resolveCloudflareToken(projectId));
  const github = !!(await resolveGitHubToken(projectId));

  return NextResponse.json({
    configured: vercel || netlify || cloudflare || github,
    providers: {
      vercel,
      netlify,
      cloudflare,
      github,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId = "default",
      target = "vercel",
      repoName,
      isPrivate,
    } = body;

    await ensureWorkspace(projectId);
    const root = getWorkspaceRoot(projectId);

    let result;
    if (target === "netlify") {
      result = await deployToNetlify(projectId, root);
    } else if (target === "cloudflare") {
      result = await deployToCloudflare(projectId, root);
    } else if (target === "github") {
      result = await pushToGitHub(projectId, root, { repoName, isPrivate });
    } else {
      result = await deployToVercel(projectId, root);
    }

    return NextResponse.json({ success: true, target, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isConfigError =
      message.includes("No VERCEL_TOKEN") ||
      message.includes("No NETLIFY_AUTH_TOKEN") ||
      message.includes("No CLOUDFLARE_API_TOKEN") ||
      message.includes("No GITHUB_TOKEN");

    return NextResponse.json({ error: message }, { status: isConfigError ? 400 : 500 });
  }
}
