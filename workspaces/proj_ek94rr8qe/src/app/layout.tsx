import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Ideal Folks 請求書システム",
  description: "適格請求書 (インボイス) 発行システム — Ideal Folks Inc.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="min-h-screen flex">
          <aside className="w-60 border-r border-ink-100 bg-white p-4 hidden md:flex flex-col no-print">
            <div className="px-2 mb-6">
              <div className="text-xs text-ink-500 tracking-widest">
                INVOICE
              </div>
              <div className="text-lg font-semibold">Ideal Folks</div>
              <div className="text-xs text-ink-500 mt-0.5">
                適格請求書システム
              </div>
            </div>
            <nav className="flex flex-col gap-1">
              <Link className="nav-link" href="/">
                📊 ダッシュボード
              </Link>
              <Link className="nav-link" href="/invoices">
                🧾 請求書一覧
              </Link>
              <Link className="nav-link" href="/invoices/new">
                ➕ 新規請求書
              </Link>
              <Link className="nav-link" href="/customers">
                👥 顧客管理
              </Link>
              <Link className="nav-link" href="/products">
                📦 品目マスタ
              </Link>
              <Link className="nav-link" href="/settings">
                ⚙️ 会社設定
              </Link>
            </nav>
            <div className="mt-auto text-[11px] text-ink-500 px-2 leading-relaxed">
              © {new Date().getFullYear()} Ideal Folks Inc.
              <br />
              適格請求書発行事業者
            </div>
          </aside>
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
