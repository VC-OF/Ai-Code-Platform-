import { NextRequest, NextResponse } from "next/server";
import { generateId, getClients, saveClients } from "@/lib/db";
import { Client } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getClients());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !body.email) {
    return NextResponse.json(
      { error: "Name and email are required" },
      { status: 400 }
    );
  }
  const client: Client = {
    id: generateId(),
    name: String(body.name).trim(),
    email: String(body.email).trim(),
    company: body.company?.trim() || "",
    phone: body.phone?.trim() || "",
    address: body.address?.trim() || "",
    createdAt: new Date().toISOString(),
  };
  const clients = getClients();
  clients.push(client);
  saveClients(clients);
  return NextResponse.json(client, { status: 201 });
}
