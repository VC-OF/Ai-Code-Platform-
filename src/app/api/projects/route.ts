import { NextRequest, NextResponse } from "next/server";
import { getProjects, createProject, createBuildModeProject, deleteProject } from "@/lib/projects";
import { ensureSchedulerStarted } from "@/lib/scheduler";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  // The UI lists projects on load — a cheap place to start the cron runner
  ensureSchedulerStarted();
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const { getProject } = await import("@/lib/projects");
      const project = await getProject(id);
      return NextResponse.json({ project });
    }

    const user = await getCurrentUser(req);
    const projects = await getProjects(user?.id);
    // sort by updatedAt descending
    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const user = await getCurrentUser(req);

    if (body.mode === "build") {
      try {
        const project = await createBuildModeProject(body.path, body.title, user?.id);
        return NextResponse.json({ project });
      } catch (error) {
        // Bad/forbidden path is a client error, not a server fault
        return NextResponse.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 400 }
        );
      }
    }

    const project = await createProject(body.title, body.template, user?.id);
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const success = await deleteProject(id);
    return NextResponse.json({ success });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
