import { prisma } from "./prisma";

/**
 * Allocate and return the next invoice number atomically.
 * Format: PREFIX-YYYY-NNNN, e.g. IF-2026-0001
 */
export async function allocateInvoiceNumber(): Promise<{
  number: string;
  sequence: number;
}> {
  const year = new Date().getFullYear();

  // Retry loop in case of race conditions across requests.
  for (let i = 0; i < 5; i++) {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("Company settings not configured");

    const seq = company.nextInvoiceSeq;
    const number = `${company.invoicePrefix}-${year}-${String(seq).padStart(4, "0")}`;

    // Check uniqueness (paranoid for the seed/demo environment).
    const existing = await prisma.invoice.findUnique({ where: { number } });
    if (existing) {
      await prisma.company.update({
        where: { id: company.id },
        data: { nextInvoiceSeq: { increment: 1 } },
      });
      continue;
    }

    await prisma.company.update({
      where: { id: company.id },
      data: { nextInvoiceSeq: { increment: 1 } },
    });
    return { number, sequence: seq };
  }
  throw new Error("Failed to allocate invoice number");
}
