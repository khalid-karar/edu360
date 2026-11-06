"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badges, LANG, Stars, type TeacherItem } from "../../../../components/teacher-card";
import { Avatar, ErrorNote, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { dateTime, dayKey, dayLabel, sar, timeLabel } from "../../../../lib/format";
import { useParam, useSession } from "../../../../lib/session";

type Full = Omit<TeacherItem, "bioPreview"> & { bio: string | null; adultsOnly: boolean };

export default function TeacherPage() {
  return (
    <Shell roles={["learner", "guardian"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const id = useParam("id");
  const childId = useParam("child");
  const { user } = useSession();
  const router = useRouter();
  const [t, setT] = useState<Full | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [cat, setCat] = useState<number | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [crossOk, setCrossOk] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function load(tid: string, child: string | null) {
    try {
      const [p, s] = await Promise.all([
        api<Full>("GET", `/teachers/${tid}${child ? `?childId=${child}` : ""}`),
        api<{ slots: string[] }>("GET", `/teachers/${tid}/slots?limit=100`),
      ]);
      setT(p);
      setSlots(s.slots);
      setCat((c) => c ?? p.categories[0]?.categoryId ?? null);
      setDay((d) => d ?? (s.slots[0] ? dayKey(s.slots[0]) : null));
    } catch (e) {
      setErr(e);
    }
  }
  useEffect(() => {
    if (id) load(id, childId);
  }, [id, childId]);

  const days = useMemo(() => [...new Set((slots ?? []).map(dayKey))], [slots]);
  const price = t?.categories.find((c) => c.categoryId === cat)?.priceHalalas;

  async function approve() {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", "/guardian/approvals", { teacherId: id, allowCrossGender: crossOk });
      await load(id!, childId);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    setBusy(true);
    setErr(null);
    try {
      const b = await api<{ bookingId: string }>("POST", "/bookings", { teacherId: id, categoryId: cat, startsAt: slot, ...(childId ? { learnerId: childId } : {}) });
      router.push(`/portal/booking?id=${b.bookingId}&pay=1`);
    } catch (e) {
      setErr(e);
      if (id) load(id, childId); // the slot may just have been taken
      setSlot(null);
    } finally {
      setBusy(false);
    }
  }

  if (!id) return <Spinner />;
  if (!t) return err ? <><ErrorNote error={err} /><Link href="/portal/search">رجوع للبحث</Link></> : <Spinner />;

  const fc = t.forChild;
  const needsApproval = Boolean(childId && fc && (!fc.approved || (!fc.sameGender && !fc.crossGenderApproved)));
  return (
    <>
      <Link href="/portal/search" className="small">← نتائج البحث</Link>
      <div className="card">
        <div className="row">
          <Avatar name={t.displayName} big />
          <div>
            <h1>{t.displayName}</h1>
            <div className="row" style={{ gap: 8 }}><Stars rating={t.rating} /><span className="muted small">· {t.completedSessions} درس · {t.languages.map((l) => LANG[l] ?? l).join("، ")}</span></div>
          </div>
        </div>
        {t.bio && <p>{t.bio}</p>}
        <Badges list={t.badges} />
        <div className="row" style={{ gap: 6 }}>
          <span className="badge ok">هوية موثّقة عبر نفاذ</span>
          <span className="badge ok">شهادات مدقَّقة</span>
        </div>
      </div>

      <Ask teacherId={t.teacherId} name={t.displayName} />

      {needsApproval && (
        <div className="card">
          <h2>اعتمد المعلّم لطفلك</h2>
          <p className="small">لا يمكن حجز درس لطفل قبل أن تعتمد المعلّم. بعد الاعتماد تظهر لك كل محادثات الحجوزات ويمكنك سحب الاعتماد في أي وقت.</p>
          {fc && !fc.sameGender && (
            <label className="row small">
              <input type="checkbox" checked={crossOk} onChange={(e) => setCrossOk(e.target.checked)} />
              <span>أسمح لطفلي بالدرس مع معلّم من الجنس الآخر (موافقة خاصة)</span>
            </label>
          )}
          <ErrorNote error={err} />
          <button className="btn coral" disabled={busy || (fc ? !fc.sameGender && !crossOk : false)} onClick={approve}>اعتماد المعلّم</button>
        </div>
      )}

      {!needsApproval && (
        <div className="card">
          <h2>احجز درساً</h2>
          <div className="stack">
            <div className="tabs" role="group" aria-label="التخصص">
              {t.categories.map((c) => (
                <button key={c.categoryId} aria-pressed={cat === c.categoryId} onClick={() => setCat(c.categoryId)}>{c.nameAr} · {sar(c.priceHalalas)}</button>
              ))}
            </div>
            {slots === null ? <Spinner /> : days.length === 0 ? (
              <div className="empty">لا مواعيد متاحة خلال الأيام القادمة.</div>
            ) : (
              <>
                <div className="tabs" role="group" aria-label="اليوم">
                  {days.map((d) => {
                    const first = slots.find((s) => dayKey(s) === d)!;
                    return <button key={d} aria-pressed={day === d} onClick={() => { setDay(d); setSlot(null); }}>{dayLabel(first)}</button>;
                  })}
                </div>
                <div className="slots">
                  {slots.filter((s) => dayKey(s) === day).map((s) => (
                    <button key={s} className="slot" aria-pressed={slot === s} onClick={() => setSlot(s)}>{timeLabel(s)}</button>
                  ))}
                </div>
              </>
            )}
            {slot && price !== undefined && (
              <div className="note info">
                <b>{dateTime(slot)}</b> · درس مدته ساعة · <b>{sar(price)}</b>
                <div className="small">لا يُخصم المبلغ الآن: يُحجز على بطاقتك حتى ينتهي الدرس.</div>
              </div>
            )}
            {!needsApproval && <ErrorNote error={err} />}
            <button className="btn coral" disabled={!slot || cat === null || busy} onClick={book}>متابعة للدفع</button>
            {user?.role === "guardian" && !childId && <p className="muted small">تحجز لنفسك. لحجز درس لأحد أبنائك ارجع للبحث واختر الطفل.</p>}
          </div>
        </div>
      )}
    </>
  );
}

/** A question before booking. The same filter as lesson chat applies: no phone numbers or links. */
function Ask({ teacherId, name }: { teacherId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ inquiryId: string }>("POST", `/teachers/${teacherId}/inquiry`, { body: text.trim() });
      router.push(`/portal/inquiry?id=${r.inquiryId}`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  if (!open) return <div><button className="btn ghost" onClick={() => setOpen(true)}>اسأل {name} قبل الحجز</button></div>;
  return (
    <div className="card stack">
      <h2>سؤال قبل الحجز</h2>
      <textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="مثال: هل تدرّس الأطفال في سن السابعة؟" aria-label="سؤالك" />
      <p className="muted small">لا تُرسل أرقام جوال أو روابط: التواصل يتم هنا لحمايتك. لن يرى المعلّم غير اسمك.</p>
      <ErrorNote error={err} />
      <div className="row"><button className="btn" disabled={busy || !text.trim()} onClick={send}>إرسال السؤال</button><button className="btn ghost" onClick={() => setOpen(false)}>إلغاء</button></div>
    </div>
  );
}
