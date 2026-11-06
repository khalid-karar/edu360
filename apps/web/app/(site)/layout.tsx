import type { Metadata } from "next";
import "@fontsource/tajawal/arabic-400.css";
import "@fontsource/tajawal/arabic-500.css";
import "@fontsource/tajawal/arabic-700.css";
import "@fontsource/tajawal/arabic-800.css";
import "@fontsource/tajawal/latin-400.css";
import "@fontsource/tajawal/latin-700.css";
import "@fontsource/reem-kufi/arabic-500.css";
import "@fontsource/reem-kufi/arabic-700.css";
import "./globals.css";

const SITE = "https://edu360sa.netlify.app"; // update when the real domain is live

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  openGraph: {
    title: "عِلمك | Ilmak — علمك يجيب دخل",
    description: "عندك علم؟ خلّه يشتغل لك. منصة سعودية للتعليم من المنزل، قريباً.",
    locale: "ar_SA",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  title: "عِلمك | Ilmak — علمك يجيب دخل",
  description:
    "عِلمك: منصة سعودية تربط المعلّمين الموثّقين من المنزل بالمتعلّمين، بدفع محمي وجلسات آمنة. عندك علم؟ خلّه يشتغل لك. سجّل اهتمامك الآن.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
