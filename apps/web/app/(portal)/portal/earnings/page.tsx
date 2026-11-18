"use client";
import { useEffect, useState } from "react";
import { ErrorNote, Shell, Spinner } from "../../../../components/portal-ui";
import { api, errorText, saveProtectedFile } from "../../../../lib/api";
import { dayLabel, sar } from "../../../../lib/format";

interface E {
  heldInDisputeWindowHalalas: number;
  availableForNextRunHalalas: number;
  inPayoutHalalas: number;
  paidHalalas: number;
  payoutsFrozen: boolean;
  payouts: { id: string; amountHalalas: number; status: string; createdAt: string; paidAt: string | null; bankReference: string | null }[];
}
const PAYOUT: Record<string, string> = { pending: "قيد المراجعة", approved: "معتمدة", on_hold: "معلّقة", paid: "تم التحويل", failed: "تعذّر التحويل" };

export default function Earnings() {
  return (
    <Shell roles={["teacher"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const [e, setE] = useState<E | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    api<E>("GET", "/teacher/earnings").then(setE).catch(setErr);
  }, []);
  return (
    <>
      <h1>أرباحي</h1>
      <ErrorNote error={err} />
      {!e && !err && <Spinner />}
      {e && (
        <>
          {e.payoutsFrozen && <div className="note err">تحويلاتك مجمّدة حالياً. تواصل مع الدعم لمعرفة السبب.</div>}
          <div className="kpis">
            <div className="kpi"><b>{sar(e.heldInDisputeWindowHalalas)}</b><span>ضمن مهلة الاعتراض (48 ساعة)</span></div>
            <div className="kpi"><b>{sar(e.availableForNextRunHalalas)}</b><span>جاهز للدفعة القادمة</span></div>
            <div className="kpi"><b>{sar(e.inPayoutHalalas)}</b><span>قيد التحويل</span></div>
            <div className="kpi"><b>{sar(e.paidHalalas)}</b><span>تم تحويله</span></div>
          </div>
          <p className="muted small">الأرقام بعد خصم عمولة المنصة (20% لأول 5 دروس مع كل متعلّم، و12% بعدها). أول تحويل لك يمرّ بمراجعة إضافية.</p>
          <Statement />
          <h2>التحويلات</h2>
          {e.payouts.length === 0 && <div className="empty">لا تحويلات بعد.</div>}
          <div className="grid">
            {e.payouts.map((p) => (
              <div key={p.id} className="card tight">
                <div className="row between"><b>{sar(p.amountHalalas)}</b><span className="badge">{PAYOUT[p.status] ?? p.status}</span></div>
                <span className="muted small">{dayLabel(p.paidAt ?? p.createdAt)}{p.bankReference ? ` · مرجع: ${p.bankReference}` : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

interface Stmt {
  month: string;
  lessons: { bookingId: string; date: string; category: string; minutes: number; grossHalalas: number; commissionHalalas: number; refundedHalalas: number; netHalalas: number; payout: string }[];
  totals: { lessons: number; grossHalalas: number; commissionHalalas: number; refundedHalalas: number; netHalalas: number };
}
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

function Statement() {
  const [month, setMonth] = useState(thisMonth());
  const [s, setS] = useState<Stmt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setS(null);
    setErr(null);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    api<Stmt>("GET", `/teacher/statement?month=${month}`).then(setS).catch((e) => setErr(errorText(e)));
  }, [month]);
  return (
    <div className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>كشف الشهر</h2>
        <MonthPick value={month} onChange={setMonth} />
      </div>
      <ErrorNote error={err} />
      {s && s.lessons.length === 0 && <div className="empty">لا دروس مدفوعة في هذا الشهر.</div>}
      {s && s.lessons.length > 0 && (
        <>
          <div className="kpis">
            <div className="kpi"><b>{s.totals.lessons}</b><span>دروس</span></div>
            <div className="kpi"><b>{sar(s.totals.grossHalalas)}</b><span>المدفوع</span></div>
            <div className="kpi"><b>{sar(s.totals.commissionHalalas)}</b><span>عمولة المنصة</span></div>
            <div className="kpi"><b data-testid="statement-net">{sar(s.totals.netHalalas)}</b><span>صافي لك</span></div>
          </div>
          {s.lessons.map((l) => (
            <div key={l.bookingId} className="row between small">
              <span>{dayLabel(l.date)} · {l.category} · {l.minutes} د</span>
              <b>{sar(l.netHalalas)}</b>
            </div>
          ))}
          <div><button className="btn ghost" onClick={() => saveProtectedFile(`/teacher/statement?month=${month}&format=csv`, `ilmak-statement-${month}.csv`).catch((e) => setErr(errorText(e)))}>تنزيل CSV</button></div>
        </>
      )}
    </div>
  );
}

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, i, 15))));

/** Month and year as two selects, so the names are Arabic on every device (a native month input follows the browser's language). */
function MonthPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m] = value.split("-").map(Number) as [number, number];
  const now = thisMonth().split("-").map(Number) as [number, number];
  const years = [now[0] - 2, now[0] - 1, now[0]];
  const pad = (n: number) => String(n).padStart(2, "0");
  const set = (ny: number, nm: number) => onChange(`${ny}-${pad(ny === now[0] && nm > now[1] ? now[1] : nm)}`);
  return (
    <div className="row" style={{ gap: 8 }}>
      <select value={m} onChange={(e) => set(y, Number(e.target.value))} aria-label="الشهر">
        {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1} disabled={y === now[0] && i + 1 > now[1]}>{n}</option>)}
      </select>
      <select value={y} onChange={(e) => set(Number(e.target.value), m)} aria-label="السنة">
        {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
      </select>
    </div>
  );
}
