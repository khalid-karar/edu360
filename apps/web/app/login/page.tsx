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
    <main className="lg">
      <aside className="lg-brand">
        <div className="lg-logo">عِلمك<i>تجريبي</i></div>
        <div className="lg-hero">
          <h2 className="lg-word">علمك</h2>
          <p className="lg-tag">علمك يجيب دخل</p>
        </div>
        <div className="lg-ticket" aria-hidden="true">
          <b>حصة تجويد · الأحد ٨:٠٠ م</b>
          <small>٦٠ ر.س محجوزة حتى تنتهي الحصة</small>
          <div className="lg-steps"><span className="on">محجوز</span><hr /><span>الحصة</span><hr /><span>تحويل للمعلّم</span></div>
        </div>
      </aside>

      <section className="lg-form">
        {!r ? (
          <>
            <a className="lg-back" href="/">العودة للرئيسية</a>
            <h1>ادخل بحساب تجريبي</h1>
            <p className="lg-sub">اختر دورًا لترى المنصة من زاويته. كل الحسابات جاهزة، ولا تحتاج كلمة مرور.</p>
            <ul className="lg-roles">
              {ROLES.map((x) => (
                <li key={x.key}>
                  <button className="lg-role" onClick={() => { setRole(x.key); setSent(null); setErr(""); }}>
                    <span className="lg-av" data-k={x.key}>{x.who.replace(/^أ\. /, "").slice(0, 1)}</span>
                    <span><b>{x.ar}</b><small>{x.blurb}</small></span>
                    <em>{x.en}</em>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <button className="lg-back" onClick={() => { setRole(null); setSent(null); setErr(""); }}>تغيير الدور</button>
            <div className="lg-chosen">
              <span className="lg-av" data-k={r.key}>{r.who.replace(/^أ\. /, "").slice(0, 1)}</span>
              <div><h1 style={{ fontSize: "1.6rem", margin: 0 }}>{r.who}</h1><span className="lg-phone">{r.phone}</span></div>
            </div>
            {!sent ? (
              <>
                <p className="lg-sub">سنرسل رمز تحقق إلى هذا الرقم، وهو رقم تجريبي.</p>
                <button className="lg-go" onClick={send}>إرسال رمز التحقق</button>
              </>
            ) : (
              <>
                <p className="lg-hint">رمز تجريبي: <b dir="ltr">{sent}</b>. في النسخة الحقيقية يصل الرمز برسالة SMS إلى جوالك فقط.</p>
                <label className="lg-label" htmlFor="otp">رمز التحقق</label>
                <input id="otp" className="lg-otp" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" />
                <button className="lg-go" onClick={verify}>دخول</button>
              </>
            )}
            {err && <p className="err" role="alert">{err}</p>}
          </>
        )}
        <p className="lg-foot">نسخة تجريبية: البيانات وهمية، والدفع والرسائل والهوية الوطنية محاكاة.</p>
      </section>
    </main>
  );
}
