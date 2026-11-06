"use client";
import { useState } from "react";
import { ErrorNote, Field, Spinner } from "../portal-ui";
import { dateTime, sar } from "../../lib/format";
import { Tabs, useAct, useLoad } from "./common";

export function AdminConsole() {
  const [tab, setTab] = useState<"cats" | "audit">("cats");
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={[{ id: "cats", label: "التخصصات" }, { id: "audit", label: "سجل التدقيق" }]} />
      {tab === "cats" ? <Categories /> : <Audit />}
    </>
  );
}

interface Cat { id: number; slug: string; nameAr: string; nameEn: string; minPriceHalalas: number; maxPriceHalalas: number; allowsMinors: boolean; active: boolean }

function Categories() {
  const q = useLoad<{ items: Cat[] }>("/categories");
  const act = useAct();
  const [f, setF] = useState({ slug: "", nameAr: "", nameEn: "", min: "", max: "", minors: true });
  async function add() {
    const r = await act.run("POST", "/admin/categories", { slug: f.slug, nameAr: f.nameAr, nameEn: f.nameEn, minPriceHalalas: Math.round(Number(f.min) * 100), maxPriceHalalas: Math.round(Number(f.max) * 100), allowsMinors: f.minors });
    if (r) { setF({ slug: "", nameAr: "", nameEn: "", min: "", max: "", minors: true }); q.reload(); }
  }
  async function toggle(c: Cat, patch: Partial<Cat>) {
    if (await act.run("PATCH", `/admin/categories/${c.id}`, patch)) q.reload();
  }
  return (
    <>
      <p className="muted small">القائمة المعروضة هي التخصصات النشطة. تغيير نطاق السعر لا يغيّر أسعار المعلّمين الحالية.</p>
      <ErrorNote error={q.err} />
      {!q.data && !q.err && <Spinner />}
      <div className="grid">
        {q.data?.items.map((c) => (
          <div key={c.id} className="card tight stack">
            <div className="row between"><b>{c.nameAr}</b><span className="muted small ltr">{c.slug}</span></div>
            <span className="muted small">{sar(c.minPriceHalalas)} – {sar(c.maxPriceHalalas)} · {c.allowsMinors ? "يسمح بالقاصرين" : "للكبار فقط"}</span>
            <div className="row">
              <button className="btn ghost" disabled={act.busy} onClick={() => toggle(c, { allowsMinors: !c.allowsMinors })}>{c.allowsMinors ? "اجعله للكبار فقط" : "اسمح بالقاصرين"}</button>
              <button className="btn danger" disabled={act.busy} onClick={() => confirm("إيقاف هذا التخصص؟ يختفي من البحث.") && toggle(c, { active: false })}>إيقاف</button>
            </div>
          </div>
        ))}
      </div>
      <ErrorNote error={act.err} />
      <div className="card stack">
        <h3>تخصص جديد</h3>
        <Field label="المعرّف (إنجليزي صغير)"><input className="ltr" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
        <Field label="الاسم بالعربي"><input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
        <Field label="الاسم بالإنجليزي"><input className="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        <div className="row">
          <Field label="أقل سعر (ر.س)"><input inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
          <Field label="أعلى سعر (ر.س)"><input inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
        </div>
        <label className="row"><input type="checkbox" checked={f.minors} onChange={(e) => setF({ ...f, minors: e.target.checked })} /> يسمح بالقاصرين</label>
        <div><button className="btn" disabled={act.busy || !f.slug || !f.nameAr || !f.nameEn || !(Number(f.min) > 0) || !(Number(f.max) > 0)} onClick={add}>إضافة</button></div>
      </div>
    </>
  );
}

interface AuditItem { id: number; actorId: string | null; action: string; targetType: string; targetId: string; reason: string | null; at: string }
function Audit() {
  const [before, setBefore] = useState<number | undefined>(undefined);
  const q = useLoad<{ items: AuditItem[] }>(`/admin/audit-log?limit=30${before ? `&before=${before}` : ""}`);
  return (
    <>
      <ErrorNote error={q.err} />
      {!q.data && !q.err && <Spinner />}
      {q.data && (
        <>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="tbl"><thead><tr><th>الوقت</th><th>الإجراء</th><th>الهدف</th><th>السبب</th></tr></thead>
              <tbody>{q.data.items.map((a) => <tr key={a.id}><td>{dateTime(a.at)}</td><td className="ltr">{a.action}</td><td className="ltr">{a.targetType}:{a.targetId.slice(0, 8)}</td><td>{a.reason ?? ""}</td></tr>)}</tbody></table>
          </div>
          <div className="row">
            {before !== undefined && <button className="btn ghost" onClick={() => setBefore(undefined)}>الأحدث</button>}
            {q.data.items.length === 30 && <button className="btn ghost" onClick={() => setBefore(q.data!.items[q.data!.items.length - 1]!.id)}>الأقدم</button>}
          </div>
        </>
      )}
    </>
  );
}
