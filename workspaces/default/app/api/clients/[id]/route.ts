import { NextRequest, NextResponse } from "next/server";
import { getClients, saveClients } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clients = getClients();
  const client = clients.find((c) => c.id === params.id);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(client);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const clients = getClients();
  const idx = clients.findIndex((c) => c.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (body.name !== undefined && !String(body.name).trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (body.email !== undefined && !String(body.email).trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  clients[idx] = {
    ...clients[idx],
    ...body,
    id: clients[idx].id,
    createdAt: clients[idx].createdAt,
  };
  saveClients(clients);
  return NextResponse.json(clients[idx]);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clients = getClients();
  const filtered = clients.filter((c) => c.id !== params.id);
  if (filtered.length === clients.length)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  saveClients(filtered);
  return NextResponse.json({ ok: true });
}
