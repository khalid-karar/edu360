"use client";
import { useState } from "react";
import { ErrorNote, Field, Spinner } from "../portal-ui";
import { dateTime } from "../../lib/format";
import { useAct, useLoad } from "./common";

interface QueueItem { teacherId: string; displayName: string; status: string; submittedAt: string; categories: number; pendingCredentials: number }
interface Detail {
  teacher: { status: string; bio: string | null; languages: string[]; freelance_document_no: string | null; employer_noc_url: string | null; intro_video_url: string | null; code_of_conduct_version: string | null; adults_only: boolean; submitted_at: string; display_name: string; full_name: string | null; gender: string | null };
  categories: { category_id: number; name_ar: string; price_halalas: number; approved: boolean }[];
  credentials: { id: string; category_id: number; kind: string; file_url: string; verdict: string | null }[];
  reviews: { decision: string; rubric: Record<string, number>; reason: string | null; created_at: string }[];
}
const RUBRIC: [string, string][] = [["knowledge", "المعرفة بالمادة"], ["communication", "التواصل"], ["conduct", "السلوك والأمانة"], ["tech", "الجاهزية التقنية"]];
const KIND: Record<string, string> = { degree: "شهادة جامعية", ijazah: "إجازة", certificate: "شهادة تخصص", portfolio: "أعمال سابقة", sample_video: "فيديو تجريبي" };
const DECISION: Record<string, string> = { approved: "اعتماد", conditional: "اعتماد مشروط (للكبار فقط)", rejected: "رفض" };

