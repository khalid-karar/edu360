"use client";
import { useCallback, useEffect, useState } from "react";
import { ErrorNote, Field, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { dayLabel, riyadhToIso, riyadhToday, timeLabel } from "../../../../lib/format";

interface Win { id: string; startsAt: string; endsAt: string }
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

export default function Availability() {
  return (
    <Shell roles={["teacher"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const [items, setItems] = useState<Win[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [f, setF] = useState({ date: riyadhToday(), from: "16:00", to: "20:00" });
  const load = useCallback(() => api<{ items: Win[] }>("GET", "/teacher/availability").then((r) => setItems(r.items)).catch(setErr), []);
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setErr(null);
    try {
      await api("POST", "/teacher/availability", { startsAt: riyadhToIso(f.date, f.from), endsAt: riyadhToIso(f.date, f.to) });
      await load();
    } catch (e) {
      setErr(e);
    }
  }
  async function del(id: string) {
    setErr(null);
    try {
      await api("DELETE", `/teacher/availability/${id}`);
      await load();
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <>
      <h1>أوقاتي المتاحة</h1>
      <p className="muted">أضف الفترات التي تستقبل فيها دروساً (توقيت الرياض). يقسّمها النظام إلى مواعيد من ساعة. يمكن الحجز قبل الموعد بساعتين وحتى 10 أيام قادمة.</p>
      <form className="card" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          <Field label="اليوم"><input type="date" value={f.date} min={riyadhToday()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="من"><select className="ltr" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>{TIMES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="إلى"><select className="ltr" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>{TIMES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        </div>
        <ErrorNote error={err} />
        <button className="btn">إضافة الفترة</button>
      </form>
      {!items ? <Spinner /> : items.length === 0 ? <div className="empty">لم تضف أوقاتاً بعد. بدونها لا يظهر لك مواعيد في البحث.</div> : (
        <div className="grid">
          {items.map((w) => (
            <div key={w.id} className="card tight row between">
              <div><b>{dayLabel(w.startsAt)}</b><div className="muted small">{timeLabel(w.startsAt)} – {timeLabel(w.endsAt)}</div></div>
              <button className="btn danger" onClick={() => del(w.id)}>حذف</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
