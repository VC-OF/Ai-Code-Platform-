"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import {
  DollarSign,
  FileText,
  Users,
  AlertCircle,
  TrendingUp,
  Plus,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Invoice } from "@/lib/types";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 bg-gray-200 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const t = data.totals;
  const fmt = (n: number) => formatCurrency(n, data.currency);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Overview of your invoicing activity
          </p>
        </div>
        <Link href="/invoices/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          New Invoice
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Revenue"
          value={fmt(t.revenue)}
          icon={<DollarSign className="w-5 h-5" />}
          accent="emerald"
          hint="From paid invoices"
        />
        <StatCard
          label="Outstanding"
          value={fmt(t.outstanding)}
          icon={<TrendingUp className="w-5 h-5" />}
          accent="brand"
          hint="Sent, awaiting payment"
        />
        <StatCard
          label="Overdue"
          value={fmt(t.overdue)}
          icon={<AlertCircle className="w-5 h-5" />}
          accent="red"
          hint="Past due date"
        />
        <StatCard
          label="Invoices"
          value={t.invoices}
          icon={<FileText className="w-5 h-5" />}
          accent="brand"
          hint={`${t.clients} active clients`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Invoices</h2>
            <Link
              href="/invoices"
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              View all →
            </Link>
          </div>
          {data.recentInvoices.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-sm">
              No invoices yet.{" "}
              <Link
                href="/invoices/new"
                className="text-brand-600 hover:underline"
              >
                Create your first invoice
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-6 py-3">Invoice</th>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Due</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.recentInvoices.map((inv: Invoice) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {inv.number}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {inv.clientName}
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">This Month</h2>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <p className="text-xs text-gray-500">Paid this month</p>
              <p className="text-xl font-semibold text-gray-900 mt-1">
                {fmt(t.paidThisMonth)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Invoices paid</p>
              <p className="text-xl font-semibold text-gray-900 mt-1">
                {t.paidThisMonthCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Active clients</p>
              <p className="text-xl font-semibold text-gray-900 mt-1 flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-400" />
                {t.clients}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
