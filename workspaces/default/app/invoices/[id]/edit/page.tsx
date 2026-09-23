"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Save } from "lucide-react";
import { Client, Settings, LineItem } from "@/lib/types";
import { formatCurrency } from "@/lib/format";

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function EditInvoicePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [clients, setClients] = useState<Client[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clientId, setClientId] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState("draft");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [taxRate, setTaxRate] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/invoices/${id}`).then((r) => r.json()),
      fetch("/api/clients").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]).then(([inv, cs, s]) => {
      setClients(cs);
      setSettings(s);
      setClientId(inv.clientId);
      setIssueDate(inv.issueDate);
      setDueDate(inv.dueDate);
      setStatus(inv.status);
      setNotes(inv.notes || "");
      setItems(inv.items);
      setTaxRate(inv.taxRate);
      setLoading(false);
    });
  }, [id]);

  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
    0
  );
  const taxAmount = +(subtotal * (taxRate / 100)).toFixed(2);
  const total = +(subtotal + taxAmount).toFixed(2);
  const fmt = (n: number) => formatCurrency(n, settings?.currency || "USD");

  function updateItem(itemId: string, patch: Partial<LineItem>) {
    setItems(items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems([
      ...items,
      { id: genId(), description: "", quantity: 1, unitPrice: 0 },
    ]);
  }
  function removeItem(itemId: string) {
    if (items.length === 1) return;
    setItems(items.filter((it) => it.id !== itemId));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/invoices/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        issueDate,
        dueDate,
        status,
        notes,
        items,
        taxRate,
      }),
    });
    setSaving(false);
    if (res.ok) router.push("/invoices");
    else {
      const err = await res.json();
      alert(err.error || "Failed to save");
    }
  }

  if (loading || !settings) {
    return <div className="p-8 text-gray-500">Loading…</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/invoices" className="btn-secondary !px-2 !py-2">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Edit Invoice</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Client</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="input"
                required
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="input"
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
            <div>
              <label className="label">Issue date</label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="input"
                required
              />
            </div>
            <div>
              <label className="label">Due date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input"
                required
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Line Items</h2>
            <button
              type="button"
              onClick={addItem}
              className="btn-secondary text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add item
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-6 py-3">Description</th>
                  <th className="px-6 py-3 w-24">Qty</th>
                  <th className="px-6 py-3 w-32">Unit price</th>
                  <th className="px-6 py-3 w-32 text-right">Total</th>
                  <th className="px-6 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-6 py-2">
                      <input
                        value={it.description}
                        onChange={(e) =>
                          updateItem(it.id, { description: e.target.value })
                        }
                        className="input"
                        required
                      />
                    </td>
                    <td className="px-6 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.quantity}
                        onChange={(e) =>
                          updateItem(it.id, { quantity: +e.target.value })
                        }
                        className="input"
                      />
                    </td>
                    <td className="px-6 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.unitPrice}
                        onChange={(e) =>
                          updateItem(it.id, { unitPrice: +e.target.value })
                        }
                        className="input"
                      />
                    </td>
                    <td className="px-6 py-2 text-right font-medium text-gray-900">
                      {fmt(it.quantity * it.unitPrice)}
                    </td>
                    <td className="px-6 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeItem(it.id)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-500 disabled:opacity-30"
                        disabled={items.length === 1}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex justify-end">
              <div className="w-64 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">{fmt(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Tax</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={taxRate}
                      onChange={(e) => setTaxRate(+e.target.value)}
                      className="input !w-20 !py-1 text-right"
                    />
                    <span className="text-gray-500">%</span>
                  </div>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Tax amount</span>
                  <span>{fmt(taxAmount)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-200 text-base">
                  <span className="font-semibold text-gray-900">Total</span>
                  <span className="font-semibold text-gray-900">
                    {fmt(total)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <label className="label">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="input"
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <Link href="/invoices" className="btn-secondary">
            Cancel
          </Link>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
