import { NextResponse } from "next/server";
import { getMcpStatus, loadMcpConfig } from "@/lib/mcpClient";

export const runtime = "nodejs";

/** Status of configured MCP servers for the settings UI. */
export async function GET() {
  const config = await loadMcpConfig();
  const servers = await getMcpStatus();
  return NextResponse.json({
    configured: Object.keys(config).length,
    configPath: process.env.MCP_CONFIG_PATH || ".platform/mcp.json",
    servers,
  });
}
