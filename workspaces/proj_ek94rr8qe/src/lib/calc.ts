// Money / tax calculation utilities (JPY, no decimals)

export const STANDARD_TAX = 10;
export const REDUCED_TAX = 8;
export const EXEMPT_TAX = 0;

export type InvoiceLineInput = {
  quantity: number;
  unitPrice: number; // JPY integer
  taxRate: number; // 10 | 8 | 0
};

export type InvoiceTotals = {
  subtotal10: number;
  subtotal8: number;
  subtotal0: number;
  tax10: number;
  tax8: number;
  total: number;
};

/**
 * Compute totals for a list of invoice line items, broken down by tax rate
 * (Japanese qualified invoice: 標準税率 / 軽減税率 / 非課税 split is required).
 */
export function computeTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  let subtotal10 = 0;
  let subtotal8 = 0;
  let subtotal0 = 0;

  for (const line of lines) {
    const lineTotal = Math.round(line.quantity * line.unitPrice);
    if (line.taxRate === 10) subtotal10 += lineTotal;
    else if (line.taxRate === 8) subtotal8 += lineTotal;
    else subtotal0 += lineTotal;
  }

  // Japanese consumption tax: floor on the taxable base, then multiply.
  // We use a simple integer rounding (tax = floor(base * rate / 100)).
  const tax10 = Math.floor((subtotal10 * 10) / 100);
  const tax8 = Math.floor((subtotal8 * 8) / 100);

  return {
    subtotal10,
    subtotal8,
    subtotal0,
    tax10,
    tax8,
    total: subtotal10 + subtotal8 + subtotal0 + tax10 + tax8,
  };
}

export function lineTotal(qty: number, price: number): number {
  return Math.round(qty * price);
}

export function formatJPY(n: number): string {
  if (Number.isNaN(n) || n === undefined || n === null) return "¥0";
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("ja-JP");
}

/**
 * Render a Japanese date in the standard "YYYY年M月D日" style.
 */
export function formatJPDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * Build the qualified-invoice registration-number string. Accepts either
 * raw digits (13) or the formatted "T1234567890123" form.
 */
export function formatRegistrationNo(raw?: string | null): string {
  if (!raw) return "";
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 13) return `T${digits}`;
  return raw;
}
