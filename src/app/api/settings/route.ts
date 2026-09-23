import { NextRequest, NextResponse } from "next/server";
import {
  listEnvVarsMasked,
  setEnvVar,
  deleteEnvVar,
} from "@/lib/settingsStore";

/**
 * Settings API: only ever returns masked values to the browser.
 * Raw decrypted secrets never leave the server (see settingsStore.ts /
 * previewManager.ts for the only places they're decrypted, always right
 * before injecting into a sandboxed process env).
 *
 * Vars are per-project when a projectId is supplied; global otherwise.
 */

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const vars = await listEnvVarsMasked(projectId);
  return NextResponse.json({ vars });
}

export async function POST(req: NextRequest) {
  const { key, value, projectId } = await req.json();
  if (!key || typeof value !== "string") {
    return NextResponse.json(
      { error: "key and value are required" },
      { status: 400 }
    );
  }
  try {
    await setEnvVar(key, value, projectId || undefined);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { key, projectId } = await req.json();
  await deleteEnvVar(key, projectId || undefined);
  return NextResponse.json({ success: true });
}
