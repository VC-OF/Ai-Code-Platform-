// Validation schemas for invoice forms
import { z } from "zod";

export const lineSchema = z.object({
  productId: z.string().optional().nullable(),
  name: z.string().min(1, "品目名は必須です"),
  description: z.string().optional().nullable(),
  quantity: z.coerce.number().int().min(1, "数量は1以上"),
  unit: z.string().default("個"),
  unitPrice: z.coerce.number().int().min(0, "単価は0以上"),
  taxRate: z.coerce.number().refine((v) => [0, 8, 10].includes(v), {
    message: "税率は 0 / 8 / 10 のいずれかです",
  }),
});

export const invoiceSchema = z.object({
  customerId: z.string().min(1, "顧客を選択してください"),
  issueDate: z.string().min(1, "発行日を入力してください"),
  dueDate: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  withholding: z.coerce.number().int().min(0).default(0),
  items: z.array(lineSchema).min(1, "明細を1行以上追加してください"),
});

export const customerSchema = z.object({
  name: z.string().min(1, "顧客名は必須です"),
  nameKana: z.string().optional().nullable(),
  honorific: z.string().default("御中"),
  postalCode: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  registrationNo: z.string().optional().nullable(),
  tel: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export const productSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1, "品目名は必須です"),
  description: z.string().optional().nullable(),
  unitPrice: z.coerce.number().int().min(0),
  taxRate: z.coerce.number().refine((v) => [0, 8, 10].includes(v)),
  unit: z.string().default("個"),
  active: z.coerce.boolean().default(true),
});

export const companySchema = z.object({
  name: z.string().min(1, "会社名は必須です"),
  nameEn: z.string().optional().nullable(),
  registrationNo: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  tel: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  bankInfo: z.string().optional().nullable(),
  logoText: z.string().optional().nullable(),
  taxNote: z.string().optional().nullable(),
  defaultTaxRate: z.coerce
    .number()
    .refine((v) => [0, 8, 10].includes(v))
    .default(10),
  invoicePrefix: z.string().min(1).default("IF"),
});
