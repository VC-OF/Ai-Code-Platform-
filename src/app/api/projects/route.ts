import { NextRequest, NextResponse } from "next/server";
import { getProjects, createProject, createBuildModeProject, deleteProject } from "@/lib/projects";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const { getProject } = await import("@/lib/projects");
      const project = await getProject(id);
      return NextResponse.json({ project });
    }

    const projects = await getProjects();
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

    if (body.mode === "build") {
      try {
        const project = await createBuildModeProject(body.path, body.title);
        return NextResponse.json({ project });
      } catch (error) {
        // Bad/forbidden path is a client error, not a server fault
        return NextResponse.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 400 }
        );
      }
    }

    const project = await createProject(body.title, body.template);
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
