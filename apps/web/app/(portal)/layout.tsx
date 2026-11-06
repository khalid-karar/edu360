import type { Metadata } from "next";
import "@fontsource/tajawal/arabic-400.css";
import "@fontsource/tajawal/arabic-500.css";
import "@fontsource/tajawal/arabic-700.css";
import "@fontsource/tajawal/arabic-800.css";
import "@fontsource/tajawal/latin-400.css";
import "@fontsource/tajawal/latin-700.css";
import "@fontsource/reem-kufi/arabic-500.css";
import "@fontsource/reem-kufi/arabic-700.css";
import "./portal.css";

export const metadata: Metadata = { title: "عِلمك | حسابي", robots: { index: false } };

/** Its own root layout: the portal does not load the landing page stylesheet, so class names cannot collide. */
export default function PortalRoot({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
