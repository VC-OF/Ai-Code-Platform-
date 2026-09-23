"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Search, Trash2, Eye, Edit } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";
import { Invoice, Settings } from "@/lib/types";

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/invoices").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]).then(([inv, set]) => {
      setInvoices(inv);
      setSettings(set);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      const matchesQuery =
        !query ||
        inv.number.toLowerCase().includes(query.toLowerCase()) ||
        inv.clientName.toLowerCase().includes(query.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || inv.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [invoices, query, statusFilter]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this invoice?")) return;
    const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" });
    if (res.ok) setInvoices(invoices.filter((i) => i.id !== id));
  }

  const fmt = (n: number) => formatCurrency(n, settings?.currency || "USD");

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">
            {invoices.length} total invoice{invoices.length !== 1 && "s"}
          </p>
        </div>
        <Link href="/invoices/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          New Invoice
        </Link>
      </div>

      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by number or client…"
              className="input pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input sm:w-44"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-500 text-sm">
            No invoices found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-6 py-3">Number</th>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Issued</th>
                  <th className="px-6 py-3">Due</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Total</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="text-brand-600 hover:text-brand-800 hover:underline font-semibold"
                      >
                        {inv.number}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      <div>{inv.clientName}</div>
                      <div className="text-xs text-gray-400">
                        {inv.clientEmail}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {formatDate(inv.issueDate)}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {formatDate(inv.dueDate)}
                    </td>
                    <td className="px-6 py-3">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-gray-900">
                      {fmt(inv.total)}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                          title="View Details / Print"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <Link
                          href={`/invoices/${inv.id}/edit`}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => handleDelete(inv.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-red-500"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
