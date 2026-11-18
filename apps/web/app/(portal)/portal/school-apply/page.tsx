"use client";
import { useState } from "react";
import { ErrorNote, Field } from "../../../../components/portal-ui";
import { api, errorText } from "../../../../lib/api";

function phone05(raw: string): string {
  const d = raw.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[^\d+]/g, "");
  if (/^\+9665\d{8}$/.test(d)) return d;
  if (/^05\d{8}$/.test(d)) return `+966${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `+966${d}`;
  return d;
}

export default function SchoolApply() {
  const [f, setF] = useState({ name: "", city: "", contactName: "", mobile: "", licenseNo: "", students: "" });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const mobile = phone05(f.mobile);
  const valid = f.name.trim().length >= 3 && f.city.trim().length >= 2 && f.contactName.trim().length >= 3 && /^\+9665\d{8}$/.test(mobile);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", "/schools/apply", {
        name: f.name.trim(), city: f.city.trim(), contactName: f.contactName.trim(), contactMobile: mobile,
        ...(f.licenseNo.trim() ? { licenseNo: f.licenseNo.trim() } : {}),
        ...(Number(f.students) > 0 ? { studentEstimate: Math.round(Number(f.students)) } : {}),
      });
      setDone(true);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-brand">عِلمك<small>قناة المدارس</small></div>
        <div className="card stack">
          {done ? (
            <>
              <h2>وصلنا طلبك</h2>
              <p>سنراجع الطلب ونتواصل مع المسؤول على الجوال المسجّل. بعد الاعتماد تحصل المدرسة على رمز تشاركه مع أولياء الأمور.</p>
            </>
          ) : (
            <>
              <h2>سجّل مدرستك</h2>
              <p className="muted small">تصلك أرقام مجمّعة فقط عن الأسر التي جاءت عبر مدرستك، دون أي بيانات شخصية للطلاب.</p>
              <Field label="اسم المدرسة"><input value={f.name} onChange={set("name")} maxLength={120} /></Field>
              <Field label="المدينة"><input value={f.city} onChange={set("city")} maxLength={60} /></Field>
              <Field label="اسم المسؤول"><input value={f.contactName} onChange={set("contactName")} maxLength={80} /></Field>
              <Field label="جوال المسؤول" hint="يكون هو رقم الدخول بعد الاعتماد"><input className="ltr" inputMode="tel" placeholder="05XXXXXXXX" value={f.mobile} onChange={set("mobile")} /></Field>
              <Field label="رقم الترخيص (اختياري)"><input className="ltr" value={f.licenseNo} onChange={set("licenseNo")} maxLength={40} /></Field>
              <Field label="عدد الطلاب التقريبي (اختياري)"><input inputMode="numeric" value={f.students} onChange={set("students")} /></Field>
              <ErrorNote error={err} />
              <button className="btn block" disabled={busy || !valid} onClick={submit}>إرسال الطلب</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
