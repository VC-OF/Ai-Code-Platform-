import { NextRequest, NextResponse } from "next/server";
import { getMcpStatus, loadMcpConfig, pendingProjectMcpServers } from "@/lib/mcpClient";
import { mcpWorkspaceFor } from "./workspace";

export const runtime = "nodejs";

/** Status of configured MCP servers (platform config + the project's
 *  .mcp.json) for the settings UI, /mcp and prompt slash commands. */
export async function GET(req: NextRequest) {
  const workspace = mcpWorkspaceFor(req.nextUrl.searchParams.get("projectId"));
  const config = await loadMcpConfig(workspace);
  const servers = await getMcpStatus(workspace);
  return NextResponse.json({
    configured: Object.keys(config).length,
    configPath: process.env.MCP_CONFIG_PATH || ".platform/mcp.json",
    projectConfigPath: workspace ? ".mcp.json" : undefined,
    servers,
    // .mcp.json servers that are not approved yet (enabledMcpjsonServers)
    pendingProjectServers: workspace ? await pendingProjectMcpServers(workspace).catch(() => []) : [],
  });
}
