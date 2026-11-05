"use client";
import { useState } from "react";

const URL = "https://edu360sa.netlify.app";
const TEXT = "عندك علم؟ خلّه يشتغل لك. منصة عِلمك قريباً، سجّلت اهتمامي وأنت كمان:";

export default function ShareButtons() {
  const [copied, setCopied] = useState(false);
  const wa = `https://wa.me/?text=${encodeURIComponent(`${TEXT} ${URL}`)}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(URL);
      setCopied(true);
    } catch {
      window.prompt("انسخ الرابط", URL);
    }
  }
  return (
    <div className="share">
      <p>تعرف أحداً عنده مهارة؟ أرسل له الرابط.</p>
      <div className="cta-row" style={{ justifyContent: "center" }}>
        <a className="btn primary" href={wa} target="_blank" rel="noopener noreferrer">
          شارك عبر واتساب
        </a>
        <button className="btn outline" type="button" onClick={copy}>
          {copied ? "تم النسخ ✓" : "انسخ الرابط"}
        </button>
      </div>
    </div>
  );
}
