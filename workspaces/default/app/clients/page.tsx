"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X, Edit2 } from "lucide-react";
import { Client } from "@/lib/types";

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    phone: "",
    address: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => {
        setClients(d);
        setLoading(false);
      });
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditingClient(null);
    setForm({ name: "", email: "", company: "", phone: "", address: "" });
    setShowForm(true);
  }

  function openEdit(client: Client) {
    setEditingClient(client);
    setForm({
      name: client.name || "",
      email: client.email || "",
      company: client.company || "",
      phone: client.phone || "",
      address: client.address || "",
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingClient(null);
    setForm({ name: "", email: "", company: "", phone: "", address: "" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const isEdit = !!editingClient;
    const url = isEdit ? `/api/clients/${editingClient.id}` : "/api/clients";
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      closeForm();
      load();
    } else {
      const err = await res.json();
      alert(err.error || `Failed to ${isEdit ? "update" : "add"} client`);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this client?")) return;
    const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
    if (res.ok) setClients(clients.filter((c) => c.id !== id));
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">
            {clients.length} client{clients.length !== 1 && "s"}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" />
          New client
        </button>
      </div>

      {showForm && (
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">
              {editingClient ? "Edit client" : "New client"}
            </h2>
            <button
              onClick={closeForm}
              className="p-1 rounded hover:bg-gray-100 text-gray-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <div>
              <label className="label">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input"
                required
              />
            </div>
            <div>
              <label className="label">Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input"
                required
              />
            </div>
            <div>
              <label className="label">Company</label>
              <input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="input"
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="input"
                placeholder="Street, City, State ZIP"
              />
            </div>
            <div className="md:col-span-2 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeForm}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving
                  ? "Saving…"
                  : editingClient
                  ? "Update client"
                  : "Add client"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading…</div>
        ) : clients.length === 0 ? (
          <div className="p-12 text-center text-gray-500 text-sm">
            No clients yet. Add your first client to start invoicing.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Email</th>
                  <th className="px-6 py-3">Company</th>
                  <th className="px-6 py-3">Phone</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <div className="font-medium text-gray-900">{c.name}</div>
                      {c.address && (
                        <div className="text-xs text-gray-400">{c.address}</div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-gray-600">{c.email}</td>
                    <td className="px-6 py-3 text-gray-600">
                      {c.company || "—"}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {c.phone || "—"}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-1 justify-end">
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                          title="Edit client"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-red-500"
                          title="Delete client"
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
