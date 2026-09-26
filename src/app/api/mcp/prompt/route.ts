import { NextRequest, NextResponse } from "next/server";
import { getMcpPrompt } from "@/lib/mcpClient";
import { mcpWorkspaceFor } from "../workspace";

export const runtime = "nodejs";

/**
 * POST { projectId?, server, name, arguments? } → { text }
 * Runs prompts/get on an MCP server and flattens the returned messages to
 * plain text, which the chat sends as the user's message.
 */
export async function POST(req: NextRequest) {
  let body: { projectId?: string; server?: unknown; name?: unknown; arguments?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.server !== "string" || !body.server || typeof body.name !== "string" || !body.name) {
    return NextResponse.json({ error: "server and name are required" }, { status: 400 });
  }
  const args: Record<string, string> = {};
  if (body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)) {
    for (const [k, v] of Object.entries(body.arguments as Record<string, unknown>)) {
      if (v !== undefined && v !== null) args[k] = String(v);
    }
  }
  try {
    const text = await getMcpPrompt(body.server, body.name, args, mcpWorkspaceFor(body.projectId));
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