export function VettingConsole() {
  const [sel, setSel] = useState<string | null>(null);
  const q = useLoad<{ items: QueueItem[] }>("/admin/vetting/queue");
  if (sel) return <Review id={sel} onBack={() => { setSel(null); q.reload(); }} />;
  return (
    <>
      <h2>طلبات المعلّمين</h2>
      <ErrorNote error={q.err} />
      {!q.data && !q.err && <Spinner />}
      {q.data?.items.length === 0 && <div className="empty">لا طلبات بانتظار المراجعة.</div>}
      <div className="grid">
        {q.data?.items.map((t) => (
          <button key={t.teacherId} className="card tight click" onClick={() => setSel(t.teacherId)}>
            <div className="row between"><b>{t.displayName}</b><span className="badge wait">{t.status === "interview" ? "في المقابلة" : "جديد"}</span></div>
            <span className="muted small">قُدّم {dateTime(t.submittedAt)} · {t.categories} تخصص · {t.pendingCredentials} مستند لم يُراجع</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Review({ id, onBack }: { id: string; onBack: () => void }) {
  const d = useLoad<Detail>(`/admin/vetting/teachers/${id}`);
  const act = useAct();
  const [rubric, setRubric] = useState<Record<string, number>>({ knowledge: 4, communication: 4, conduct: 4, tech: 4 });
  const [decision, setDecision] = useState("approved");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);

  async function review(cid: string, verdict: "accepted" | "rejected") {
    if (await act.run("POST", `/admin/vetting/credentials/${cid}/review`, { verdict })) d.reload();
  }
  async function interview() {
    if (await act.run("POST", `/admin/vetting/teachers/${id}/interview`)) d.reload();
  }
  async function decide() {
    if (!confirm(`تأكيد القرار: ${DECISION[decision]}؟`)) return;
    const r = await act.run("POST", `/admin/vetting/teachers/${id}/decision`, { decision, rubric, ...(reason.trim() ? { reason: reason.trim() } : {}) });
    if (r) setDone(true);
  }

  if (done) return <><div className="note info">تم تسجيل القرار.</div><button className="btn" onClick={onBack}>العودة للطلبات</button></>;
  if (!d.data) return <><ErrorNote error={d.err} />{!d.err && <Spinner />}<button className="btn ghost" onClick={onBack}>رجوع</button></>;
  const { teacher: t, categories, credentials, reviews } = d.data;
  const total = Object.values(rubric).reduce((a, b) => a + b, 0);
  return (
    <>
      <button className="btn ghost" onClick={onBack}>→ رجوع</button>
      <h2>{t.display_name}</h2>
      <div className="card stack">
        <div className="row wrap"><span className="chip">{t.full_name ?? "—"}</span><span className="chip">{t.gender === "female" ? "أنثى" : t.gender === "male" ? "ذكر" : "—"}</span><span className="chip">اللغات: {t.languages.join("، ")}</span><span className="chip">الحالة: {t.status === "interview" ? "مقابلة" : "مقدّم"}</span></div>
        {t.bio && <p>{t.bio}</p>}
        <span className="muted small">وثيقة العمل الحر: {t.freelance_document_no ?? "—"} · نسخة الميثاق: {t.code_of_conduct_version ?? "—"}</span>
        {t.intro_video_url && <a href={t.intro_video_url} target="_blank" rel="noreferrer">فيديو التعريف</a>}
        <span className="muted small">رقم الهوية والآيبان والجوال مخفية عن المدقّق عمداً.</span>
      </div>

      <h3>التخصصات والمستندات</h3>
      <div className="grid">
        {categories.map((c) => {
          const docs = credentials.filter((x) => x.category_id === c.category_id);
          return (
            <div key={c.category_id} className="card tight stack">
              <div className="row between"><b>{c.name_ar}</b><span className="muted small">{c.price_halalas / 100} ر.س</span></div>
              {docs.length === 0 && <span className="muted small">لا مستندات مرفوعة.</span>}
              {docs.map((x) => (
                <div key={x.id} className="row between wrap">
                  <a href={x.file_url} target="_blank" rel="noreferrer">{KIND[x.kind] ?? x.kind}</a>
                  {x.verdict ? <span className={`badge ${x.verdict === "accepted" ? "ok" : "bad"}`}>{x.verdict === "accepted" ? "مقبول" : "مرفوض"}</span> : (
                    <span className="row"><button className="btn" disabled={act.busy} onClick={() => review(x.id, "accepted")}>قبول</button><button className="btn danger" disabled={act.busy} onClick={() => review(x.id, "rejected")}>رفض</button></span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <ErrorNote error={act.err} />

      {t.status === "submitted" && (
        <div className="card stack">
          <p>راجع المستندات ثم ابدأ المقابلة. القرار النهائي يأتي بعد المقابلة.</p>
          <div><button className="btn" disabled={act.busy} onClick={interview}>بدء المقابلة</button></div>
        </div>
      )}

      {t.status === "interview" && (
        <div className="card stack">
          <h3>تقييم المقابلة</h3>
          {RUBRIC.map(([k, label]) => (
            <Field key={k} label={`${label}: ${rubric[k]} من 5`}>
              <input type="range" min={0} max={5} step={1} value={rubric[k]} onChange={(e) => setRubric({ ...rubric, [k]: Number(e.target.value) })} />
            </Field>
          ))}
          <b>المجموع: {total} من 20</b>
          <span className={total >= 16 ? "muted small" : "note err"}>حد القبول 16. أقل من ذلك لا يمكن الاعتماد، ولا حتى المشروط.</span>
          <Field label="القرار">
            <select value={decision} onChange={(e) => setDecision(e.target.value)}>
              {Object.entries(DECISION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="السبب" hint="مطلوب عند الرفض أو الاعتماد المشروط.">
            <textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div><button className="btn coral" disabled={act.busy || (decision !== "rejected" && total < 16)} onClick={decide}>تسجيل القرار</button></div>
        </div>
      )}

      {reviews.length > 0 && (
        <>
          <h3>القرارات السابقة</h3>
          {reviews.map((r, i) => <div key={i} className="card tight"><b>{DECISION[r.decision] ?? r.decision}</b> <span className="muted small">{dateTime(r.created_at)}</span>{r.reason && <p>{r.reason}</p>}</div>)}
        </>
      )}
    </>
  );
}
