import { NextResponse } from "next/server";
import { getClients, getInvoices, getSettings } from "@/lib/db";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET() {
  const invoices = getInvoices();
  const clients = getClients();
  const settings = getSettings();

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  let totalRevenue = 0;
  let outstanding = 0;
  let overdue = 0;
  let paidThisMonth = 0;
  let monthCount = 0;

  for (const inv of invoices) {
    if (inv.status === "paid") totalRevenue += inv.total;
    if (inv.status === "sent" || inv.status === "overdue")
      outstanding += inv.total;
    if (inv.status === "overdue") overdue += inv.total;

    const d = new Date(inv.issueDate);
    if (
      inv.status === "paid" &&
      d.getMonth() === thisMonth &&
      d.getFullYear() === thisYear
    ) {
      paidThisMonth += inv.total;
      monthCount += 1;
    }
  }

  return NextResponse.json({
    totals: {
      invoices: invoices.length,
      clients: clients.length,
      revenue: totalRevenue,
      outstanding,
      overdue,
      paidThisMonth,
      paidThisMonthCount: monthCount,
    },
    currency: settings.currency,
    recentInvoices: invoices
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 5),
    formatCurrency: (n: number) => formatCurrency(n, settings.currency),
  });
}
