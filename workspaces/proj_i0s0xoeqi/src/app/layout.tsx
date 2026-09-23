import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "日本語試験プラットフォーム | Japanese Exam Platform",
  description:
    "Secure web-based Japanese language examination platform with real-time monitoring, anti-cheating, and detailed reports.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-kinari text-sumi-900 min-h-screen">{children}</body>
    </html>
  );
}
