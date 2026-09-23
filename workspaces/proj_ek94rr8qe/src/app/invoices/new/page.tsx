import { prisma } from "@/lib/prisma";
import InvoiceForm from "./InvoiceForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const [customers, products, company] = await Promise.all([
    prisma.customer.findMany({ orderBy: { name: "asc" } }),
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    prisma.company.findFirst(),
  ]);

  if (customers.length === 0) {
    return (
      <div className="p-6 md:p-10 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">新規請求書</h1>
        <div className="card p-6 text-center">
          <p className="text-ink-500 mb-4">先に顧客を登録してください。</p>
          <Link href="/customers" className="btn btn-primary">
            顧客管理へ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="mb-6">
        <div className="text-xs text-ink-500 mb-1">
          <Link href="/invoices" className="hover:underline">
            請求書一覧
          </Link>{" "}
          / 新規
        </div>
        <h1 className="text-2xl font-semibold">新規請求書</h1>
        <p className="text-ink-500 text-sm mt-1">
          適格請求書（インボイス）として発行 — {company?.name}
        </p>
      </header>
      <InvoiceForm
        customers={customers.map((c) => ({
          id: c.id,
          name: c.name,
          honorific: c.honorific,
        }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          unitPrice: p.unitPrice,
          taxRate: p.taxRate,
          unit: p.unit,
        }))}
        defaultTaxRate={company?.defaultTaxRate ?? 10}
      />
    </div>
  );
}
