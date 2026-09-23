"use client";

import { useEffect, useState } from "react";
import { Save, Check } from "lucide-react";
import { Settings } from "@/lib/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  if (!settings) {
    return <div className="p-8 text-gray-500">Loading…</div>;
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings({ ...settings!, [key]: value });
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure your business details and defaults
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">Business Profile</h2>
          <p className="text-sm text-gray-500 mb-4">
            This information appears on your invoices.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Business name</label>
              <input
                value={settings.businessName}
                onChange={(e) => update("businessName", e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                value={settings.businessEmail}
                onChange={(e) => update("businessEmail", e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                value={settings.businessPhone}
                onChange={(e) => update("businessPhone", e.target.value)}
                className="input"
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">Address</label>
              <input
                value={settings.businessAddress}
                onChange={(e) => update("businessAddress", e.target.value)}
                className="input"
              />
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">Invoice Defaults</h2>
          <p className="text-sm text-gray-500 mb-4">
            These are pre-filled on every new invoice.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Currency</label>
              <select
                value={settings.currency}
                onChange={(e) => update("currency", e.target.value)}
                className="input"
              >
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="CAD">CAD — Canadian Dollar</option>
                <option value="AUD">AUD — Australian Dollar</option>
                <option value="JPY">JPY — Japanese Yen</option>
              </select>
            </div>
            <div>
              <label className="label">Default tax rate (%)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={settings.taxRate}
                onChange={(e) => update("taxRate", +e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Invoice prefix</label>
              <input
                value={settings.invoicePrefix}
                onChange={(e) => update("invoicePrefix", e.target.value)}
                className="input"
                placeholder="INV"
              />
            </div>
            <div>
              <label className="label">Next invoice number</label>
              <input
                type="number"
                min="1"
                value={settings.nextInvoiceNumber}
                onChange={(e) => update("nextInvoiceNumber", +e.target.value)}
                className="input"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="text-sm text-emerald-600 flex items-center gap-1">
              <Check className="w-4 h-4" />
              Saved
            </span>
          )}
          <button type="submit" disabled={saving} className="btn-primary">
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
