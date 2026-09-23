"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer, Edit, CheckCircle, Clock, AlertTriangle, Send } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";
import { Invoice, Settings, InvoiceStatus } from "@/lib/types";

export default function InvoiceDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/invoices/${id}`).then((r) => {
        if (!r.ok) throw new Error("Invoice not found");
        return r.json();
      }),
      fetch("/api/settings").then((r) => r.json()),
    ])
      .then(([inv, set]) => {
        setInvoice(inv);
        setSettings(set);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load invoice");
        setLoading(false);
      });
  }, [id]);

  async function handleStatusChange(newStatus: InvoiceStatus) {
    if (!invoice) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const updated = await res.json();
        setInvoice(updated);
      }
    } finally {
      setUpdatingStatus(false);
    }
  }

  const fmt = (n: number) => formatCurrency(n, settings?.currency || "USD");

  if (loading) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center text-gray-500 text-sm">
        Loading invoice…
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Invoice Not Found</h2>
        <p className="text-sm text-gray-500 mb-6">{error || "The requested invoice could not be found."}</p>
        <Link href="/invoices" className="btn-primary">
          <ArrowLeft className="w-4 h-4" />
          Back to Invoices
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      {/* ── Top Bar Actions (Hidden on Print) ─────────────────────────── */}
      <div className="print:hidden flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Link href="/invoices" className="btn-secondary !px-2.5 !py-2">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <span>{invoice.number}</span>
              <StatusBadge status={invoice.status} />
            </h1>
            <p className="text-xs text-gray-500">Created on {formatDate(invoice.createdAt)}</p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Quick status actions */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm text-xs">
            {(["draft", "sent", "paid", "overdue"] as InvoiceStatus[]).map((st) => (
              <button
                key={st}
                disabled={updatingStatus || invoice.status === st}
                onClick={() => handleStatusChange(st)}
                className={`px-2.5 py-1 rounded-md font-medium capitalize transition-colors ${
                  invoice.status === st
                    ? "bg-gray-900 text-white shadow-xs"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <Link href={`/invoices/${invoice.id}/edit`} className="btn-secondary">
            <Edit className="w-4 h-4" />
            Edit
          </Link>

          <button onClick={() => window.print()} className="btn-primary">
            <Printer className="w-4 h-4" />
            Print / PDF
          </button>
        </div>
      </div>

      {/* ── Printable Invoice Document ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 md:p-12 print:border-none print:shadow-none print:p-0">
        {/* Document Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-8 pb-8 border-b border-gray-200">
          <div>
            <div className="text-2xl font-bold text-gray-900 tracking-tight">
              {settings?.businessName || "Invoice System"}
            </div>
            {settings?.businessAddress && (
              <p className="text-sm text-gray-500 mt-1 whitespace-pre-line">{settings.businessAddress}</p>
            )}
            <div className="text-sm text-gray-500 mt-2 space-y-0.5">
              {settings?.businessEmail && <div>{settings.businessEmail}</div>}
              {settings?.businessPhone && <div>{settings.businessPhone}</div>}
            </div>
          </div>

          <div className="sm:text-right">
            <div className="text-3xl font-extrabold uppercase tracking-wider text-gray-900">
              INVOICE
            </div>
            <div className="text-base font-semibold font-mono text-gray-700 mt-1">
              #{invoice.number}
            </div>
            <div className="mt-3 text-sm space-y-1">
              <div className="text-gray-500">
                <span className="text-gray-400">Issued: </span>
                <span className="font-medium text-gray-900">{formatDate(invoice.issueDate)}</span>
              </div>
              <div className="text-gray-500">
                <span className="text-gray-400">Due: </span>
                <span className="font-medium text-gray-900">{formatDate(invoice.dueDate)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Billed To / Client Section */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 py-8 border-b border-gray-200">
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-400 mb-2">
              Billed To
            </h3>
            <div className="text-base font-semibold text-gray-900">{invoice.clientName}</div>
            <div className="text-sm text-gray-600 mt-1">{invoice.clientEmail}</div>
            {invoice.clientAddress && (
              <div className="text-sm text-gray-500 mt-1 whitespace-pre-line">
                {invoice.clientAddress}
              </div>
            )}
          </div>

          <div className="sm:text-right flex flex-col sm:items-end justify-center">
            <div className="inline-block p-4 rounded-xl bg-gray-50 border border-gray-100 min-w-[200px]">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Total Amount Due</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {fmt(invoice.total)}
              </div>
              <div className="text-xs text-gray-400 mt-1 capitalize">
                Status: <span className="font-semibold text-gray-700">{invoice.status}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="py-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-400">
                <th className="pb-3 font-semibold">Description</th>
                <th className="pb-3 text-right font-semibold w-20">Qty</th>
                <th className="pb-3 text-right font-semibold w-28">Price</th>
                <th className="pb-3 text-right font-semibold w-32">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoice.items.map((it) => (
                <tr key={it.id}>
                  <td className="py-4 font-medium text-gray-900">{it.description}</td>
                  <td className="py-4 text-right text-gray-600">{it.quantity}</td>
                  <td className="py-4 text-right text-gray-600">{fmt(it.unitPrice)}</td>
                  <td className="py-4 text-right font-semibold text-gray-900">
                    {fmt(it.quantity * it.unitPrice)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals & Notes Section */}
        <div className="pt-4 border-t border-gray-200 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            {invoice.notes && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                  Notes & Terms
                </h4>
                <p className="text-sm text-gray-600 whitespace-pre-line bg-gray-50 p-4 rounded-xl border border-gray-100">
                  {invoice.notes}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span className="font-medium text-gray-900">{fmt(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Tax ({invoice.taxRate}%)</span>
              <span className="font-medium text-gray-900">{fmt(invoice.taxAmount)}</span>
            </div>
            <div className="flex justify-between pt-3 border-t border-gray-200 text-lg font-bold text-gray-900">
              <span>Total</span>
              <span>{fmt(invoice.total)}</span>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="mt-12 pt-6 border-t border-gray-100 text-center text-xs text-gray-400">
          Thank you for your business!
        </div>
      </div>
    </div>
  );
}
