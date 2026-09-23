import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatJPY, formatJPDate } from "@/lib/calc";

export const dynamic = "force-dynamic";

async function getStats() {
  const [invoices, customers, products, company] = await Promise.all([
    prisma.invoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { customer: true },
    }),
    prisma.customer.count(),
    prisma.product.count(),
    prisma.company.findFirst(),
  ]);

  const all = await prisma.invoice.findMany({
    where: { status: { not: "void" } },
  });
  const totalIssued = all.reduce((s, i) => s + i.total, 0);
  const totalPaid = all
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.total, 0);
  const totalUnpaid = all
    .filter((i) => i.status === "issued")
    .reduce((s, i) => s + i.total, 0);

  return {
    invoices,
    customers,
    products,
    company,
    totalIssued,
    totalPaid,
    totalUnpaid,
  };
}

function statusBadge(s: string) {
  switch (s) {
    case "paid":
      return <span className="badge badge-green">支払済</span>;
    case "issued":
      return <span className="badge badge-blue">発行済</span>;
    case "void":
      return <span className="badge badge-red">無効</span>;
    default:
      return <span className="badge badge-gray">下書き</span>;
  }
}

export default async function DashboardPage() {
  const {
    invoices,
    customers,
    products,
    company,
    totalIssued,
    totalPaid,
    totalUnpaid,
  } = await getStats();

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="mb-8 flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">ダッシュボード</h1>
          <p className="text-ink-500 text-sm mt-1">
            {company?.name ?? "Ideal Folks"} — 適格請求書発行事業者
            {company?.registrationNo && (
              <span className="ml-2 font-mono text-xs">
                {company.registrationNo}
              </span>
            )}
          </p>
        </div>
        <Link href="/invoices/new" className="btn btn-primary">
          + 新規請求書
        </Link>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="card p-5">
          <div className="text-xs text-ink-500">発行総額（累計）</div>
          <div className="text-2xl font-semibold mt-1">
            {formatJPY(totalIssued)}
          </div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-ink-500">入金済</div>
          <div className="text-2xl font-semibold mt-1 text-emerald-700">
            {formatJPY(totalPaid)}
          </div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-ink-500">未回収</div>
          <div className="text-2xl font-semibold mt-1 text-amber-700">
            {formatJPY(totalUnpaid)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="card p-5">
          <div className="text-xs text-ink-500">登録顧客数</div>
          <div className="text-xl font-semibold mt-1">
            {customers}{" "}
            <span className="text-sm font-normal text-ink-500">社</span>
          </div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-ink-500">品目マスタ</div>
          <div className="text-xl font-semibold mt-1">
            {products}{" "}
            <span className="text-sm font-normal text-ink-500">件</span>
          </div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-ink-500">次の請求書番号</div>
          <div className="text-xl font-semibold mt-1 font-mono">
            {company?.invoicePrefix}-{new Date().getFullYear()}-
            {String(company?.nextInvoiceSeq ?? 1).padStart(4, "0")}
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-ink-100">
          <h2 className="font-semibold">最近の請求書</h2>
          <Link
            href="/invoices"
            className="text-sm text-ink-500 hover:text-ink-900"
          >
            すべて表示 →
          </Link>
        </div>
        {invoices.length === 0 ? (
          <div className="p-10 text-center text-ink-500 text-sm">
            まだ請求書がありません。
            <Link href="/invoices/new" className="underline">
              最初の請求書を作成
            </Link>
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>番号</th>
                <th>宛名</th>
                <th>発行日</th>
                <th className="text-right">合計</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-mono text-xs">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="hover:underline"
                    >
                      {inv.number}
                    </Link>
                  </td>
                  <td>
                    {inv.customer.name} {inv.customer.honorific}
                  </td>
                  <td className="text-ink-500">
                    {formatJPDate(inv.issueDate)}
                  </td>
                  <td className="text-right font-medium">
                    {formatJPY(inv.total)}
                  </td>
                  <td>{statusBadge(inv.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
