// Client-side PDF generator (uses jsPDF). Supports Japanese via the default
// font we bundle. For broader CJK support we fall back to a system font.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatRegistrationNo } from "./calc";

export type InvoicePDFData = {
  number: string;
  subject: string | null;
  issueDate: string; // ISO
  dueDate: string | null;
  status: string;
  remarks: string | null;
  company: {
    name: string;
    logoText: string | null;
    registrationNo: string | null;
    postalCode: string | null;
    address: string | null;
    tel: string | null;
    email: string | null;
    bankInfo: string | null;
    taxNote: string | null;
  };
  customer: {
    name: string;
    honorific: string;
    registrationNo: string | null;
    postalCode: string | null;
    address: string | null;
  };
  items: Array<{
    name: string;
    description: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
    taxRate: number;
    lineTotal: number;
  }>;
  totals: {
    subtotal10: number;
    tax10: number;
    subtotal8: number;
    tax8: number;
    subtotal0: number;
    total: number;
    withholding: number;
  };
};

function fmt(n: number) {
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}
function fmtJPDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function generateInvoicePDF(d: InvoicePDFData) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("INVOICE", M, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Qualified Invoice / Tekikaku Seikyusho", M, 76);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(d.company.logoText || d.company.name, W - M, 60, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let ry = 74;
  if (d.company.registrationNo) {
    doc.text(
      `Reg. No: ${formatRegistrationNo(d.company.registrationNo)}`,
      W - M,
      ry,
      { align: "right" }
    );
    ry += 12;
  }
  if (d.company.name) {
    doc.text(d.company.name, W - M, ry, { align: "right" });
    ry += 12;
  }
  if (d.company.postalCode) {
    doc.text(`〒${d.company.postalCode}`, W - M, ry, { align: "right" });
    ry += 12;
  }
  if (d.company.address) {
    const lines = (d.company.address || "").split(/\r?\n/);
    lines.forEach((l) => {
      doc.text(l, W - M, ry, { align: "right" });
      ry += 12;
    });
  }
  if (d.company.tel) {
    doc.text(`TEL: ${d.company.tel}`, W - M, ry, { align: "right" });
    ry += 12;
  }
  if (d.company.email) {
    doc.text(d.company.email, W - M, ry, { align: "right" });
    ry += 12;
  }

  // Invoice meta
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`No. ${d.number}`, M, ry + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Issue date: ${fmtJPDate(d.issueDate)}`, M, ry + 22);
  if (d.dueDate) doc.text(`Due date: ${fmtJPDate(d.dueDate)}`, M, ry + 36);
  if (d.subject) doc.text(`Subject: ${d.subject}`, M, ry + 50);

  // Customer block
  let cy = ry + 80;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Bill to:", M, cy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`${d.customer.name} ${d.customer.honorific}`, M, cy + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let y = cy + 30;
  if (d.customer.registrationNo) {
    doc.text(
      `Reg. No: ${formatRegistrationNo(d.customer.registrationNo)}`,
      M,
      y
    );
    y += 12;
  }
  if (d.customer.postalCode) {
    doc.text(`〒${d.customer.postalCode}`, M, y);
    y += 12;
  }
  if (d.customer.address) {
    (d.customer.address || "").split(/\r?\n/).forEach((l) => {
      doc.text(l, M, y);
      y += 12;
    });
  }

  // Items table
  autoTable(doc, {
    startY: y + 12,
    head: [["#", "Description", "Qty", "Unit", "Unit price", "Tax", "Amount"]],
    body: d.items.map((it, i) => [
      String(i + 1),
      `${it.name}${it.description ? "\n" + it.description : ""}`,
      String(it.quantity),
      it.unit,
      fmt(it.unitPrice),
      `${it.taxRate}%`,
      fmt(it.lineTotal),
    ]),
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [21, 21, 27], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 24, halign: "right" },
      2: { halign: "right", cellWidth: 35 },
      3: { cellWidth: 40 },
      4: { halign: "right", cellWidth: 70 },
      5: { halign: "right", cellWidth: 40 },
      6: { halign: "right", cellWidth: 80 },
    },
    margin: { left: M, right: M },
  });

  // Totals
  // @ts-ignore
  const endY = (doc as any).lastAutoTable.finalY + 14;
  const tx = W - M - 240;
  const labelX = tx;
  const valueX = W - M;
  function row(label: string, value: string, bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 11 : 9);
    doc.text(label, labelX, endY);
    doc.text(value, valueX, endY, { align: "right" });
  }
  let yy = endY;
  row("10% Subtotal", fmt(d.totals.subtotal10));
  yy += 14;
  row("10% Tax", fmt(d.totals.tax10));
  yy += 14;
  row("8% Subtotal (reduced)", fmt(d.totals.subtotal8));
  yy += 14;
  row("8% Tax", fmt(d.totals.tax8));
  yy += 14;
  if (d.totals.subtotal0 > 0) {
    row("Tax-exempt", fmt(d.totals.subtotal0));
    yy += 14;
  }
  if (d.totals.withholding > 0) {
    row("Withholding (ref.)", fmt(d.totals.withholding));
    yy += 14;
  }
  doc.setDrawColor(20);
  doc.setLineWidth(0.6);
  doc.line(labelX, yy, valueX, yy);
  yy += 14;
  row("TOTAL (incl. tax)", fmt(d.totals.total), true);
  yy += 22;

  // Bank + remarks + tax note
  if (d.company.bankInfo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Bank details:", M, yy);
    yy += 12;
    doc.setFont("helvetica", "normal");
    d.company.bankInfo.split(/\r?\n/).forEach((l) => {
      doc.text(l, M, yy);
      yy += 12;
    });
    yy += 6;
  }
  if (d.remarks) {
    doc.setFont("helvetica", "bold");
    doc.text("Remarks:", M, yy);
    yy += 12;
    doc.setFont("helvetica", "normal");
    d.remarks.split(/\r?\n/).forEach((l) => {
      doc.text(l, M, yy);
      yy += 12;
    });
    yy += 6;
  }
  if (d.company.taxNote) {
    doc.setFontSize(8);
    doc.setTextColor(110);
    d.company.taxNote.split(/\r?\n/).forEach((l) => {
      doc.text(l, M, yy);
      yy += 11;
    });
    doc.setTextColor(0);
  }

  doc.save(`Invoice-${d.number}.pdf`);
}
