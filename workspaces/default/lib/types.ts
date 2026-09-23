export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  company?: string;
  phone?: string;
  address?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientAddress?: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  items: LineItem[];
  notes?: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  businessName: string;
  businessEmail: string;
  businessAddress: string;
  businessPhone: string;
  taxRate: number;
  currency: string;
  invoicePrefix: string;
  nextInvoiceNumber: number;
}
