import { prisma } from "@/lib/prisma";
import { formatJPY } from "@/lib/calc";
import ProductManager from "./ProductManager";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">品目マスタ</h1>
        <p className="text-ink-500 text-sm mt-1">
          商品・サービス・軽減税率対象品目などの登録
        </p>
      </header>
      <ProductManager
        initial={products.map((p) => ({
          id: p.id,
          code: p.code ?? "",
          name: p.name,
          description: p.description ?? "",
          unitPrice: p.unitPrice,
          taxRate: p.taxRate,
          unit: p.unit,
          active: p.active,
          priceLabel: formatJPY(p.unitPrice),
        }))}
      />
    </div>
  );
}
