"use client";
import { useTransition } from "react";
import { updateInvoiceStatusAction, deleteInvoiceAction } from "../actions";
import { useRouter } from "next/navigation";

export default function StatusActions({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function set(s: string) {
    start(async () => {
      await updateInvoiceStatusAction(id, s);
      router.refresh();
    });
  }
  function del() {
    if (!confirm("この請求書を削除します。よろしいですか？")) return;
    start(async () => {
      await deleteInvoiceAction(id);
    });
  }

  return (
    <>
      {status !== "paid" && (
        <button
          className="btn btn-sm"
          onClick={() => set("paid")}
          disabled={pending}
        >
          ✓ 支払済にする
        </button>
      )}
      {status === "paid" && (
        <button
          className="btn btn-sm"
          onClick={() => set("issued")}
          disabled={pending}
        >
          支払済を取り消す
        </button>
      )}
      {status !== "void" && (
        <button
          className="btn btn-sm btn-danger"
          onClick={() => set("void")}
          disabled={pending}
        >
          無効化
        </button>
      )}
      <button
        className="btn btn-sm btn-danger"
        onClick={del}
        disabled={pending}
      >
        削除
      </button>
    </>
  );
}
