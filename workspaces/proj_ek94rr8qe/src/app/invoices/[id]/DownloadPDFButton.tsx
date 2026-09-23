"use client";
import { generateInvoicePDF } from "@/lib/pdf";

export default function DownloadPDFButton({
  invoiceId,
}: {
  invoiceId: string;
}) {
  return (
    <button
      className="btn btn-primary"
      onClick={async () => {
        const res = await fetch(`/api/invoices/${invoiceId}/pdf-data`);
        if (!res.ok) {
          alert("PDFデータの取得に失敗しました");
          return;
        }
        const data = await res.json();
        generateInvoicePDF(data);
      }}
    >
      ⬇ PDF ダウンロード
    </button>
  );
}
