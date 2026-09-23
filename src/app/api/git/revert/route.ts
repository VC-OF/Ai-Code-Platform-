import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getWorkspaceRoot, ensureWorkspace } from "@/lib/workspace";
import { checkpointDb, messageDb } from "@/lib/db";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = body.projectId || "default";
    const sha = body.sha;

    if (!sha) {
      return NextResponse.json(
        { error: "Missing sha parameter" },
        { status: 400 }
      );
    }
    if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
      return NextResponse.json(
        { error: "Invalid sha format" },
        { status: 400 }
      );
    }

    await ensureWorkspace(projectId);
    const root = getWorkspaceRoot(projectId);

    // Reset hard to checkpoint sha
    await execFileAsync("git", ["reset", "--hard", sha], { cwd: root });

    // Rewind chat history alongside the files so the agent's memory stays
    // in sync with the restored workspace state
    let messagesRewound = 0;
    const checkpoint = checkpointDb.getBySha(sha, projectId);
    if (checkpoint?.keep_messages_through_turn != null) {
      messagesRewound = messageDb.deleteAfterTurn(
        projectId,
        checkpoint.keep_messages_through_turn
      );
    }

    return NextResponse.json({ success: true, messagesRewound });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
