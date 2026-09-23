import { NextRequest, NextResponse } from "next/server";
import { getInvoices, saveInvoices, generateId } from "@/lib/db";
import { Invoice, LineItem } from "@/lib/types";

export const dynamic = "force-dynamic";

function recalc(items: LineItem[], taxRate: number) {
  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
    0
  );
  const taxAmount = +(subtotal * (taxRate / 100)).toFixed(2);
  const total = +(subtotal + taxAmount).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), taxAmount, total };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const invoice = getInvoices().find((i) => i.id === params.id);
  if (!invoice)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const invoices = getInvoices();
  const idx = invoices.findIndex((i) => i.id === params.id);
  if (idx === -1)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = invoices[idx];
  const items: LineItem[] = (body.items || existing.items).map((it: any) => ({
    id: it.id || generateId(),
    description: String(it.description || "").trim(),
    quantity: Number(it.quantity) || 0,
    unitPrice: Number(it.unitPrice) || 0,
  }));
  const taxRate = body.taxRate ?? existing.taxRate;
  const totals = recalc(items, taxRate);

  const updated: Invoice = {
    ...existing,
    clientId: body.clientId ?? existing.clientId,
    clientName: body.clientName ?? existing.clientName,
    clientEmail: body.clientEmail ?? existing.clientEmail,
    clientAddress: body.clientAddress ?? existing.clientAddress,
    issueDate: body.issueDate ?? existing.issueDate,
    dueDate: body.dueDate ?? existing.dueDate,
    status: body.status ?? existing.status,
    notes: body.notes ?? existing.notes,
    items,
    taxRate,
    ...totals,
    updatedAt: new Date().toISOString(),
  };

  invoices[idx] = updated;
  saveInvoices(invoices);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const invoices = getInvoices();
  const filtered = invoices.filter((i) => i.id !== params.id);
  if (filtered.length === invoices.length)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  saveInvoices(filtered);
  return NextResponse.json({ ok: true });
}
