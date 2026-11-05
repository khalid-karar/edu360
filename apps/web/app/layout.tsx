import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Edu360 — منصة التعليم",
  description:
    "منصة عربية تجمع المعلمين الموثّقين من المنزل مع الطلاب، بدفع آمن وجلسات مسجّلة.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
