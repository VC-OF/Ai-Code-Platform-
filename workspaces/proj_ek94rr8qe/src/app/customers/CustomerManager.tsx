"use client";

import { useState, useTransition } from "react";
import {
  createCustomerAction,
  updateCustomerAction,
  deleteCustomerAction,
} from "../_actions";

type Customer = {
  id: string;
  name: string;
  nameKana: string;
  honorific: string;
  postalCode: string;
  address: string;
  registrationNo: string;
  tel: string;
  email: string;
  note: string;
  invoiceCount: number;
};

const empty = {
  name: "",
  nameKana: "",
  honorific: "御中",
  postalCode: "",
  address: "",
  registrationNo: "",
  tel: "",
  email: "",
  note: "",
};

export default function CustomerManager({ initial }: { initial: Customer[] }) {
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [search, setSearch] = useState("");

  const filtered = initial.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.nameKana.toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setForm(empty);
    setEditing(null);
    setCreating(true);
    setErr(null);
  }
  function openEdit(c: Customer) {
    setForm({ ...c });
    setEditing(c);
    setCreating(true);
    setErr(null);
  }
  function close() {
    setCreating(false);
    setEditing(null);
    setErr(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.name.trim()) return setErr("顧客名は必須です");
    const fd = new FormData();
    fd.set("payload", JSON.stringify(form));
    start(async () => {
      const res = editing
        ? await updateCustomerAction(editing.id, null, fd)
        : await createCustomerAction(null, fd);
      if (res && !res.ok) setErr(res.error ?? "保存に失敗しました");
      else window.location.reload();
    });
  }

  function remove(c: Customer) {
    if (!confirm(`「${c.name}」を削除しますか？`)) return;
    start(async () => {
      const res = await deleteCustomerAction(c.id);
      if (res && !res.ok) {
        alert(res.error);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <>
      <div className="card p-0 overflow-hidden">
        <div className="p-4 border-b border-ink-100 flex items-center gap-3 flex-wrap">
          <input
            className="input flex-1 min-w-[200px]"
            placeholder="顧客名・フリガナで検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={openCreate}>
            + 新規顧客
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-ink-500 text-sm">
            顧客が登録されていません。
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>顧客名</th>
                <th>フリガナ</th>
                <th>敬称</th>
                <th>登録番号</th>
                <th>電話</th>
                <th>メール</th>
                <th>請求書</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.name}</td>
                  <td className="text-ink-500 text-sm">{c.nameKana || "—"}</td>
                  <td className="text-ink-500 text-sm">{c.honorific}</td>
                  <td className="font-mono text-xs">
                    {c.registrationNo || "—"}
                  </td>
                  <td className="text-ink-500 text-sm">{c.tel || "—"}</td>
                  <td className="text-ink-500 text-sm">{c.email || "—"}</td>
                  <td>{c.invoiceCount} 件</td>
                  <td className="space-x-2 whitespace-nowrap">
                    <button
                      className="text-sm text-ink-700 hover:underline"
                      onClick={() => openEdit(c)}
                    >
                      編集
                    </button>
                    <button
                      className="text-sm text-red-600 hover:underline"
                      onClick={() => remove(c)}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={close}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="bg-white rounded-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-lg font-semibold mb-4">
              {editing ? "顧客を編集" : "新規顧客"}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="顧客名 *">
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </Field>
              <Field label="フリガナ">
                <input
                  className="input"
                  value={form.nameKana}
                  onChange={(e) =>
                    setForm({ ...form, nameKana: e.target.value })
                  }
                />
              </Field>
              <Field label="敬称">
                <select
                  className="select"
                  value={form.honorific}
                  onChange={(e) =>
                    setForm({ ...form, honorific: e.target.value })
                  }
                >
                  <option>御中</option>
                  <option>様</option>
                </select>
              </Field>
              <Field label="適格請求書登録番号">
                <input
                  className="input"
                  value={form.registrationNo}
                  onChange={(e) =>
                    setForm({ ...form, registrationNo: e.target.value })
                  }
                  placeholder="T1234567890123"
                />
              </Field>
              <Field label="郵便番号">
                <input
                  className="input"
                  value={form.postalCode}
                  onChange={(e) =>
                    setForm({ ...form, postalCode: e.target.value })
                  }
                />
              </Field>
              <Field label="電話番号">
                <input
                  className="input"
                  value={form.tel}
                  onChange={(e) => setForm({ ...form, tel: e.target.value })}
                />
              </Field>
              <Field label="メール" full>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label="住所" full>
                <textarea
                  className="textarea"
                  rows={2}
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                />
              </Field>
              <Field label="メモ" full>
                <textarea
                  className="textarea"
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </Field>
            </div>
            {err && (
              <div className="mt-3 p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
                {err}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn" onClick={close}>
                キャンセル
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pending}
              >
                {pending ? "保存中…" : editing ? "更新" : "登録"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
