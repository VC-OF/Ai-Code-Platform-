"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { invoiceSchema } from "@/lib/schemas";
import { computeTotals } from "@/lib/calc";
import { allocateInvoiceNumber } from "@/lib/invoiceNumber";

export async function createInvoiceAction(_: any, formData: FormData) {
  const raw = formData.get("payload");
  if (!raw) return { ok: false, error: "Missing payload" };
  const body = JSON.parse(String(raw));

  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const data = parsed.data;

  // Compute totals server-side from lines (don't trust client).
  const totals = computeTotals(
    data.items.map((it) => ({
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      taxRate: it.taxRate,
    }))
  );

  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });
  if (!customer) return { ok: false, error: "顧客が存在しません" };

  const { number } = await allocateInvoiceNumber();

  const invoice = await prisma.invoice.create({
    data: {
      number,
      customerId: data.customerId,
      issueDate: new Date(data.issueDate),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      subject: data.subject ?? null,
      remarks: data.remarks ?? null,
      status: "issued",
      withholding: data.withholding ?? 0,
      subtotal10: totals.subtotal10,
      subtotal8: totals.subtotal8,
      subtotal0: totals.subtotal0,
      tax10: totals.tax10,
      tax8: totals.tax8,
      total: totals.total,
      items: {
        create: data.items.map((it, idx) => ({
          productId: it.productId || null,
          name: it.name,
          description: it.description ?? null,
          quantity: it.quantity,
          unit: it.unit || "個",
          unitPrice: it.unitPrice,
          taxRate: it.taxRate,
          lineTotal: Math.round(it.quantity * it.unitPrice),
          position: idx,
        })),
      },
    },
  });

  revalidatePath("/invoices");
  revalidatePath("/");
  redirect(`/invoices/${invoice.id}`);
}

export async function updateInvoiceStatusAction(id: string, status: string) {
  await prisma.invoice.update({ where: { id }, data: { status } });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/");
}

export async function deleteInvoiceAction(id: string) {
  await prisma.invoice.delete({ where: { id } });
  revalidatePath("/invoices");
  revalidatePath("/");
  redirect("/invoices");
}
