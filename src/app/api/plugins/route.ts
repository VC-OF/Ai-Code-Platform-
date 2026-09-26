import { NextRequest, NextResponse } from "next/server";
import { installPlugin, listPlugins, pluginsDir, removePlugin } from "@/lib/plugins";

export const runtime = "nodejs";

/** GET /api/plugins — installed plugins and what each contributes. */
export async function GET() {
  try {
    return NextResponse.json({ plugins: await listPlugins(), dir: pluginsDir() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** POST /api/plugins { source, name? } — install from an https git URL or a local directory. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const source = typeof body.source === "string" ? body.source : "";
  const name = typeof body.name === "string" ? body.name : undefined;
  try {
    const plugin = await installPlugin(source, name);
    return NextResponse.json({ plugin });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

/** DELETE /api/plugins?name=<name> */
export async function DELETE(req: NextRequest) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  try {
    const removed = await removePlugin(name);
    if (!removed) return NextResponse.json({ error: `Plugin '${name}' is not installed` }, { status: 404 });
    return NextResponse.json({ removed: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
