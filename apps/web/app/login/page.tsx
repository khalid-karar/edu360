"use client";
import { useState } from "react";
import "../demo.css";
import { ROLES, type RoleKey } from "../demo-data";
import { api, setSession } from "../demo-session";

export default function Login() {
  const [role, setRole] = useState<RoleKey | null>(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const r = ROLES.find((x) => x.key === role);

  async function send() {
    if (!r) return;
    setErr("");
    const res = await api<{ ok: boolean; mock_code?: string }>("/api/auth/otp/request", { phone: r.phone });
    const c = res?.mock_code ?? "123456"; // offline fallback when the API is not reachable
    setSent(c);
    setCode(c);
  }
  async function verify() {
    if (!r) return;
    const res = await api<{ ok: boolean }>("/api/auth/otp/verify", { phone: r.phone, code });
    if (res && !res.ok) return setErr("الرمز غير صحيح");
    setSession({ role: r.key, name: r.who, phone: r.phone });
    window.location.href = `/dashboard/${r.key}`;
  }

  return (
    <main className="demo-login">
      <a className="back" href="/">← العودة للرئيسية</a>
      <div className="demo-banner">نسخة تجريبية — كل البيانات وهمية، والدفع والرسائل والهوية الوطنية محاكاة.</div>
      <h1>تسجيل الدخول</h1>
      <p className="sub">اختر دورك لتجرّب المنصة بحساب تجريبي جاهز.</p>

      <div className="role-grid">
        {ROLES.map((x) => (
          <button key={x.key} className={"role-card" + (role === x.key ? " on" : "")} onClick={() => { setRole(x.key); setSent(null); setErr(""); }}>
            <span className="ico">{x.icon}</span>
            <b>{x.ar}</b>
            <small>{x.en}</small>
            <span className="bl">{x.blurb}</span>
          </button>
        ))}
      </div>

      {r && (
        <section className="otp-box">
          <h2>{r.who}</h2>
          <label>رقم الجوال (تجريبي)
            <input value={r.phone} readOnly dir="ltr" />
          </label>
          {!sent ? (
            <button className="btn primary dark" onClick={send}>إرسال رمز التحقق</button>
          ) : (
            <>
              <p className="hint">رسالة SMS وهمية: رمزك هو <b dir="ltr">{sent}</b> (في النسخة الحقيقية يصل لجوالك فقط).</p>
              <label>رمز التحقق
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" dir="ltr" />
              </label>
              <button className="btn primary dark" onClick={verify}>دخول</button>
            </>
          )}
          {err && <p className="err">{err}</p>}
        </section>
      )}
    </main>
  );
}
