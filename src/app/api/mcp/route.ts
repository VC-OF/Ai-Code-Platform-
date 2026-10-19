import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getMcpStatus, loadMcpConfig, pendingProjectMcpServers } from "@/lib/mcpClient";
import { mcpWorkspaceFor } from "./workspace";

export const runtime = "nodejs";

function platformConfigPath(): string {
  return process.env.MCP_CONFIG_PATH || path.join(process.cwd(), ".platform", "mcp.json");
}

/**
 * Status of configured MCP servers (platform config + project's .mcp.json)
 */
export async function GET(req: NextRequest) {
  try {
    const workspace = mcpWorkspaceFor(req.nextUrl.searchParams.get("projectId"));
    const config = await loadMcpConfig(workspace);
    const servers = await getMcpStatus(workspace);
    return NextResponse.json({
      configured: Object.keys(config).length,
      configPath: process.env.MCP_CONFIG_PATH || ".platform/mcp.json",
      projectConfigPath: workspace ? ".mcp.json" : undefined,
      servers,
      pendingProjectServers: workspace ? await pendingProjectMcpServers(workspace).catch(() => []) : [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Register or update an external MCP server in platform or project config
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { name, server, scope = "platform", projectId } = body;

    if (!name || !name.trim() || !server) {
      return NextResponse.json(
        { error: "Server name and configuration object are required" },
        { status: 400 }
      );
    }

    const cleanName = name.trim();
    if (cleanName.includes("_")) {
      return NextResponse.json(
        { error: "Server name may not contain underscores" },
        { status: 400 }
      );
    }

    if (scope === "project") {
      const workspace = mcpWorkspaceFor(projectId);
      if (!workspace) {
        return NextResponse.json({ error: "Invalid projectId for project scope" }, { status: 400 });
      }
      const mcpJsonPath = path.join(workspace, ".mcp.json");
      let data: { mcpServers?: Record<string, unknown> } = {};
      try {
        const raw = await fs.readFile(mcpJsonPath, "utf-8");
        data = JSON.parse(raw);
      } catch {}
      data.mcpServers = data.mcpServers || {};
      data.mcpServers[cleanName] = server;
      await fs.writeFile(mcpJsonPath, JSON.stringify(data, null, 2), "utf-8");
    } else {
      const cfgPath = platformConfigPath();
      await fs.mkdir(path.dirname(cfgPath), { recursive: true });
      let data: { servers?: Record<string, unknown> } = {};
      try {
        const raw = await fs.readFile(cfgPath, "utf-8");
        data = JSON.parse(raw);
      } catch {}
      data.servers = data.servers || {};
      data.servers[cleanName] = server;
      await fs.writeFile(cfgPath, JSON.stringify(data, null, 2), "utf-8");
    }

    return NextResponse.json({ success: true, name: cleanName });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Remove an MCP server from configuration
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");
    const scope = searchParams.get("scope") || "platform";
    const projectId = searchParams.get("projectId");

    if (!name) {
      return NextResponse.json({ error: "Missing server name" }, { status: 400 });
    }

    if (scope === "project") {
      const workspace = mcpWorkspaceFor(projectId);
      if (!workspace) {
        return NextResponse.json({ error: "Invalid projectId for project scope" }, { status: 400 });
      }
      const mcpJsonPath = path.join(workspace, ".mcp.json");
      try {
        const raw = await fs.readFile(mcpJsonPath, "utf-8");
        const data = JSON.parse(raw);
        if (data.mcpServers && data.mcpServers[name]) {
          delete data.mcpServers[name];
          await fs.writeFile(mcpJsonPath, JSON.stringify(data, null, 2), "utf-8");
        }
      } catch {}
    } else {
      const cfgPath = platformConfigPath();
      try {
        const raw = await fs.readFile(cfgPath, "utf-8");
        const data = JSON.parse(raw);
        if (data.servers && data.servers[name]) {
          delete data.servers[name];
          await fs.writeFile(cfgPath, JSON.stringify(data, null, 2), "utf-8");
        }
      } catch {}
    }

    return NextResponse.json({ success: true, name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
