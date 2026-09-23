import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  formatJPY,
  formatJPDate,
  formatRegistrationNo,
  lineTotal,
} from "@/lib/calc";
import StatusActions from "./StatusActions";
import DownloadPDFButton from "./DownloadPDFButton";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { customer: true, items: { orderBy: { position: "asc" } } },
  });
  if (!inv) notFound();
  const company = await prisma.company.findFirst();

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <header className="mb-6 flex items-end justify-between flex-wrap gap-3 no-print">
        <div>
          <div className="text-xs text-ink-500 mb-1">
            <Link href="/invoices" className="hover:underline">
              請求書一覧
            </Link>{" "}
            / {inv.number}
          </div>
          <h1 className="text-2xl font-semibold">請求書 {inv.number}</h1>
          <p className="text-ink-500 text-sm mt-1">{inv.subject || "—"}</p>
        </div>
        <div className="flex gap-2">
          <DownloadPDFButton invoiceId={inv.id} />
          <StatusActions id={inv.id} status={inv.status} />
        </div>
      </header>

      {/* Printable invoice */}
      <div className="card p-8 md:p-10" id="invoice-doc">
        <div className="flex items-start justify-between border-b border-ink-200 pb-6 mb-6">
          <div>
            <div className="text-xs text-ink-500 tracking-[0.3em]">
              INVOICE / 適格請求書
            </div>
            <div className="text-3xl font-semibold mt-1">御請求書</div>
            <div className="text-sm text-ink-500 mt-2">No. {inv.number}</div>
          </div>
          <div className="text-right text-sm leading-relaxed">
            <div className="font-semibold text-lg">
              {company?.logoText ?? company?.name}
            </div>
            <div className="text-ink-700 mt-1">{company?.name}</div>
            {company?.registrationNo && (
              <div className="text-ink-500 font-mono text-xs mt-1">
                登録番号: {formatRegistrationNo(company.registrationNo)}
              </div>
            )}
            {company?.postalCode && (
              <div className="text-ink-500 text-xs">〒{company.postalCode}</div>
            )}
            {company?.address && (
              <div className="text-ink-500 text-xs whitespace-pre-line">
                {company.address}
              </div>
            )}
            {company?.tel && (
              <div className="text-ink-500 text-xs">TEL: {company.tel}</div>
            )}
            {company?.email && (
              <div className="text-ink-500 text-xs">{company.email}</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <div className="text-xs text-ink-500 mb-1">宛名</div>
            <div className="text-lg font-semibold">
              {inv.customer.name} {inv.customer.honorific}
            </div>
            {inv.customer.registrationNo && (
              <div className="text-xs text-ink-500 font-mono mt-1">
                登録番号: {formatRegistrationNo(inv.customer.registrationNo)}
              </div>
            )}
            {inv.customer.postalCode && (
              <div className="text-xs text-ink-500">
                〒{inv.customer.postalCode}
              </div>
            )}
            {inv.customer.address && (
              <div className="text-xs text-ink-500 whitespace-pre-line">
                {inv.customer.address}
              </div>
            )}
          </div>
          <div className="text-sm md:text-right space-y-1">
            <Row k="発行日" v={formatJPDate(inv.issueDate)} />
            <Row
              k="支払期限"
              v={inv.dueDate ? formatJPDate(inv.dueDate) : "—"}
            />
            <Row k="件名" v={inv.subject || "—"} />
            <Row k="状態" v={statusLabel(inv.status)} />
          </div>
        </div>

        <table className="data w-full mb-4">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>品目</th>
              <th className="text-right" style={{ width: 70 }}>
                数量
              </th>
              <th style={{ width: 70 }}>単位</th>
              <th className="text-right" style={{ width: 110 }}>
                単価
              </th>
              <th className="text-right" style={{ width: 70 }}>
                税率
              </th>
              <th className="text-right" style={{ width: 130 }}>
                金額
              </th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={it.id}>
                <td className="text-ink-500">{i + 1}</td>
                <td>
                  <div className="font-medium">{it.name}</div>
                  {it.description && (
                    <div className="text-xs text-ink-500 mt-0.5">
                      {it.description}
                    </div>
                  )}
                </td>
                <td className="text-right">
                  {it.quantity.toLocaleString("ja-JP")}
                </td>
                <td className="text-ink-500">{it.unit}</td>
                <td className="text-right">{formatJPY(it.unitPrice)}</td>
                <td className="text-right">{it.taxRate}%</td>
                <td className="text-right font-medium">
                  {formatJPY(it.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-6">
          <div className="w-full max-w-sm text-sm">
            <div className="flex justify-between py-1.5 border-b border-ink-100">
              <span className="text-ink-500">10% 対象金額</span>
              <span>{formatJPY(inv.subtotal10)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-ink-100">
              <span className="text-ink-500">10% 消費税</span>
              <span>{formatJPY(inv.tax10)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-ink-100">
              <span className="text-ink-500">8% 対象金額（軽減税率）</span>
              <span>{formatJPY(inv.subtotal8)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-ink-100">
              <span className="text-ink-500">8% 消費税</span>
              <span>{formatJPY(inv.tax8)}</span>
            </div>
            {inv.subtotal0 > 0 && (
              <div className="flex justify-between py-1.5 border-b border-ink-100">
                <span className="text-ink-500">非課税</span>
                <span>{formatJPY(inv.subtotal0)}</span>
              </div>
            )}
            <div className="flex justify-between py-2.5 mt-1 border-t-2 border-ink-900">
              <span className="font-semibold">合計金額（税込）</span>
              <span className="font-semibold text-lg">
                {formatJPY(inv.total)}
              </span>
            </div>
            {inv.withholding > 0 && (
              <div className="flex justify-between py-1.5 text-ink-500 text-xs">
                <span>（参考）源泉徴収額</span>
                <span>{formatJPY(inv.withholding)}</span>
              </div>
            )}
          </div>
        </div>

        {company?.bankInfo && (
          <div className="bg-ink-50 p-4 rounded-lg text-sm">
            <div className="text-xs text-ink-500 mb-1">お振込先</div>
            <div className="whitespace-pre-line">{company.bankInfo}</div>
          </div>
        )}

        {inv.remarks && (
          <div className="mt-4 text-sm">
            <div className="text-xs text-ink-500 mb-1">備考</div>
            <div className="whitespace-pre-line">{inv.remarks}</div>
          </div>
        )}

        {company?.taxNote && (
          <div className="mt-6 text-[11px] text-ink-500 whitespace-pre-line border-t border-ink-100 pt-3">
            {company.taxNote}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex md:justify-end gap-3">
      <span className="text-ink-500 w-20">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function statusLabel(s: string) {
  switch (s) {
    case "paid":
      return "支払済";
    case "issued":
      return "発行済";
    case "void":
      return "無効";
    default:
      return "下書き";
  }
}
