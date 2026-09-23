import { NextRequest, NextResponse } from "next/server";
import {
  generateId,
  getClients,
  getInvoices,
  getSettings,
  saveInvoices,
} from "@/lib/db";
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

export async function GET() {
  const invoices = getInvoices().sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
  return NextResponse.json(invoices);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const settings = getSettings();
  const clients = getClients();
  const client = clients.find((c) => c.id === body.clientId);
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 400 });
  }

  const items: LineItem[] = (body.items || []).map((it: any) => ({
    id: it.id || generateId(),
    description: String(it.description || "").trim(),
    quantity: Number(it.quantity) || 0,
    unitPrice: Number(it.unitPrice) || 0,
  }));

  const taxRate = body.taxRate ?? settings.taxRate;
  const totals = recalc(items, taxRate);
  const now = new Date().toISOString();
  const number = `${settings.invoicePrefix}-${settings.nextInvoiceNumber}`;

  const invoice: Invoice = {
    id: generateId(),
    number,
    clientId: client.id,
    clientName: client.name,
    clientEmail: client.email,
    clientAddress: client.address,
    issueDate: body.issueDate || now.slice(0, 10),
    dueDate:
      body.dueDate ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
    status: body.status || "draft",
    items,
    notes: body.notes || "",
    taxRate,
    ...totals,
    createdAt: now,
    updatedAt: now,
  };

  const invoices = getInvoices();
  invoices.push(invoice);
  saveInvoices(invoices);

  // bump next invoice number
  settings.nextInvoiceNumber += 1;
  const { saveSettings } = await import("@/lib/db");
  saveSettings(settings);

  return NextResponse.json(invoice, { status: 201 });
}
