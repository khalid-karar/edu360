"use client";
import { useEffect, useState } from "react";
import { ErrorNote, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
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
