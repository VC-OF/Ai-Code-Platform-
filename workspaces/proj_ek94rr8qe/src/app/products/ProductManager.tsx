"use client";
import { useState, useTransition } from "react";
import {
  createProductAction,
  updateProductAction,
  deleteProductAction,
} from "../_actions";

type Product = {
  id: string;
  code: string;
  name: string;
  description: string;
  unitPrice: number;
  taxRate: number;
  unit: string;
  active: boolean;
  priceLabel: string;
};

const empty = {
  code: "",
  name: "",
  description: "",
  unitPrice: 0,
  taxRate: 10,
  unit: "個",
  active: true,
};

export default function ProductManager({ initial }: { initial: Product[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function openNew() {
    setForm(empty);
    setEditing(null);
    setOpen(true);
    setErr(null);
  }
  function openEdit(p: Product) {
    setForm({ ...p });
    setEditing(p);
    setOpen(true);
    setErr(null);
  }
  function close() {
    setOpen(false);
    setEditing(null);
    setErr(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setErr("品目名は必須です");
    const fd = new FormData();
    fd.set("payload", JSON.stringify(form));
    start(async () => {
      const res = editing
        ? await updateProductAction(editing.id, null, fd)
        : await createProductAction(null, fd);
      if (res && !res.ok) {
        setErr(res.error ?? "保存に失敗しました");
        return;
      }
      window.location.reload();
    });
  }
  function remove(p: Product) {
    if (
      !confirm(
        `「${p.name}」を削除しますか？ 履歴に使われている場合は無効化されます。`
      )
    )
      return;
    start(async () => {
      await deleteProductAction(p.id);
      window.location.reload();
    });
  }

  return (
    <>
      <div className="card p-0 overflow-hidden">
        <div className="p-4 border-b border-ink-100 flex items-center justify-between">
          <div className="text-sm text-ink-500">{initial.length} 件登録</div>
          <button className="btn btn-primary" onClick={openNew}>
            + 新規品目
          </button>
        </div>
        {initial.length === 0 ? (
          <div className="p-10 text-center text-ink-500 text-sm">
            品目が登録されていません。
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>コード</th>
                <th>品目名</th>
                <th>説明</th>
                <th>単位</th>
                <th className="text-right">単価</th>
                <th>税率</th>
                <th>状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {initial.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-xs">{p.code || "—"}</td>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-ink-500 text-sm">
                    {p.description || "—"}
                  </td>
                  <td className="text-ink-500 text-sm">{p.unit}</td>
                  <td className="text-right">{p.priceLabel}</td>
                  <td>
                    {p.taxRate === 8 ? (
                      <span className="badge badge-amber">8% 軽減</span>
                    ) : p.taxRate === 0 ? (
                      <span className="badge badge-gray">非課税</span>
                    ) : (
                      <span className="badge badge-blue">10%</span>
                    )}
                  </td>
                  <td>
                    {p.active ? (
                      <span className="badge badge-green">有効</span>
                    ) : (
                      <span className="badge badge-gray">無効</span>
                    )}
                  </td>
                  <td className="space-x-2 whitespace-nowrap">
                    <button
                      className="text-sm text-ink-700 hover:underline"
                      onClick={() => openEdit(p)}
                    >
                      編集
                    </button>
                    <button
                      className="text-sm text-red-600 hover:underline"
                      onClick={() => remove(p)}
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

      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={close}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="bg-white rounded-xl w-full max-w-xl p-6"
          >
            <h2 className="text-lg font-semibold mb-4">
              {editing ? "品目を編集" : "新規品目"}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">コード</label>
                <input
                  className="input"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
              <div>
                <label className="label">単位</label>
                <input
                  className="input"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">品目名 *</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">説明</label>
                <input
                  className="input"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">単価（JPY）</label>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={form.unitPrice}
                  onChange={(e) =>
                    setForm({ ...form, unitPrice: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label className="label">税率</label>
                <select
                  className="select"
                  value={form.taxRate}
                  onChange={(e) =>
                    setForm({ ...form, taxRate: Number(e.target.value) })
                  }
                >
                  <option value={10}>10% 標準</option>
                  <option value={8}>8% 軽減</option>
                  <option value={0}>非課税</option>
                </select>
              </div>
              <div className="md:col-span-2 flex items-center gap-2">
                <input
                  id="act"
                  type="checkbox"
                  checked={!!form.active}
                  onChange={(e) =>
                    setForm({ ...form, active: e.target.checked })
                  }
                />
                <label htmlFor="act" className="text-sm">
                  有効
                </label>
              </div>
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
