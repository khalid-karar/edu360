"use client";
import { useState } from "react";
import { ErrorNote, Field, Spinner } from "../portal-ui";
import { dateTime, sar } from "../../lib/format";
import { Tabs, useAct, useLoad } from "./common";

export function AdminConsole() {
  const [tab, setTab] = useState<"stats" | "schools" | "cats" | "audit">("stats");
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={[{ id: "stats", label: "الإحصاءات" }, { id: "schools", label: "المدارس" }, { id: "cats", label: "التخصصات" }, { id: "audit", label: "سجل التدقيق" }]} />
      {tab === "stats" && <Analytics />}
      {tab === "schools" && <Schools />}
      {tab === "cats" && <Categories />}
      {tab === "audit" && <Audit />}
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


interface Stats {
  generatedAt: string;
  users: { learners: number; guardians: number; children: number; teachers: number; schools: number; newLast7d: number; signupsByDay: { day: string; n: number }[] };
  teacherPipeline: Record<"draft" | "submitted" | "interview" | "approved" | "rejected" | "suspended", number>;
  bookings30d: { total: number; byStatus: Record<string, number>; completedByDay: { day: string; n: number }[] };
  money30d: { grossHalalas: number; commissionHalalas: number; refundedHalalas: number; paidLessons: number; averageLessonHalalas: number; refundRate: number; payoutsOwedHalalas: Record<string, number> };
  quality30d: { reviews: number; averageRating: number | null };
  waiting: Record<string, number>;
  schools: { approved: number; pending: number; families: number };
}

const WAITING: Record<string, string> = {
  teacherApplications: "طلبات معلّمين", openReports: "بلاغات مفتوحة", openFlags: "تنبيهات الرسائل", openDisputes: "نزاعات",
  openAppeals: "استئنافات", pendingSchools: "مدارس بانتظار القرار", suspendedUsers: "حسابات موقوفة", bannedUsers: "حسابات محظورة",
};
const PIPE: Record<string, string> = { draft: "مسودة", submitted: "مقدّم", interview: "مقابلة", approved: "معتمد", rejected: "مرفوض", suspended: "موقوف" };

function Stat({ label, value, testId, hint }: { label: string; value: string | number; testId?: string; hint?: string }) {
  return <div className="card tight stack"><span className="muted small">{label}</span><b style={{ fontSize: 26 }} data-testid={testId}>{value}</b>{hint && <span className="muted small">{hint}</span>}</div>;
}

function Bars({ rows }: { rows: { day: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }} role="img" aria-label="رسم أعمدة">
      {rows.map((r) => <div key={r.day} title={`${r.day}: ${r.n}`} style={{ flex: 1, height: `${Math.max(4, (r.n / max) * 100)}%`, background: "var(--accent, #1f6f5c)", borderRadius: 3 }} />)}
    </div>
  );
}

