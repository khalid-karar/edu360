"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNote, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { dayLabel } from "../../../../lib/format";
import { useSession } from "../../../../lib/session";

interface Rec { status: string; suspendedUntil: string | null; strikes: { level: number; action: string; reason: string; createdAt: string }[] }
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
  const isParty = user && ["learner", "guardian", "teacher"].includes(user.role);
  useEffect(() => {
    if (isParty) api<Rec>("GET", "/account/strikes").then(setRec).catch(setErr);
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
      {rec && rec.strikes.length > 0 && (
        <div className="card">
          <h2>سجل المخالفات</h2>
          {rec.strikes.map((s, i) => (
            <div key={i} className="row between small"><span><b>{ACTION[s.action] ?? s.action}</b> · {s.reason}</span><span className="muted">{dayLabel(s.createdAt)}</span></div>
          ))}
        </div>
      )}
    </>
  );
}
