"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Chat } from "../../../../components/chat";
import { Avatar, ErrorNote, Field, Shell, Spinner, StatusBadge } from "../../../../components/portal-ui";
import { ApiError, api, errorText } from "../../../../lib/api";
import { dateTime, sar } from "../../../../lib/format";
import { useParam } from "../../../../lib/session";
import type { BookingView } from "../bookings/page";

const MIN = 60_000;
const HOUR = 3_600_000;

export default function BookingPage() {
  return (
    <Shell roles={["learner", "guardian", "teacher"]}>
      <Body />
    </Shell>
  );
}

function useNow(ms = 1000) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

function Body() {
  const id = useParam("id");
  const wantsPay = useParam("pay");
  const [b, setB] = useState<BookingView | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"" | "dispute" | "review" | "report">("");
  const [guar, setGuar] = useState<{ eligible: boolean; reason?: string; until?: string } | null>(null);
  const now = useNow();

  const load = useCallback(async (bid: string) => {
    try {
      setB(await api<BookingView>("GET", `/bookings/${bid}`));
    } catch (e) {
      setErr(e);
    }
  }, []);
  useEffect(() => {
    if (!id) return;
    load(id);
    const t = setInterval(() => load(id), 10000);
    return () => clearInterval(t);
  }, [id, load]);

  const done = b?.status === "completed" && b.viewerRole !== "teacher";
  const payState = b?.payment?.status;
  useEffect(() => {
    if (!id || !done) { setGuar(null); return; }
    api<{ eligible: boolean; reason?: string; until?: string }>("GET", `/bookings/${id}/guarantee`).then(setGuar).catch(() => setGuar(null));
  }, [id, done, payState]);

  async function act(path: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setErr(null);
    try {
      await api("POST", `/bookings/${id}/${path}`, body);
      await load(id!);
      setPanel("");
    } catch (e) {
      setErr(e);
      if (e instanceof ApiError) load(id!);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", "/dev/pay", { bookingId: id });
      await load(id!);
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 404 && e.code === "not_found" ? "الدفع الإلكتروني غير مفعّل بعد في هذه النسخة." : e);
    } finally {
      setBusy(false);
    }
  }

  if (!id) return <Spinner />;
  if (!b) return err ? <><ErrorNote error={err} /><Link href="/portal/bookings">رجوع</Link></> : <Spinner />;

  const start = new Date(b.startsAt).getTime();
  const end = start + b.durationMin * MIN;
  const teacher = b.viewerRole === "teacher";
  const other = teacher ? b.learner.displayName : b.teacher.displayName;
  const left = b.expiresAt ? Math.max(0, new Date(b.expiresAt).getTime() - now) : 0;
  const mm = String(Math.floor(left / MIN)).padStart(2, "0");
  const ss = String(Math.floor((left % MIN) / 1000)).padStart(2, "0");
  const late = start - now < 24 * HOUR;
  const graceOver = now >= start + 15 * MIN;
  const noShowWindow = graceOver && now <= start + 24 * HOUR;

  const steps = ["طلب", "تأكيد", "الدرس", "اكتمل"];
  const at = { awaiting_payment: 0, requested: 0, confirmed: 1, completed: 3 }[b.status as "requested"];

  return (
    <>
      <Link href="/portal/bookings" className="small">← الحجوزات</Link>
      <div className="card">
        <div className="row">
          <Avatar name={other} big />
          <div style={{ flex: 1 }}>
            <h1>{other}</h1>
            <span className="muted">{b.category.nameAr}{b.learner.isChild && !teacher ? ` · الطالب: ${b.learner.displayName}` : ""}</span>
          </div>
          <StatusBadge status={b.status} />
        </div>
        <div className="row between">
          <b>{dateTime(b.startsAt)}</b>
          <span className="price">{sar(b.priceHalalas)}</span>
        </div>
        {at !== undefined && (
          <div className="timeline" aria-label="مراحل الحجز">
            {steps.map((s, i) => (<span key={s} style={{ display: "contents" }}>{i > 0 && <i />}<span className={i <= at ? "on" : ""}>{s}</span></span>))}
          </div>
        )}
        {b.cancelledBy && <p className="muted small">أُلغي بواسطة: {{ learner: "المتعلّم", teacher: "المعلّم", system: "النظام" }[b.cancelledBy as "system"] ?? b.cancelledBy}</p>}
        {teacher && b.payment && b.payment.status === "captured" && (
          <p className="small">صافي ربحك: <b>{sar(b.payment.netHalalas ?? 0)}</b> <span className="muted">(بعد عمولة {sar(b.payment.commissionHalalas ?? 0)})</span> — يُحوَّل بعد 48 ساعة.</p>
        )}
      </div>

      <ErrorNote error={err} />

      {b.status === "confirmed" && b.room && (
        now >= new Date(b.room.opensAt).getTime() && now <= new Date(b.room.closesAt).getTime()
          ? <Link href={`/portal/room?id=${id}`} className="btn">ادخل غرفة الدرس</Link>
          : now < new Date(b.room.opensAt).getTime() ? <div className="note info">تفتح غرفة الدرس قبل الموعد بـ10 دقائق.</div> : null
      )}

      {!teacher && b.status === "completed" && guar?.eligible && <Guarantee id={id} until={guar.until} onDone={() => { load(id); setGuar(null); }} />}
      {!teacher && b.payment && b.payment.refundedHalalas > 0 && b.payment.status === "refunded" && (
        <div className="note info">استُرد مبلغ هذا الدرس ({sar(b.payment.refundedHalalas)}). يصل إلى بطاقتك خلال أيام العمل المعتادة للبنك.</div>
      )}
      {teacher && b.payment && (b.payment.platformCreditHalalas ?? 0) > 0 && (
        <div className="note sand">استرد المتعلّم مبلغ هذا الدرس بموجب ضمان الدرس الأول، وأضافت المنصة {sar(b.payment.platformCreditHalalas ?? 0)} إلى أرباحك تعويضاً. لا يُحسب هذا مخالفة عليك.</div>
      )}

      {!teacher && b.status === "awaiting_payment" && (
        <div className="card">
          <h2>أكمل الدفع</h2>
          <p>سيُحجز <b>{sar(b.priceHalalas)}</b> على بطاقتك ولا يُخصم الآن. يُخصم بعد انتهاء الدرس، وإن لم يُقبل الطلب أو أُلغي مبكراً يُفرج عنه كاملاً.</p>
          <div className="note sand">متبقٍ على مهلة الدفع <b className="ltr">{mm}:{ss}</b> وبعدها يعود الموعد متاحاً لغيرك.</div>
          {wantsPay && <div className="note info">وضع تجريبي: لا توجد بوابة دفع حقيقية بعد. الزر التالي يحاكي حجز المبلغ.</div>}
          <button className="btn coral" disabled={busy || left === 0} onClick={pay}>ادفع {sar(b.priceHalalas)} (تجريبي)</button>
        </div>
      )}

      {teacher && b.status === "requested" && (
        <div className="card">
          <h2>طلب جديد بانتظار ردّك</h2>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => act("accept")}>قبول</button>
            <button className="btn danger" disabled={busy} onClick={() => act("decline", undefined, "رفض هذا الطلب؟ سيُفرج عن مبلغ المتعلّم.")}>رفض</button>
          </div>
        </div>
      )}

      {b.status === "confirmed" && (
        <div className="card">
          <h2>غرفة الدرس</h2>
          <p className="muted">ستُفتح غرفة الفيديو هنا قبل الموعد بقليل (قيد التطوير). تأكد من اتصالك وكاميرتك.</p>
          <div className="row">
            {teacher && now >= end && <button className="btn" disabled={busy} onClick={() => act("complete")}>تم الدرس</button>}
            {teacher && noShowWindow && <button className="btn danger" disabled={busy} onClick={() => act("no-show", { absent: "learner" }, "تأكيد أن المتعلّم لم يحضر؟ سيُخصم له كامل المبلغ.")}>المتعلّم لم يحضر</button>}
            {!teacher && noShowWindow && <button className="btn danger" disabled={busy} onClick={() => act("no-show", { absent: "teacher" }, "تأكيد أن المعلّم لم يحضر؟ لن يُخصم منك شيء.")}>المعلّم لم يحضر</button>}
            {now < start && (
              <button className="btn danger" disabled={busy} onClick={() => act("cancel", undefined, teacher ? "إلغاء الدرس؟ لن يُخصم من المتعلّم شيء، لكن الإلغاءات المتكررة تؤثر على موثوقيتك." : late ? "الإلغاء قبل أقل من 24 ساعة من الدرس: يُخصم 50% من المبلغ للمعلّم. متابعة؟" : "إلغاء الحجز؟ لن يُخصم منك شيء.")}>إلغاء الدرس</button>
            )}
          </div>
          {!teacher && late && now < start && <p className="small muted">تنبيه: الإلغاء الآن (قبل أقل من 24 ساعة) يُخصم عنه 50% من قيمة الدرس.</p>}
        </div>
      )}

      {!teacher && (b.status === "requested" || b.status === "awaiting_payment") && (
        <div><button className="btn danger" disabled={busy} onClick={() => act("cancel", undefined, "إلغاء الطلب؟ لن يُخصم منك شيء.")}>إلغاء الطلب</button></div>
      )}

      {!teacher && b.status === "completed" && (
        <div className="card">
          <h2>بعد الدرس</h2>
          <div className="row">
            <button className="btn" onClick={() => setPanel(panel === "review" ? "" : "review")}>قيّم الدرس</button>
            <button className="btn ghost" onClick={() => setPanel(panel === "dispute" ? "" : "dispute")}>اعتراض على الدرس أو الدفع</button>
          </div>
          {panel === "review" && <ReviewForm id={id} onDone={() => { setPanel(""); }} />}
          {panel === "dispute" && <TextForm label="اشرح المشكلة" hint="لديك 48 ساعة من وقت الخصم. يراجعها فريق المالية ويقرر استرداداً كاملاً أو جزئياً أو غيره." submit="رفع الاعتراض" path={`/bookings/${id}/dispute`} done="تم رفع الاعتراض وسيُوقف تحويل المبلغ للمعلّم حتى البتّ فيه." />}
        </div>
      )}

      {b.status !== "awaiting_payment" && (
        <>
          <Chat bookingId={id} open={["requested", "confirmed", "completed"].includes(b.status)} />
          <div>
            <button className="btn ghost" onClick={() => setPanel(panel === "report" ? "" : "report")}>إبلاغ عن مشكلة سلوكية</button>
            {panel === "report" && <ReportForm bookingId={id} />}
          </div>
        </>
      )}
    </>
  );
}

