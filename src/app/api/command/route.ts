import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceRoot, ensureWorkspace } from "@/lib/workspace";
import { getDecryptedEnv } from "@/lib/settingsStore";
import { safeExec, CommandError } from "@/lib/safeExec";

export async function POST(req: NextRequest) {
  try {
    const { command, projectId = "default" } = await req.json();
    await ensureWorkspace(projectId);

    if (!command || !command.trim()) {
      return NextResponse.json(
        { error: "Missing command parameter" },
        { status: 400 }
      );
    }

    const secretEnv = await getDecryptedEnv(projectId);
    const root = getWorkspaceRoot(projectId);

    const result = await safeExec(command, root, {
      env: secretEnv,
      timeoutMs: 60_000,
    });

    return NextResponse.json({
      success: result.code === 0 && !result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.timedOut ? { error: "Command timed out" } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof CommandError) {
      return NextResponse.json(
        { success: false, stdout: "", stderr: "", error: err.message },
        { status: 400 }
      );
    }
    const e = err as { message?: string };
    return NextResponse.json({
      success: false,
      stdout: "",
      stderr: "",
      error: e.message || "Unknown execution error",
    });
  }
}