function Analytics() {
  const q = useLoad<Stats>("/admin/analytics");
  if (q.err) return <ErrorNote error={q.err} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  const waiting = Object.entries(d.waiting).filter(([, n]) => n > 0);
  return (
    <>
      <p className="muted small">آخر تحديث: {dateTime(d.generatedAt)}. المبالغ والأعداد لآخر 30 يوماً ما لم يُذكر غير ذلك.</p>
      <div className="card stack">
        <h3>بانتظار قرار</h3>
        {waiting.length === 0 ? <span className="muted">لا شيء معلّق.</span> : <div className="row">{waiting.map(([k, n]) => <span key={k} className="chip">{WAITING[k] ?? k}: <b>{n}</b></span>)}</div>}
      </div>
      <div className="grid">
        <Stat label="متعلّمون" value={d.users.learners} />
        <Stat label="أولياء أمور" value={d.users.guardians} />
        <Stat label="معلّمون" value={d.users.teachers} />
        <Stat label="مدارس معتمدة" value={d.schools.approved} hint={d.schools.pending > 0 ? `${d.schools.pending} بانتظار القرار` : undefined} />
        <Stat label="مسجّلون جدد (7 أيام)" value={d.users.newLast7d} />
        <Stat label="حجوزات" value={d.bookings30d.total} />
        <Stat label="إجمالي المدفوعات" value={sar(d.money30d.grossHalalas)} testId="gross" />
        <Stat label="عمولة المنصة" value={sar(d.money30d.commissionHalalas)} />
        <Stat label="نسبة الاسترداد" value={`${d.money30d.refundRate}%`} />
        <Stat label="متوسط الدرس" value={sar(d.money30d.averageLessonHalalas)} />
        <Stat label="متوسط التقييم" value={d.quality30d.averageRating ?? "—"} />
        <Stat label="أسر عبر المدارس" value={d.schools.families} />
      </div>
      <div className="card stack"><h3>التسجيل اليومي</h3><Bars rows={d.users.signupsByDay} /></div>
      <div className="card stack"><h3>الدروس المكتملة يومياً</h3><Bars rows={d.bookings30d.completedByDay} /></div>
      <div className="card stack">
        <h3>مسار المعلّمين</h3>
        <div className="row">{Object.entries(d.teacherPipeline).map(([k, n]) => <span key={k} className="chip">{PIPE[k] ?? k}: <b>{n}</b></span>)}</div>
      </div>
    </>
  );
}

interface School { id: string; name: string; city: string; contactName: string; contactMobile: string; licenseNo: string | null; studentEstimate: number | null; status: "pending" | "approved" | "rejected"; inviteCode: string | null; rejectReason: string | null; families: number }
const SCHOOL_STATUS = { pending: "بانتظار القرار", approved: "معتمدة", rejected: "مرفوضة" } as const;

function Schools() {
  const q = useLoad<{ items: School[] }>("/admin/schools");
  const act = useAct();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  async function decide(s: School, decision: "approve" | "reject") {
    if (await act.run("POST", `/admin/schools/${s.id}/decision`, { decision, ...(decision === "reject" ? { reason: reasons[s.id] ?? "" } : {}) })) q.reload();
  }
  return (
    <>
      <p className="muted small">الاعتماد ينشئ دخول المدرسة على جوال المسؤول ويولّد رمزاً تشاركه مع الأسر. القرار لا يُعاد.</p>
      <ErrorNote error={q.err} />
      <ErrorNote error={act.err} />
      {!q.data && !q.err && <Spinner />}
      {q.data?.items.length === 0 && <p className="muted">لا توجد طلبات.</p>}
      <div className="grid">
        {q.data?.items.map((s) => (
          <div key={s.id} className="card tight stack" data-testid={`school-${s.id}`}>
            <div className="row between"><b>{s.name}</b><span className="chip">{SCHOOL_STATUS[s.status]}</span></div>
            <span className="muted small">{s.city} · {s.contactName} · <span className="ltr">{s.contactMobile}</span></span>
            {s.licenseNo && <span className="muted small">الترخيص: <span className="ltr">{s.licenseNo}</span></span>}
            {s.studentEstimate && <span className="muted small">الطلاب: {s.studentEstimate}</span>}
            {s.status === "approved" && <span>الرمز: <b className="ltr">{s.inviteCode}</b> · الأسر: {s.families}</span>}
            {s.status === "rejected" && s.rejectReason && <span className="muted small">السبب: {s.rejectReason}</span>}
            {s.status === "pending" && (
              <>
                <input placeholder="سبب الرفض (إن رُفض)" value={reasons[s.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [s.id]: e.target.value })} />
                <div className="row">
                  <button className="btn" disabled={act.busy} onClick={() => decide(s, "approve")}>اعتماد</button>
                  <button className="btn danger" disabled={act.busy || !(reasons[s.id] ?? "").trim()} onClick={() => decide(s, "reject")}>رفض</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
