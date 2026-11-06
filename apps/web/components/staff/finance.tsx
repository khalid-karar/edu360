"use client";
import { useState } from "react";
import { ErrorNote, Field, Spinner } from "../portal-ui";
import { dateTime, sar } from "../../lib/format";
import { Tabs, useAct, useLoad } from "./common";

export function FinanceConsole({ meId }: { meId: string }) {
  const [tab, setTab] = useState<"disputes" | "run" | "payouts">("disputes");
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={[{ id: "disputes", label: "الاعتراضات" }, { id: "run", label: "دفعة التحويل" }, { id: "payouts", label: "التحويلات" }]} />
      {tab === "disputes" && <Disputes />}
      {tab === "run" && <Run />}
      {tab === "payouts" && <Payouts meId={meId} />}
    </>
  );
}

interface DItem { id: string; reason: string; openedAt: string; outcome: string | null; refundHalalas: number; capturedHalalas: number }
const OUTCOME: Record<string, string> = { full_refund: "استرداد كامل", partial_refund: "استرداد جزئي", release_to_teacher: "تحرير للمعلّم" };

function Disputes() {
  const [status, setStatus] = useState<"open" | "decided">("open");
  const [sel, setSel] = useState<string | null>(null);
  const q = useLoad<{ items: DItem[] }>(sel ? null : `/admin/finance/disputes?status=${status}`);
  if (sel) return <Dispute id={sel} onBack={() => setSel(null)} />;
  return (
    <>
      <Tabs value={status} onChange={setStatus} items={[{ id: "open", label: "مفتوحة" }, { id: "decided", label: "محسومة" }]} />
      <ErrorNote error={q.err} />
      {!q.data && !q.err && <Spinner />}
      {q.data?.items.length === 0 && <div className="empty">لا اعتراضات.</div>}
      <div className="grid">
        {q.data?.items.map((d) => (
          <button key={d.id} className="card tight click" onClick={() => setSel(d.id)}>
            <div className="row between"><b>{sar(d.capturedHalalas)}</b>{d.outcome && <span className="badge done">{OUTCOME[d.outcome] ?? d.outcome}</span>}</div>
            <span>{d.reason.slice(0, 90)}</span>
            <span className="muted small">{dateTime(d.openedAt)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

interface DD {
  id: string; reason: string; outcome: string | null; note: string | null; openedAt: string;
  booking: { id: string; status: string; startsAt: string; priceHalalas: number; teacher: string; payer: string };
  payment: { capturedHalalas: number; commissionHalalas: number; refundedHalalas: number; paidOut: boolean };
}
function Dispute({ id, onBack }: { id: string; onBack: () => void }) {
  const d = useLoad<DD>(`/admin/finance/disputes/${id}`);
  const act = useAct();
  const [outcome, setOutcome] = useState("full_refund");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  if (!d.data) return <><ErrorNote error={d.err} />{!d.err && <Spinner />}<button className="btn ghost" onClick={onBack}>رجوع</button></>;
  const x = d.data;
  const partial = Math.round(Number(amount) * 100);
  async function decide() {
    if (!confirm(`تأكيد: ${OUTCOME[outcome]}؟ يُنفَّذ الاسترداد لدى مزوّد الدفع فوراً.`)) return;
    const body = outcome === "partial_refund" ? { outcome, refundHalalas: partial, note: note.trim() } : { outcome, note: note.trim() };
    if (await act.run("POST", `/admin/finance/disputes/${id}/decide`, body)) d.reload();
  }
  return (
    <>
      <button className="btn ghost" onClick={onBack}>→ رجوع</button>
      <h2>اعتراض</h2>
      <div className="card stack">
        <p>{x.reason}</p>
        <span className="muted small">الدرس: {dateTime(x.booking.startsAt)} · المعلّم {x.booking.teacher} · الدافع {x.booking.payer} · الحالة {x.booking.status}</span>
        <div className="row wrap">
          <span className="chip">المحصَّل {sar(x.payment.capturedHalalas)}</span>
          <span className="chip">العمولة {sar(x.payment.commissionHalalas)}</span>
          <span className="chip">المسترد {sar(x.payment.refundedHalalas)}</span>
          {x.payment.paidOut && <span className="badge bad">حُوّل للمعلّم مسبقاً</span>}
        </div>
      </div>
      {x.outcome ? (
        <div className="note info">القرار: {OUTCOME[x.outcome] ?? x.outcome}{x.note ? ` — ${x.note}` : ""}</div>
      ) : (
        <div className="card stack">
          <Field label="القرار">
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {outcome === "partial_refund" && <Field label="مبلغ الاسترداد (ر.س)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
          <Field label="سبب القرار" hint="10 أحرف على الأقل. يُحفظ في السجل."><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <ErrorNote error={act.err} />
          <div><button className="btn coral" disabled={act.busy || note.trim().length < 10 || (outcome === "partial_refund" && !(partial > 0))} onClick={decide}>تنفيذ القرار</button></div>
        </div>
      )}
    </>
  );
}

interface Preview { batches: { teacherId: string; paymentIds: string[]; amount: number; needsReview: boolean }[]; skipped: Record<string, number> }
const SKIP: Record<string, string> = { in_dispute_window: "ضمن مهلة الاعتراض", disputed: "عليها اعتراض", teacher_frozen: "معلّم محوّلاته مجمّدة", new_teacher_hold: "معلّم جديد (14 يوماً)", unknown_teacher: "معلّم غير معروف", nothing_to_pay: "لا مبلغ" };
function Run() {
  const p = useLoad<Preview>("/admin/finance/payout-runs/preview");
  const act = useAct();
  const [made, setMade] = useState<number | null>(null);
  async function create() {
    if (!confirm("إنشاء دفعة تحويلات بهذه المبالغ؟")) return;
    const r = (await act.run("POST", "/admin/finance/payout-runs")) as { payouts: unknown[] } | undefined;
    if (r) { setMade(r.payouts.length); p.reload(); }
  }
  if (!p.data) return <><ErrorNote error={p.err} />{!p.err && <Spinner />}</>;
  const total = p.data.batches.reduce((a, b) => a + b.amount, 0);
  const skipped = Object.entries(p.data.skipped).filter(([, n]) => n > 0);
  return (
    <>
      {made !== null && <div className="note info">أُنشئت {made} تحويلات. تجدها في تبويب التحويلات.</div>}
      <div className="card stack">
        <b>{p.data.batches.length} معلّم · {sar(total)}</b>
        {p.data.batches.length === 0 && <span className="muted">لا شيء جاهز للتحويل الآن.</span>}
        {p.data.batches.map((b) => (
          <div key={b.teacherId} className="row between"><span className="muted small ltr">{b.teacherId.slice(0, 8)}</span><span>{sar(b.amount)} · {b.paymentIds.length} دفعة</span>{b.needsReview && <span className="badge wait">أول تحويل: يحتاج موافقة ثانية</span>}</div>
        ))}
        {skipped.length > 0 && <span className="muted small">مستبعد: {skipped.map(([k, n]) => `${SKIP[k] ?? k} (${n})`).join("، ")}</span>}
      </div>
      <ErrorNote error={act.err} />
      <div><button className="btn coral" disabled={act.busy || p.data.batches.length === 0} onClick={create}>إنشاء الدفعة</button></div>
    </>
  );
}

interface PItem { id: string; teacherName: string; amountHalalas: number; status: string; needsReview: boolean; createdAt: string; createdBy: string | null }
const PST: Record<string, string> = { pending: "بانتظار الاعتماد", approved: "معتمد", on_hold: "معلّق", paid: "تم التحويل", failed: "فشل" };
function Payouts({ meId }: { meId: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const q = useLoad<{ items: PItem[] }>(sel ? null : "/admin/finance/payouts");
  if (sel) return <Payout id={sel} meId={meId} onBack={() => setSel(null)} />;
  return (
    <>
      <ErrorNote error={q.err} />
      {!q.data && !q.err && <Spinner />}
      {q.data?.items.length === 0 && <div className="empty">لا تحويلات.</div>}
      <div className="grid">
        {q.data?.items.map((o) => (
          <button key={o.id} className="card tight click" onClick={() => setSel(o.id)}>
            <div className="row between"><b>{sar(o.amountHalalas)}</b><span className="badge wait">{PST[o.status] ?? o.status}</span></div>
            <span>{o.teacherName}</span>
            <span className="muted small">{dateTime(o.createdAt)}{o.needsReview ? " · أول تحويل" : ""}</span>
          </button>
        ))}
      </div>
    </>
  );
}

interface PD {
  id: string; amountHalalas: number; status: string; needsReview: boolean; note: string | null; bankReference: string | null;
  teacher: { displayName: string; iban: string | null; holderName: string | null };
  lines: { bookingId: string; capturedHalalas: number; refundedHalalas: number; commissionHalalas: number }[];
}
function Payout({ id, meId, onBack }: { id: string; meId: string; onBack: () => void }) {
  const d = useLoad<PD>(`/admin/finance/payouts/${id}`);
  const act = useAct();
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  if (!d.data) return <><ErrorNote error={d.err} />{!d.err && <Spinner />}<button className="btn ghost" onClick={onBack}>رجوع</button></>;
  const o = d.data;
  async function go(path: string, body?: unknown) {
    if (await act.run("POST", `/admin/finance/payouts/${id}/${path}`, body)) { setNote(""); setRef(""); d.reload(); }
  }
  return (
    <>
      <button className="btn ghost" onClick={onBack}>→ رجوع</button>
      <h2>{sar(o.amountHalalas)} — {o.teacher.displayName}</h2>
      <div className="card stack">
        <div className="row"><span className="badge wait">{PST[o.status] ?? o.status}</span>{o.needsReview && <span className="badge wait">أول تحويل للمعلّم</span>}</div>
        <span className="muted small">الآيبان ظاهر هنا فقط، وفتح هذه الصفحة مسجَّل في سجل التدقيق.</span>
        <div><b>صاحب الحساب:</b> {o.teacher.holderName ?? "—"}</div>
        <div className="ltr"><b>IBAN:</b> {o.teacher.iban ?? "—"}</div>
        {o.bankReference && <div><b>مرجع التحويل:</b> {o.bankReference}</div>}
        {o.note && <div className="muted">{o.note}</div>}
        <table className="tbl"><thead><tr><th>محصَّل</th><th>مسترد</th><th>عمولة</th></tr></thead>
          <tbody>{o.lines.map((l) => <tr key={l.bookingId}><td>{sar(l.capturedHalalas)}</td><td>{sar(l.refundedHalalas)}</td><td>{sar(l.commissionHalalas)}</td></tr>)}</tbody></table>
      </div>
      <ErrorNote error={act.err} />
      {(o.status === "pending" || o.status === "on_hold") && (
        <div className="card stack">
          {o.status === "pending" && <div><button className="btn" disabled={act.busy} onClick={() => go("approve")}>اعتماد</button></div>}
          <Field label="ملاحظة (للتعليق أو الفشل)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row">
            {o.status === "pending" && <button className="btn ghost" disabled={act.busy || note.trim().length < 5} onClick={() => go("hold", { note: note.trim() })}>تعليق</button>}
            <button className="btn danger" disabled={act.busy || note.trim().length < 5} onClick={() => go("fail", { note: note.trim() })}>تعذّر التحويل</button>
          </div>
          {o.needsReview && <p className="muted small">اعتماد أول تحويل يجب أن يتم من موظف غير الذي أنشأ الدفعة.</p>}
        </div>
      )}
      {o.status === "approved" && (
        <div className="card stack">
          <p>حوّل المبلغ من البنك ثم سجّل رقم المرجع.</p>
          <Field label="مرجع التحويل البنكي"><input className="ltr" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          <div className="row">
            <button className="btn coral" disabled={act.busy || ref.trim().length < 3} onClick={() => go("mark-paid", { bankReference: ref.trim() })}>تم التحويل</button>
            <button className="btn danger" disabled={act.busy || note.trim().length < 5} onClick={() => go("fail", { note: note.trim() })}>تعذّر</button>
          </div>
        </div>
      )}
    </>
  );
}
