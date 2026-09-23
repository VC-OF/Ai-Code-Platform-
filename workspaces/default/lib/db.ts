import fs from "fs";
import path from "path";
import { Client, Invoice, Settings } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(name: string) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJSON<T>(name: string, fallback: T): T {
  ensureDir();
  const p = filePath(name);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(name: string, data: T) {
  ensureDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

export function getInvoices(): Invoice[] {
  return readJSON<Invoice[]>("invoices", []);
}

export function saveInvoices(invoices: Invoice[]) {
  writeJSON("invoices", invoices);
}

export function getClients(): Client[] {
  return readJSON<Client[]>("clients", []);
}

export function saveClients(clients: Client[]) {
  writeJSON("clients", clients);
}

export function getSettings(): Settings {
  return readJSON<Settings>("settings", {
    businessName: "Acme Studio",
    businessEmail: "billing@acmestudio.com",
    businessAddress: "123 Market Street, San Francisco, CA 94103",
    businessPhone: "+1 (555) 010-2030",
    taxRate: 8.5,
    currency: "USD",
    invoicePrefix: "INV",
    nextInvoiceNumber: 1001,
  });
}

export function saveSettings(settings: Settings) {
  writeJSON("settings", settings);
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
