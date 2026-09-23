import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { orderBy: { position: "asc" } } /* relations */,
    },
  });
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const company = await prisma.company.findFirst();
  if (!company)
    return NextResponse.json(
      { error: "Company not configured" },
      { status: 500 }
    );

  return NextResponse.json({
    number: inv.number,
    subject: inv.subject,
    issueDate: inv.issueDate.toISOString(),
    dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
    status: inv.status,
    remarks: inv.remarks,
    company: {
      name: company.name,
      logoText: company.logoText,
      registrationNo: company.registrationNo,
      postalCode: company.postalCode,
      address: company.address,
      tel: company.tel,
      email: company.email,
      bankInfo: company.bankInfo,
      taxNote: company.taxNote,
    },
    customer: {
      name: inv.customer.name,
      honorific: inv.customer.honorific,
      registrationNo: inv.customer.registrationNo,
      postalCode: inv.customer.postalCode,
      address: inv.customer.address,
    },
    items: inv.items.map((it) => ({
      name: it.name,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      taxRate: it.taxRate,
      lineTotal: it.lineTotal,
    })),
    totals: {
      subtotal10: inv.subtotal10,
      tax10: inv.tax10,
      subtotal8: inv.subtotal8,
      tax8: inv.tax8,
      subtotal0: inv.subtotal0,
      total: inv.total,
      withholding: inv.withholding,
    },
  });
}
