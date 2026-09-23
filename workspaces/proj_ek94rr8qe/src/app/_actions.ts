"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { customerSchema, productSchema, companySchema } from "@/lib/schemas";

export async function createCustomerAction(_: any, fd: FormData) {
  const data = JSON.parse(String(fd.get("payload") || "{}"));
  const p = customerSchema.safeParse(data);
  if (!p.success)
    return { ok: false, error: p.error.issues[0]?.message ?? "Invalid" };
  await prisma.customer.create({
    data: { ...p.data, nameKana: p.data.nameKana ?? null } as any,
  });
  revalidatePath("/customers");
  return { ok: true };
}
export async function updateCustomerAction(id: string, _: any, fd: FormData) {
  const data = JSON.parse(String(fd.get("payload") || "{}"));
  const p = customerSchema.safeParse(data);
  if (!p.success)
    return { ok: false, error: p.error.issues[0]?.message ?? "Invalid" };
  await prisma.customer.update({ where: { id }, data: p.data as any });
  revalidatePath("/customers");
  return { ok: true };
}
export async function deleteCustomerAction(id: string) {
  const count = await prisma.invoice.count({ where: { customerId: id } });
  if (count > 0)
    return {
      ok: false,
      error: `この顧客は ${count} 件の請求書に紐づいているため削除できません。`,
    };
  await prisma.customer.delete({ where: { id } });
  revalidatePath("/customers");
  return { ok: true };
}

export async function createProductAction(_: any, fd: FormData) {
  const data = JSON.parse(String(fd.get("payload") || "{}"));
  const p = productSchema.safeParse(data);
  if (!p.success)
    return { ok: false, error: p.error.issues[0]?.message ?? "Invalid" };
  await prisma.product.create({ data: p.data as any });
  revalidatePath("/products");
  return { ok: true };
}
export async function updateProductAction(id: string, _: any, fd: FormData) {
  const data = JSON.parse(String(fd.get("payload") || "{}"));
  const p = productSchema.safeParse(data);
  if (!p.success)
    return { ok: false, error: p.error.issues[0]?.message ?? "Invalid" };
  await prisma.product.update({ where: { id }, data: p.data as any });
  revalidatePath("/products");
  return { ok: true };
}
export async function deleteProductAction(id: string) {
  const used = await prisma.invoiceItem.count({ where: { productId: id } });
  if (used > 0) {
    // Soft-disable instead of hard delete to preserve history.
    await prisma.product.update({ where: { id }, data: { active: false } });
    revalidatePath("/products");
    return { ok: true, soft: true };
  }
  await prisma.product.delete({ where: { id } });
  revalidatePath("/products");
  return { ok: true };
}

export async function updateCompanyAction(_: any, fd: FormData) {
  const data = JSON.parse(String(fd.get("payload") || "{}"));
  const p = companySchema.safeParse(data);
  if (!p.success)
    return { ok: false, error: p.error.issues[0]?.message ?? "Invalid" };
  const existing = await prisma.company.findFirst();
  if (existing) {
    await prisma.company.update({
      where: { id: existing.id },
      data: p.data as any,
    });
  } else {
    await prisma.company.create({ data: p.data as any });
  }
  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}
