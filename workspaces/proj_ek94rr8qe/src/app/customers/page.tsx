import { prisma } from "@/lib/prisma";
import { formatRegistrationNo } from "@/lib/calc";
import CustomerManager from "./CustomerManager";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { invoices: true } } },
  });
  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">顧客管理</h1>
        <p className="text-ink-500 text-sm mt-1">
          請求書の宛先となる顧客の登録・編集
        </p>
      </header>
      <CustomerManager
        initial={customers.map((c) => ({
          id: c.id,
          name: c.name,
          nameKana: c.nameKana ?? "",
          honorific: c.honorific,
          postalCode: c.postalCode ?? "",
          address: c.address ?? "",
          registrationNo: formatRegistrationNo(c.registrationNo),
          tel: c.tel ?? "",
          email: c.email ?? "",
          note: c.note ?? "",
          invoiceCount: c._count.invoices,
        }))}
      />
    </div>
  );
}
