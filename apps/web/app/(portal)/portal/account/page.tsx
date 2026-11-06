"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNote, Field, Shell, Spinner } from "../../../../components/portal-ui";
import { ApiError, api } from "../../../../lib/api";
import { dayLabel } from "../../../../lib/format";
import { useSession } from "../../../../lib/session";

interface Strike { id: string; level: number; action: string; reason: string; createdAt: string; voided: boolean; appealStatus: string | null; canAppeal: boolean }
interface Rec { status: string; suspendedUntil: string | null; strikes: Strike[] }
const APPEAL: Record<string, string> = { open: "التظلّم قيد المراجعة", upheld: "رُفض التظلّم", reversed: "قُبل التظلّم وأُلغيت المخالفة" };
const ROLE: Record<string, string> = { learner: "متعلّم", guardian: "ولي أمر", teacher: "معلّم", vetting_officer: "موظف تدقيق", safety_officer: "موظف أمان", finance_officer: "موظف مالية", super_admin: "مدير النظام" };
const ACTION: Record<string, string> = { warn: "تحذير", suspend_14d: "إيقاف 14 يوماً", ban: "حظر" };

export default function Account() {
  return (
    <Shell>
      <Body />
    </Shell>
  );
}

function Body() {
  const { user, signOut } = useSession();
  const router = useRouter();
  const [rec, setRec] = useState<Rec | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => { api<Rec>("GET", "/account/strikes").then(setRec).catch(setErr); };
  const isParty = user && ["learner", "guardian", "teacher"].includes(user.role);
  useEffect(() => {
    if (isParty) load();
  }, [isParty]);
  if (!user) return <Spinner />;
  return (
    <>
      <h1>حسابي</h1>
      <div className="card">
        <div className="row between"><h2>{user.displayName}</h2><span className="badge">{ROLE[user.role]}</span></div>
        <p className="muted small">الحالة: {{ active: "نشط", pending: "بانتظار توثيق الهوية", suspended: "موقوف مؤقتاً", banned: "محظور" }[user.status]}</p>
        <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => signOut().then(() => router.replace("/portal/login"))}>تسجيل الخروج</button>
      </div>
      <ErrorNote error={err} />
      {rec && rec.status === "suspended" && rec.suspendedUntil && <div className="note err">حسابك موقوف حتى {dayLabel(rec.suspendedUntil)}.</div>}
      {rec && rec.status === "banned" && <div className="note err">حسابك محظور. يمكنك تقديم تظلّم على المخالفة أدناه، وسيراجعه موظف آخر غير من أصدرها.</div>}
      <DataRights status={user.status} staff={!isParty && user.role !== "minor"} />
      {rec && rec.strikes.length > 0 && (
        <div className="card stack">
          <h2>سجل المخالفات</h2>
          {rec.strikes.map((s) => (
            <div key={s.id} className="stack" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
              <div className="row between small"><span><b>{ACTION[s.action] ?? s.action}</b>{s.voided ? " (أُلغيت)" : ""} · {s.reason}</span><span className="muted">{dayLabel(s.createdAt)}</span></div>
              {s.appealStatus && <span className={`badge ${s.appealStatus === "reversed" ? "ok" : s.appealStatus === "upheld" ? "bad" : "wait"}`} style={{ alignSelf: "flex-start" }}>{APPEAL[s.appealStatus]}</span>}
              {s.canAppeal && open !== s.id && <div><button className="btn ghost" onClick={() => setOpen(s.id)}>تقديم تظلّم</button></div>}
              {open === s.id && <AppealForm strikeId={s.id} onDone={() => { setOpen(null); load(); }} />}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AppealForm({ strikeId, onDone }: { strikeId: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setErr(null);
    try { await api("POST", "/appeals", { strikeId, reason: reason.trim() }); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <Field label="اشرح لماذا تعترض" hint="20 حرفاً على الأقل. يمكنك التظلّم مرة واحدة لكل مخالفة وخلال 30 يوماً من صدورها."><textarea rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorNote error={err} />
      <div><button className="btn" disabled={busy || reason.trim().length < 20} onClick={send}>إرسال التظلّم</button></div>
    </div>
  );
}

const BLOCK: Record<string, string> = {
  upcoming_bookings: "عندك دروس قادمة أو حجوزات معلّقة. أنهِها أو ألغِها أولاً.",
  open_dispute: "هناك اعتراض مالي مفتوح لم يُفصل فيه.",
  unsettled_money: "هناك مبالغ لم تُسوَّ بعد (أرباح لم تُحوَّل أو مبلغ محجوز).",
  open_safety_case: "هناك بلاغ أمان مفتوح يخصّك.",
};
interface Del { requested: boolean; dueAt?: string; blockedReasons?: string[] }

function DataRights({ status, staff }: { status: string; staff: boolean }) {
  const [del, setDel] = useState<Del | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => { api<Del>("GET", "/account/deletion").then(setDel).catch(setErr); };
  useEffect(load, []);

  async function download() {
    setBusy(true); setErr(null);
    try {
      const data = await api("GET", "/account/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = "ilmak-my-data.json"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function request() {
    setBusy(true); setErr(null); setBlocked([]);
    try { await api("POST", "/account/deletion", { confirm: true }); setConfirming(false); load(); }
    catch (e) {
      if (e instanceof ApiError && e.code === "deletion_blocked") setBlocked((e.details as { reasons?: string[] } | undefined)?.reasons ?? []);
      else setErr(e);
      setConfirming(false);
    } finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setErr(null);
    try { await api("DELETE", "/account/deletion"); load(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <div className="card stack">
      <h2>بياناتي وخصوصيتي</h2>
      <p className="muted small">لك الحق في الحصول على نسخة من بياناتك الشخصية وفي طلب حذفها، وفق نظام حماية البيانات الشخصية.</p>
      <div><button className="btn ghost" disabled={busy} onClick={download}>تنزيل نسخة من بياناتي</button></div>
      <ErrorNote error={err} />
      {!staff && del && !del.requested && (
        <>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
          {blocked.length > 0 && (
            <div className="note err">
              <b>لا يمكن طلب الحذف الآن:</b>
              <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>{blocked.map((b) => <li key={b}>{BLOCK[b] ?? b}</li>)}</ul>
            </div>
          )}
          {!confirming ? (
            <div><button className="btn ghost" onClick={() => setConfirming(true)}>طلب حذف حسابي</button></div>
          ) : (
            <div className="stack">
              <div className="note">
                سيُحذف اسمك وجوالك وبريدك وهويتك وبياناتك البنكية ومحتوى رسائلك بعد 14 يوماً، ولا يمكن التراجع بعدها.
                نحتفظ بسجلات الدفع والتحويلات وسجل المخالفات والبلاغات لأن النظام والسلامة يتطلبان ذلك، دون ربطها باسمك.
                {status === "banned" && " ولأن حسابك محظور نحتفظ أيضاً ببصمة هويتك لمنع فتح حساب جديد."}
              </div>
              <div className="row">
                <button className="btn" style={{ background: "var(--coral)" }} disabled={busy} onClick={request}>تأكيد طلب الحذف</button>
                <button className="btn ghost" onClick={() => setConfirming(false)}>تراجع</button>
              </div>
            </div>
          )}
        </>
      )}
      {del?.requested && (
        <div className="note">
          <p style={{ margin: 0 }}>طلب حذف حسابك مسجّل، وسيُنفَّذ بعد {del.dueAt ? dayLabel(del.dueAt) : "14 يوماً"}.</p>
          {del.blockedReasons && del.blockedReasons.length > 0 && <p className="small" style={{ margin: "6px 0 0" }}>تأجّل التنفيذ لأن: {del.blockedReasons.map((b) => BLOCK[b] ?? b).join(" ")}</p>}
          <div style={{ marginTop: 8 }}><button className="btn ghost" disabled={busy} onClick={cancel}>إلغاء طلب الحذف</button></div>
        </div>
      )}
    </div>
  );
}
