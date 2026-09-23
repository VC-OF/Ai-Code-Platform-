import { prisma } from "@/lib/prisma";
import { formatRegistrationNo } from "@/lib/calc";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const company = await prisma.company.findFirst();
  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">会社設定</h1>
        <p className="text-ink-500 text-sm mt-1">
          発行元（適格請求書発行事業者）の情報
        </p>
      </header>
      <SettingsForm
        initial={{
          name: company?.name ?? "",
          nameEn: company?.nameEn ?? "",
          registrationNo: formatRegistrationNo(company?.registrationNo),
          postalCode: company?.postalCode ?? "",
          address: company?.address ?? "",
          tel: company?.tel ?? "",
          email: company?.email ?? "",
          bankInfo: company?.bankInfo ?? "",
          logoText: company?.logoText ?? "",
          taxNote: company?.taxNote ?? "",
          defaultTaxRate: company?.defaultTaxRate ?? 10,
          invoicePrefix: company?.invoicePrefix ?? "IF",
        }}
        nextInvoiceSeq={company?.nextInvoiceSeq ?? 1}
      />
    </div>
  );
}
