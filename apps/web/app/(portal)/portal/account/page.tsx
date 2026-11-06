"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNote, Field, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
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
