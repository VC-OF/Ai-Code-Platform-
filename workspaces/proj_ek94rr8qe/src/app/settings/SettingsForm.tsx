"use client";
import { useState, useTransition } from "react";
import { updateCompanyAction } from "../_actions";

type Initial = {
  name: string;
  nameEn: string;
  registrationNo: string;
  postalCode: string;
  address: string;
  tel: string;
  email: string;
  bankInfo: string;
  logoText: string;
  taxNote: string;
  defaultTaxRate: number;
  invoicePrefix: string;
};

export default function SettingsForm({
  initial,
  nextInvoiceSeq,
}: {
  initial: Initial;
  nextInvoiceSeq: number;
}) {
  const [form, setForm] = useState<Initial>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!form.name.trim()) return setErr("会社名は必須です");
    const fd = new FormData();
    fd.set("payload", JSON.stringify(form));
    start(async () => {
      const res = await updateCompanyAction(null, fd);
      if (res && !res.ok) setErr(res.error ?? "保存に失敗しました");
      else setMsg("保存しました。");
    });
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">会社名 *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">英名</label>
          <input
            className="input"
            value={form.nameEn}
            onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">適格請求書発行事業者 登録番号</label>
          <input
            className="input font-mono"
            value={form.registrationNo}
            onChange={(e) =>
              setForm({ ...form, registrationNo: e.target.value })
            }
            placeholder="T1234567890123"
          />
          <p className="text-[11px] text-ink-500 mt-1">
            13桁の数字を T 付きで入力してください。
          </p>
        </div>
        <div>
          <label className="label">郵便番号</label>
          <input
            className="input"
            value={form.postalCode}
            onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
          />
        </div>
        <div>
          <label className="label">電話</label>
          <input
            className="input"
            value={form.tel}
            onChange={(e) => setForm({ ...form, tel: e.target.value })}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">住所</label>
          <textarea
            className="textarea"
            rows={2}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <div>
          <label className="label">メール</label>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="label">ロゴ/見出しテキスト</label>
          <input
            className="input"
            value={form.logoText}
            onChange={(e) => setForm({ ...form, logoText: e.target.value })}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">お振込先</label>
          <textarea
            className="textarea"
            rows={3}
            value={form.bankInfo}
            onChange={(e) => setForm({ ...form, bankInfo: e.target.value })}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">備考（フッター表示）</label>
          <textarea
            className="textarea"
            rows={3}
            value={form.taxNote}
            onChange={(e) => setForm({ ...form, taxNote: e.target.value })}
          />
        </div>
        <div>
          <label className="label">請求書番号プレフィックス</label>
          <input
            className="input"
            value={form.invoicePrefix}
            onChange={(e) =>
              setForm({ ...form, invoicePrefix: e.target.value })
            }
          />
        </div>
        <div>
          <label className="label">既定の消費税率</label>
          <select
            className="select"
            value={form.defaultTaxRate}
            onChange={(e) =>
              setForm({ ...form, defaultTaxRate: Number(e.target.value) })
            }
          >
            <option value={10}>10% 標準</option>
            <option value={8}>8% 軽減</option>
            <option value={0}>非課税</option>
          </select>
        </div>
      </div>
      <div className="text-xs text-ink-500 border-t border-ink-100 pt-3">
        次の請求書番号:{" "}
        <span className="font-mono">
          {form.invoicePrefix}-{new Date().getFullYear()}-
          {String(nextInvoiceSeq).padStart(4, "0")}
        </span>
      </div>
      {err && (
        <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {err}
        </div>
      )}
      {msg && (
        <div className="p-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded">
          {msg}
        </div>
      )}
      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "保存中…" : "設定を保存"}
        </button>
      </div>
    </form>
  );
}