const WHY: [string, string][] = [["not_a_good_fit", "لم يناسبني المعلّم"], ["teacher_unprepared", "لم يكن المعلّم مستعداً"], ["teaching_style", "أسلوب الشرح لا يناسبني"], ["technical", "مشكلة تقنية"], ["other", "سبب آخر"]];

function Guarantee({ id, until, onDone }: { id: string; until?: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("not_a_good_fit");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function claim() {
    if (!confirm("استرداد كامل مبلغ هذا الدرس؟ لا يمكن التراجع.")) return;
    setBusy(true); setErr(null);
    try { await api("POST", `/bookings/${id}/guarantee`, { why }); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <div className="card stack" style={{ borderColor: "var(--teal)" }}>
      <h2>ضمان الدرس الأول</h2>
      <p>هذا أول درس لك مع هذا المعلّم. إن لم يناسبك فاسترد مبلغه كاملاً بضغطة واحدة، دون أسئلة.{until ? ` متاح حتى ${dateTime(until)}.` : ""}</p>
      {!open ? <div><button className="btn coral" onClick={() => setOpen(true)}>استرداد مبلغ الدرس</button></div> : (
        <>
          <Field label="ما السبب؟"><select value={why} onChange={(e) => setWhy(e.target.value)}>{WHY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <ErrorNote error={err} />
          <div className="row"><button className="btn coral" disabled={busy} onClick={claim}>تأكيد الاسترداد</button><button className="btn ghost" onClick={() => setOpen(false)}>تراجع</button></div>
        </>
      )}
    </div>
  );
}

function ReviewForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  async function submit() {
    setErr(null);
    try {
      await api("POST", `/bookings/${id}/review`, { rating, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setOk(true);
      setTimeout(onDone, 1500);
    } catch (e) {
      setErr(e);
    }
  }
  if (ok) return <div className="note info">شكراً لتقييمك.</div>;
  return (
    <div className="stack">
      <div className="stars" role="group" aria-label="التقييم">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={n <= rating ? "on" : ""} aria-pressed={n === rating} aria-label={`${n} من 5`} onClick={() => setRating(n)}>★</button>)}
      </div>
      <Field label="تعليق (اختياري)"><textarea rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <ErrorNote error={err} />
      <button className="btn" disabled={!rating} onClick={submit}>إرسال التقييم</button>
    </div>
  );
}

function TextForm({ label, hint, submit, path, done }: { label: string; hint?: string; submit: string; path: string; done: string }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  async function send() {
    setErr(null);
    try {
      await api("POST", path, { reason: reason.trim() });
      setOk(true);
    } catch (e) {
      setErr(e instanceof ApiError ? errorText(e) : e);
    }
  }
  if (ok) return <div className="note info">{done}</div>;
  return (
    <div className="stack">
      <Field label={label} hint={hint}><textarea rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorNote error={err} />
      <button className="btn" disabled={reason.trim().length < 10} onClick={send}>{submit}</button>
    </div>
  );
}

function ReportForm({ bookingId }: { bookingId: string }) {
  const [category, setCategory] = useState("conduct");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  async function send() {
    setErr(null);
    try {
      await api("POST", "/reports", { bookingId, category, reason: reason.trim() });
      setOk(true);
    } catch (e) {
      setErr(e);
    }
  }
  if (ok) return <div className="note info" style={{ marginTop: 10 }}>وصل بلاغك لفريق الأمان وسيُراجَع. شكراً لحرصك.</div>;
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <Field label="نوع البلاغ">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="conduct">سلوك غير لائق</option>
          <option value="safety">سلامة (أولوية قصوى)</option>
          <option value="no_show">غياب</option>
          <option value="payment">دفع</option>
          <option value="other">أخرى</option>
        </select>
      </Field>
      <Field label="التفاصيل"><textarea rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorNote error={err} />
      <button className="btn" disabled={reason.trim().length < 10} onClick={send}>إرسال البلاغ</button>
    </div>
  );
}
