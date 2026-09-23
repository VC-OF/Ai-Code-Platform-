import { NextRequest, NextResponse } from "next/server";
import { getClients, saveClients } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const clients = getClients();
  const idx = clients.findIndex((c) => c.id === params.id);
  if (idx === -1)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  clients[idx] = { ...clients[idx], ...body, id: clients[idx].id };
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
