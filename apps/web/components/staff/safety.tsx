"use client";
import { useState } from "react";
import { ErrorNote, Field, Spinner } from "../portal-ui";
import { dateTime } from "../../lib/format";
import { useAct, useLoad } from "./common";

interface Queue {
  reports: { id: string; category: string; status: string; assignedTo: string | null; createdAt: string; reportedUser: { id: string; displayName: string } | null }[];
  flags: { id: string; category: string; severity: number; source: string; createdAt: string }[];
}
const REASON: Record<string, string> = { phone_number: "رقم جوال", spelled_number: "رقم مكتوب بالحروف", email: "بريد إلكتروني", link: "رابط", handle: "معرّف حساب", external_app: "تطبيق خارجي", contact_request: "طلب تواصل خارجي" };
const reasonText = (r: string | null) => (r ?? "").split(",").map((x) => REASON[x] ?? x).join("، ");
const CAT: Record<string, string> = { conduct: "سلوك", safety: "سلامة", no_show: "غياب", payment: "دفع", other: "أخرى" };

export function SafetyConsole({ meId }: { meId: string }) {
  const [sel, setSel] = useState<{ kind: "report" | "flag"; id: string } | null>(null);
  const q = useLoad<Queue>("/admin/safety/queue");
  const back = () => { setSel(null); q.reload(); };
  if (sel?.kind === "report") return <Report id={sel.id} meId={meId} onBack={back} />;
  if (sel?.kind === "flag") return <Flag id={sel.id} onBack={back} />;
  return (
    <>
      <ErrorNote error={q.err} />
      {!q.data && !q.err && <Spinner />}
      {q.data && (
        <>
          <h2>البلاغات ({q.data.reports.length})</h2>
          {q.data.reports.length === 0 && <div className="empty">لا بلاغات مفتوحة.</div>}
          <div className="grid">
            {q.data.reports.map((r) => (
              <button key={r.id} className="card tight click" onClick={() => setSel({ kind: "report", id: r.id })}>
                <div className="row between"><b>{CAT[r.category] ?? r.category}</b><span className={`badge ${r.category === "safety" ? "bad" : "wait"}`}>{r.status === "reviewing" ? (r.assignedTo === meId ? "عندك" : "عند زميل") : "جديد"}</span></div>
                <span className="muted small">{r.reportedUser ? `المبلَّغ عنه: ${r.reportedUser.displayName} · ` : ""}{dateTime(r.createdAt)}</span>
              </button>
            ))}
          </div>
          <h2>تنبيهات المحادثة ({q.data.flags.length})</h2>
          {q.data.flags.length === 0 && <div className="empty">لا تنبيهات.</div>}
          <div className="grid">
            {q.data.flags.map((f) => (
              <button key={f.id} className="card tight click" onClick={() => setSel({ kind: "flag", id: f.id })}>
                <div className="row between"><b>{f.category}</b><span className={`badge ${f.severity >= 4 ? "bad" : "wait"}`}>شدة {f.severity}</span></div>
                <span className="muted small">{dateTime(f.createdAt)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

interface ReportD {
  id: string; category: string; reason: string; status: string; assignedTo: string | null; createdAt: string;
  reporter: { displayName: string }; reportedUserId: string | null; bookingId: string | null;
  messages: { id: string; senderId: string; body: string; blocked: boolean; blockReason: string | null; createdAt: string }[];
  priorStrikes: { level: number; action: string; createdAt: string }[];
}

function Report({ id, meId, onBack }: { id: string; meId: string; onBack: () => void }) {
  const d = useLoad<ReportD>(`/admin/safety/reports/${id}`);
  const act = useAct();
  const [note, setNote] = useState("");
  const [strike, setStrike] = useState(false);
  if (!d.data) return <><ErrorNote error={d.err} />{!d.err && <Spinner />}<button className="btn ghost" onClick={onBack}>رجوع</button></>;
  const r = d.data;
  const mine = r.status === "reviewing" && r.assignedTo === meId;
  async function claim() { if (await act.run("POST", `/admin/safety/reports/${id}/claim`)) d.reload(); }
  async function resolve(outcome: "resolved" | "dismissed") {
    if (await act.run("POST", `/admin/safety/reports/${id}/resolve`, { outcome, note: note.trim() })) onBack();
  }
  return (
    <>
      <button className="btn ghost" onClick={onBack}>→ رجوع</button>
      <h2>بلاغ: {CAT[r.category] ?? r.category}</h2>
      <div className="card stack">
        <span className="muted small">من: {r.reporter.displayName} · {dateTime(r.createdAt)}</span>
        <p>{r.reason}</p>
        {r.priorStrikes.length > 0 && <div className="note err">سجل المبلَّغ عنه: {r.priorStrikes.length} مخالفة سابقة.</div>}
      </div>
      {r.messages.length > 0 && (
        <div className="card stack">
          <h3>المحادثة</h3>
          <span className="muted small">فتح المحادثة مسجَّل في سجل التدقيق.</span>
          <div className="msgs">
            {r.messages.map((m) => (
              <div key={m.id} className={`msg${m.blocked ? " blocked" : ""}`}>
                <span className="muted small">{dateTime(m.createdAt)}{m.blocked ? ` · محجوبة (${reasonText(m.blockReason)})` : ""}</span>
                <div>{m.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <ErrorNote error={act.err} />
      {r.status === "open" && <div><button className="btn" disabled={act.busy} onClick={claim}>استلام البلاغ</button></div>}
      {mine && (
        <div className="card stack">
          <Field label="ملاحظة القرار" hint="10 أحرف على الأقل. تُحفظ في السجل."><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row">
            <button className="btn" disabled={act.busy || note.trim().length < 10} onClick={() => resolve("resolved")}>تمت المعالجة</button>
            <button className="btn ghost" disabled={act.busy || note.trim().length < 10} onClick={() => resolve("dismissed")}>لا مخالفة</button>
            {r.reportedUserId && <button className="btn danger" onClick={() => setStrike(!strike)}>إصدار مخالفة</button>}
          </div>
          {strike && r.reportedUserId && <StrikeForm userId={r.reportedUserId} reportId={id} />}
        </div>
      )}
      {r.status !== "open" && !mine && <p className="muted">{r.status === "reviewing" ? "البلاغ عند موظف آخر." : "البلاغ مغلق."}</p>}
    </>
  );
}

const ACTION: Record<string, string> = { warn: "تحذير", suspend_14d: "إيقاف 14 يوماً وتجميد التحويلات", ban: "حظر" };
function StrikeForm({ userId, reportId }: { userId: string; reportId?: string }) {
  const act = useAct();
  const [reason, setReason] = useState("");
  const [zero, setZero] = useState(false);
  const [result, setResult] = useState<{ level: number; action: string; cancelledBookings: number } | null>(null);
  async function go() {
    if (!confirm(zero ? "مخالفة صفرية: حظر فوري. متأكد؟" : "إصدار مخالفة؟ العقوبة تتصاعد حسب سجل المستخدم.")) return;
    const r = (await act.run("POST", `/admin/safety/users/${userId}/strike`, { reason: reason.trim(), zeroTolerance: zero, ...(reportId ? { reportId } : {}) })) as typeof result | undefined;
    if (r) setResult(r);
  }
  if (result) return <div className="note info">المستوى {result.level}: {ACTION[result.action] ?? result.action}{result.cancelledBookings ? ` · أُلغي ${result.cancelledBookings} درس قادم` : ""}</div>;
  return (
    <div className="stack">
      <Field label="سبب المخالفة"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <label className="row"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> مخالفة صفرية (حظر فوري)</label>
      <ErrorNote error={act.err} />
      <div><button className="btn danger" disabled={act.busy || reason.trim().length < 10} onClick={go}>تأكيد المخالفة</button></div>
    </div>
  );
}

interface FlagD { id: string; category: string; severity: number; source: string; status: string; createdAt: string; message: { senderId: string; senderRole: string; toChild: boolean; body: string; blocked: boolean; blockReason: string | null } | null }
function Flag({ id, onBack }: { id: string; onBack: () => void }) {
  const d = useLoad<FlagD>(`/admin/safety/flags/${id}`);
  const act = useAct();
  const [note, setNote] = useState("");
  const [strike, setStrike] = useState(false);
  if (!d.data) return <><ErrorNote error={d.err} />{!d.err && <Spinner />}<button className="btn ghost" onClick={onBack}>رجوع</button></>;
  const f = d.data;
  async function review(outcome: "confirmed" | "dismissed") {
    if (await act.run("POST", `/admin/safety/flags/${id}/review`, { outcome, note: note.trim() })) onBack();
  }
  return (
    <>
      <button className="btn ghost" onClick={onBack}>→ رجوع</button>
      <h2>تنبيه: {f.category} <span className={`badge ${f.severity >= 4 ? "bad" : "wait"}`}>شدة {f.severity}</span></h2>
      {f.message && (
        <div className="card stack">
          <span className="muted small">{f.message.senderRole === "teacher" ? "من معلّم" : "من ولي أمر/متعلّم"}{f.message.toChild ? " إلى طفل" : ""}{f.message.blocked ? ` · حُجبت (${reasonText(f.message.blockReason)})` : ""}</span>
          <div className="msg blocked">{f.message.body}</div>
        </div>
      )}
      <ErrorNote error={act.err} />
      {f.status === "open" ? (
        <div className="card stack">
          <Field label="ملاحظة"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row">
            <button className="btn" disabled={act.busy || note.trim().length < 5} onClick={() => review("confirmed")}>مخالفة مؤكدة</button>
            <button className="btn ghost" disabled={act.busy || note.trim().length < 5} onClick={() => review("dismissed")}>إنذار كاذب</button>
            {f.message && <button className="btn danger" onClick={() => setStrike(!strike)}>مخالفة للمرسل</button>}
          </div>
          {strike && f.message && <StrikeForm userId={f.message.senderId} />}
        </div>
      ) : <p className="muted">تمت مراجعة هذا التنبيه.</p>}
    </>
  );
}
