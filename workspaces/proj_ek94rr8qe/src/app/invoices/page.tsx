import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatJPY, formatJPDate } from "@/lib/calc";
import StatusFilter from "./StatusFilter";

export const dynamic = "force-dynamic";

type SP = { status?: string; q?: string };

async function listInvoices(sp: SP) {
  const where: any = {};
  if (sp.status && sp.status !== "all") where.status = sp.status;
  if (sp.q) {
    where.OR = [
      { number: { contains: sp.q } },
      { customer: { name: { contains: sp.q } } },
    ];
  }
  return prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { customer: true },
  });
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

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const invoices = await listInvoices(sp);

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="mb-6 flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">請求書一覧</h1>
          <p className="text-ink-500 text-sm mt-1">発行した適格請求書の管理</p>
        </div>
        <Link href="/invoices/new" className="btn btn-primary">
          + 新規請求書
        </Link>
      </header>

      <div className="card p-0 overflow-hidden">
        <div className="p-4 border-b border-ink-100 flex flex-wrap items-center gap-3 no-print">
          <form className="flex items-center gap-2 flex-1 min-w-[240px]">
            <input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="番号・顧客名で検索…"
              className="input"
            />
            <StatusFilter current={sp.status ?? "all"} />
            <button className="btn btn-sm">検索</button>
          </form>
          <div className="text-xs text-ink-500">{invoices.length} 件</div>
        </div>

        {invoices.length === 0 ? (
          <div className="p-10 text-center text-ink-500 text-sm">
            該当する請求書がありません。
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>番号</th>
                <th>件名</th>
                <th>宛名</th>
                <th>発行日</th>
                <th>支払期限</th>
                <th className="text-right">合計（税込）</th>
                <th>状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-mono text-xs">{inv.number}</td>
                  <td className="text-ink-700">
                    {inv.subject || <span className="text-ink-500">—</span>}
                  </td>
                  <td>
                    {inv.customer.name} {inv.customer.honorific}
                  </td>
                  <td className="text-ink-500 text-sm">
                    {formatJPDate(inv.issueDate)}
                  </td>
                  <td className="text-ink-500 text-sm">
                    {inv.dueDate ? formatJPDate(inv.dueDate) : "—"}
                  </td>
                  <td className="text-right font-medium">
                    {formatJPY(inv.total)}
                  </td>
                  <td>{statusBadge(inv.status)}</td>
                  <td>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="text-sm text-ink-700 hover:underline"
                    >
                      詳細
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
