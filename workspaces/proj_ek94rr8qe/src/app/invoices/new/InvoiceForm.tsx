"use client";

import { useMemo, useState, useTransition } from "react";
import {
  computeTotals,
  lineTotal as computeLineTotal,
  formatJPY,
} from "@/lib/calc";
import { createInvoiceAction } from "./actions";

type Product = {
  id: string;
  name: string;
  code: string | null;
  unitPrice: number;
  taxRate: number;
  unit: string;
};
type Customer = { id: string; name: string; honorific: string };

export type InvoiceFormProps = {
  customers: Customer[];
  products: Product[];
  defaultTaxRate: number;
};

type Line = {
  productId?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxRate: number;
};

function emptyLine(taxRate: number): Line {
  return {
    name: "",
    description: "",
    quantity: 1,
    unit: "個",
    unitPrice: 0,
    taxRate,
  };
}

export default function InvoiceForm({
  customers,
  products,
  defaultTaxRate,
}: InvoiceFormProps) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [issueDate, setIssueDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [dueDate, setDueDate] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [remarks, setRemarks] = useState("");
  const [withholding, setWithholding] = useState(0);
  const [items, setItems] = useState<Line[]>([emptyLine(defaultTaxRate)]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const totals = useMemo(
    () =>
      computeTotals(
        items.map((it) => ({
          quantity: it.quantity || 0,
          unitPrice: it.unitPrice || 0,
          taxRate: it.taxRate,
        }))
      ),
    [items]
  );

  function setLine(idx: number, patch: Partial<Line>) {
    setItems((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))
    );
  }

  function applyProduct(idx: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return setLine(idx, { productId: null });
    setLine(idx, {
      productId: p.id,
      name: p.name,
      unit: p.unit,
      unitPrice: p.unitPrice,
      taxRate: p.taxRate,
    });
  }

  function addLine() {
    setItems((prev) => [...prev, emptyLine(defaultTaxRate)]);
  }
  function removeLine(idx: number) {
    setItems((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customerId) return setError("顧客を選択してください");
    if (items.some((i) => !i.name.trim()))
      return setError("品目名が空の行があります");
    if (items.some((i) => i.quantity <= 0))
      return setError("数量は1以上を入力してください");
    if (items.some((i) => i.unitPrice < 0))
      return setError("単価は0以上を入力してください");

    const payload = {
      customerId,
      issueDate,
      dueDate: dueDate || null,
      subject: subject || null,
      remarks: remarks || null,
      withholding,
      items: items.map((it) => ({
        productId: it.productId || null,
        name: it.name,
        description: it.description || null,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        taxRate: it.taxRate,
      })),
    };

    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    startTransition(async () => {
      const res = await createInvoiceAction(null, fd);
      if (res && !res.ok) setError(res.error ?? "保存に失敗しました");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 lg:grid-cols-3 gap-6"
    >
      <div className="lg:col-span-2 space-y-6">
        <div className="card p-5">
          <h2 className="font-semibold mb-4">基本情報</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">顧客（宛名） *</label>
              <select
                className="select"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">選択してください</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.honorific}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">件名</label>
              <input
                className="input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="例: 2026年3月分 Web開発費用"
              />
            </div>
            <div>
              <label className="label">発行日 *</label>
              <input
                type="date"
                className="input"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">支払期限</label>
              <input
                type="date"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="p-4 border-b border-ink-100 flex items-center justify-between">
            <h2 className="font-semibold">明細</h2>
            <button type="button" className="btn btn-sm" onClick={addLine}>
              + 行を追加
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>品目</th>
                  <th style={{ width: 110 }}>数量</th>
                  <th style={{ width: 100 }}>単位</th>
                  <th style={{ width: 130 }}>単価</th>
                  <th style={{ width: 110 }}>税率</th>
                  <th style={{ width: 130 }} className="text-right">
                    金額
                  </th>
                  <th style={{ width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td>
                      <div className="space-y-1">
                        {products.length > 0 && (
                          <select
                            className="select"
                            value={it.productId ?? ""}
                            onChange={(e) => applyProduct(idx, e.target.value)}
                          >
                            <option value="">（マスタから選択）</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.code ? `${p.code} ` : ""}
                                {p.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          className="input"
                          value={it.name}
                          onChange={(e) =>
                            setLine(idx, { name: e.target.value })
                          }
                          placeholder="品目名"
                          required
                        />
                      </div>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        className="input"
                        value={it.quantity}
                        onChange={(e) =>
                          setLine(idx, { quantity: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={it.unit}
                        onChange={(e) => setLine(idx, { unit: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        className="input"
                        value={it.unitPrice}
                        onChange={(e) =>
                          setLine(idx, { unitPrice: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="select"
                        value={it.taxRate}
                        onChange={(e) =>
                          setLine(idx, { taxRate: Number(e.target.value) })
                        }
                      >
                        <option value={10}>10%</option>
                        <option value={8}>8% 軽減</option>
                        <option value={0}>非課税</option>
                      </select>
                    </td>
                    <td className="text-right font-medium">
                      {formatJPY(computeLineTotal(it.quantity, it.unitPrice))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => removeLine(idx)}
                        disabled={items.length === 1}
                        title="削除"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold mb-3">備考・但し書</h2>
          <textarea
            className="textarea"
            rows={4}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="例: お取引に関するご要望・ご連絡事項など"
          />
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">源泉徴収額（参考）</label>
              <input
                type="number"
                min={0}
                className="input"
                value={withholding}
                onChange={(e) => setWithholding(Number(e.target.value))}
              />
              <p className="text-[11px] text-ink-500 mt-1">
                ※ 請求書本体には含めず参考表示
              </p>
            </div>
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card p-5 sticky top-4">
          <h3 className="font-semibold mb-3">合計</h3>
          <Row label="10% 対象" value={formatJPY(totals.subtotal10)} />
          <Row label="10% 消費税" value={formatJPY(totals.tax10)} />
          <Row label="8% 対象（軽減）" value={formatJPY(totals.subtotal8)} />
          <Row label="8% 消費税" value={formatJPY(totals.tax8)} />
          <Row label="非課税" value={formatJPY(totals.subtotal0)} />
          <div className="border-t border-ink-100 mt-3 pt-3">
            <Row
              label="請求総額（税込）"
              value={formatJPY(totals.total)}
              bold
            />
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary w-full mt-5 justify-center"
            disabled={isPending}
          >
            {isPending ? "保存中…" : "請求書を保存"}
          </button>
          <p className="text-[11px] text-ink-500 mt-2">
            適格請求書として登録番号付きで発行されます。
          </p>
        </div>
      </aside>
    </form>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-1 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className={bold ? "font-semibold text-base" : "font-medium"}>
        {value}
      </span>
    </div>
  );
}
