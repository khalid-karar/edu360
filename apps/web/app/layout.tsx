import type { Metadata } from "next";
import "@fontsource/tajawal/arabic-400.css";
import "@fontsource/tajawal/arabic-500.css";
import "@fontsource/tajawal/arabic-700.css";
import "@fontsource/tajawal/arabic-800.css";
import "@fontsource/tajawal/latin-400.css";
import "@fontsource/tajawal/latin-700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "منصة التعليم — علّم من بيتك",
  description:
    "منصة سعودية تربط المعلّمين الموثّقين من المنزل بالمتعلّمين، بدفع محمي وجلسات آمنة. سجّل اهتمامك الآن.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
