"use client";
import { useCallback, useEffect, useState } from "react";
import { Avatar, ErrorNote, Field, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { dayLabel } from "../../../../lib/format";

interface Child { id: string; displayName: string; birthYear: number; age: number; gender: "female" | "male" }
interface Approval { teacherId: string; displayName: string; allowCrossGender: boolean; approvedAt: string }

export default function Children() {
  return (
    <Shell roles={["guardian"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const [kids, setKids] = useState<Child[] | null>(null);
  const [apps, setApps] = useState<Approval[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [form, setForm] = useState({ displayName: "", birthYear: "", gender: "male" });
  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([api<{ items: Child[] }>("GET", "/guardian/children"), api<{ items: Approval[] }>("GET", "/guardian/approvals")]);
      setKids(c.items);
      setApps(a.items);
    } catch (e) {
      setErr(e);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setErr(null);
    try {
      await api("POST", "/guardian/children", { displayName: form.displayName.trim(), birthYear: Number(form.birthYear), gender: form.gender });
      setForm({ displayName: "", birthYear: "", gender: "male" });
      await load();
    } catch (e) {
      setErr(e);
    }
  }
  async function revoke(id: string) {
    if (!window.confirm("سحب الاعتماد يغلق المحادثة فوراً ويمنع أي حجز جديد مع هذا المعلّم. متابعة؟")) return;
    try {
      await api("DELETE", `/guardian/approvals/${id}`);
      await load();
    } catch (e) {
      setErr(e);
    }
  }

  const year = new Date().getFullYear();
  return (
    <>
      <h1>الأبناء</h1>
      <p className="muted">لا يملك الطفل حساباً ولا جوالاً. أنت من يحجز ويدفع ويتواصل مع المعلّم، وتظهر لك كل المحادثات.</p>
      <ErrorNote error={err} />
      {!kids ? <Spinner /> : (
        <div className="grid">
          {kids.map((k) => (
            <div key={k.id} className="card tight row">
              <Avatar name={k.displayName} />
              <div><h3>{k.displayName}</h3><span className="muted small">{k.age} سنة · {k.gender === "female" ? "بنت" : "ولد"}</span></div>
            </div>
          ))}
          {kids.length === 0 && <div className="empty">لم تُضف أي طفل بعد.</div>}
        </div>
      )}
      {kids && kids.length < 6 && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <h2>إضافة طفل</h2>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Field label="الاسم"><input value={form.displayName} maxLength={40} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
            <Field label="سنة الميلاد" hint={`بين ${year - 17} و ${year - 4}`}><input className="ltr" inputMode="numeric" maxLength={4} value={form.birthYear} onChange={(e) => setForm({ ...form, birthYear: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="الجنس">
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="male">ولد</option><option value="female">بنت</option>
              </select>
            </Field>
          </div>
          <button className="btn" disabled={form.displayName.trim().length < 2 || form.birthYear.length !== 4}>إضافة</button>
        </form>
      )}

      <h2>المعلّمون المعتمدون</h2>
      {apps && apps.length === 0 && <div className="empty">لم تعتمد أي معلّم بعد. تعتمد المعلّم من صفحته عند أول حجز لطفلك.</div>}
      <div className="grid">
        {apps?.map((a) => (
          <div key={a.teacherId} className="card tight">
            <div className="row between"><h3>{a.displayName}</h3><button className="btn danger" onClick={() => revoke(a.teacherId)}>سحب</button></div>
            <span className="muted small">اعتُمد {dayLabel(a.approvedAt)}{a.allowCrossGender ? " · سمحت بالجنس الآخر" : ""}</span>
          </div>
        ))}
      </div>
    </>
  );
}
