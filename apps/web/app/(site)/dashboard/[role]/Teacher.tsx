"use client";
import { Fragment, useEffect, useState } from "react";
import { api } from "../../demo-session";
import { TEACHER_NATIONAL_ID } from "../../demo-data";

const n = (v: number, d = 0) => v.toLocaleString("ar-SA", { maximumFractionDigits: d });
const sar = (v: number) => `${n(v, 2)} ر.س`;

// Invented figures. Net = gross × (1 − commission). Commission is 20% on the first 5 sessions with a learner, 12% after.
const WEEKS = [
  { w: "١٠ أكت", net: 380 }, { w: "١٧ أكت", net: 520 }, { w: "٢٤ أكت", net: 448 }, { w: "٣١ أكت", net: 690 },
  { w: "٧ نوف", net: 610 }, { w: "١٤ نوف", net: 822 }, { w: "٢١ نوف", net: 760 }, { w: "٢٨ نوف", net: 673 },
];
const LEARNERS = [
  { id: "متعلّم ٤٢١٨", done: 7 }, { id: "متعلّمة ١٠٣٧", done: 5 }, { id: "ولي أمر ٧٧٠٣", done: 3 }, { id: "متعلّم ٥٥٩٠", done: 1 },
];
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const SLOTS = ["٩–١٢ ص", "٢–٥ م", "٦–٩ م", "٩–١١ م"];
const START_ON = new Set(["0-1", "0-2", "1-1", "1-2", "2-2", "3-1", "3-2", "4-1", "4-2", "5-3", "6-0", "6-1"]);
const REQS = [
  { id: "r1", subject: "رياضيات · ثانوي", who: "متعلّم ٤٢١٨", when: "الخميس ٨:٠٠ م", left: 9 },
  { id: "r2", subject: "مراجعة اختبار", who: "ولي أمر ٧٧٠٣", when: "الجمعة ٣:٠٠ م", left: 3 },
];

function nextLessonIn(): string {
  const t = new Date(); t.setHours(19, 0, 0, 0);
  let m = Math.round((t.getTime() - Date.now()) / 60000);
  if (m < 0) m += 24 * 60;
  const h = Math.floor(m / 60);
  return h > 0 ? `بعد ${n(h)} ساعة و${n(m % 60)} دقيقة` : `بعد ${n(m)} دقيقة`;
}

export default function Teacher() {
  const [eta, setEta] = useState("");
  const [nf, setNf] = useState<{ state: string; number?: string; done?: boolean }>({ state: "لم تبدأ" });
  const [reqs, setReqs] = useState<Record<string, string>>({});
  const [on, setOn] = useState<Set<string>>(START_ON);
  const [payout, setPayout] = useState(false);
  const [room, setRoom] = useState(false);
  useEffect(() => { setEta(nextLessonIn()); const i = setInterval(() => setEta(nextLessonIn()), 30000); return () => clearInterval(i); }, []);

  async function verify() {
    setNf({ state: "جارٍ الطلب…" });
    const r = await api<{ requestId: string; number: string }>("/api/nafath/start", { nationalId: TEACHER_NATIONAL_ID });
    if (!r) return setNf({ state: "تم التوثيق (محاكاة محلية)", done: true });
    setNf({ state: "افتح تطبيق نفاذ واختر هذا الرقم", number: r.number });
    for (let i = 0; i < 6; i++) {
      await new Promise((x) => setTimeout(x, 1500));
      const st = await api<{ status: string }>(`/api/nafath/status?requestId=${r.requestId}`);
      if (st?.status === "approved") return setNf({ state: "تم التوثيق عبر نفاذ", done: true });
      if (st?.status === "rejected") return setNf({ state: "رُفض الطلب" });
    }
    setNf({ state: "انتهت المهلة" });
  }
  const toggle = (k: string) => setOn((s) => { const c = new Set(s); c.has(k) ? c.delete(k) : c.add(k); return c; });

  const steps = [
    { t: "توثيق الهوية عبر نفاذ", done: !!nf.done, act: true },
    { t: "وثيقة العمل الحر", done: true }, { t: "التخصصات والشهادات", done: true },
    { t: "الفيديو التعريفي", done: true }, { t: "ميثاق السلوك", done: true }, { t: "الآيبان باسمك", done: false },
  ];
  const pct = Math.round((steps.filter((s) => s.done).length / steps.length) * 100);
  const max = Math.max(...WEEKS.map((w) => w.net));
  const last = WEEKS[WEEKS.length - 1];

  return (
    <div className="t12">
      <section className="tc s7 next">
        <p className="eyebrow">حصتك القادمة</p>
        <div className="next-row">
          <div>
            <h3>رياضيات · ثانوي</h3>
            <p className="next-who">مع متعلّم ٤٢١٨ · اليوم ٧:٠٠ م · ٦٠ دقيقة</p>
            <p className="next-eta">{eta}</p>
          </div>
          <div className="next-act">
            <button className="btn primary dark" onClick={() => setRoom(true)}>ادخل الفصل</button>
            {room && <small>الفصل المسجّل يفتح قبل الحصة بعشر دقائق (تجريبي).</small>}
          </div>
        </div>
        <p className="next-note">ملاحظة الحصة السابقة: ركّز على التكامل بالتعويض، والواجب جاهز للمراجعة.</p>
      </section>

      <section className="tc s5 bal">
        <h3>رصيدك</h3>
        <div className="bal-main"><b>{sar(1248.5)}</b><span>متاح للتحويل</span></div>
        <div className="bal-split">
          <div><b>{sar(412)}</b><span>محجوز حتى انتهاء ٤٨ ساعة بلا بلاغ</span></div>
          <div><b>{sar(3960)}</b><span>حُوّل إليك منذ البداية</span></div>
        </div>
        <button className="btn outline" disabled={payout} onClick={() => setPayout(true)}>{payout ? "رُفع طلب التحويل للمالية" : "اطلب تحويلاً لآيبانك"}</button>
      </section>

      <section className="tc s7">
        <h3>صافي أرباحك أسبوعيًا</h3>
        <div className="bars" role="img" aria-label="صافي الأرباح لآخر ثمانية أسابيع">
          {WEEKS.map((w, i) => (
            <div className="bar" key={w.w} title={`${w.w}: ${sar(w.net)}`}>
              <span className="bar-v">{i === WEEKS.length - 1 ? n(w.net) : ""}</span>
              <i style={{ height: `${Math.round((w.net / max) * 140)}px` }} className={i === WEEKS.length - 1 ? "now" : ""} />
              <em>{w.w}</em>
            </div>
          ))}
        </div>
        <p className="cap">آخر أسبوع: {sar(last.net)} صافيًا بعد العمولة.</p>
      </section>

      <section className="tc s5">
        <h3>عمولتك مع كل متعلّم</h3>
        <ul className="learners">
          {LEARNERS.map((l) => (
            <li key={l.id}>
              <div><b>{l.id}</b><small>{l.done >= 5 ? "العمولة ١٢٪" : `العمولة ٢٠٪ · تنخفض بعد ${n(5 - l.done)} حصص`}</small></div>
              <div className="dots" aria-label={`${n(Math.min(l.done, 5))} من ٥ حصص`}>{[0, 1, 2, 3, 4].map((d) => <i key={d} className={d < l.done ? "f" : ""} />)}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="tc s6">
        <h3>طلبات تنتظر ردّك</h3>
        <ul className="rows">
          {REQS.map((r) => (
            <li key={r.id}>
              <div><b>{r.subject}</b><small>{r.who} · {r.when}</small><small className={r.left <= 4 ? "late" : ""}>يبقى {n(r.left)} ساعات للرد</small></div>
              {reqs[r.id] ? <span className={"badge " + (reqs[r.id] === "قبلت" ? "go" : "")}>{reqs[r.id]}</span> :
                <div className="acts"><button className="btn primary dark sm" onClick={() => setReqs({ ...reqs, [r.id]: "قبلت" })}>قبول</button><button className="btn outline sm" onClick={() => setReqs({ ...reqs, [r.id]: "اعتذرت" })}>اعتذار</button></div>}
            </li>
          ))}
        </ul>
      </section>

      <section className="tc s6">
        <h3>أوقاتك المتاحة <span className="count">{n(on.size)} فترة</span></h3>
        <div className="avail" role="group" aria-label="الأوقات المتاحة">
          <span />{SLOTS.map((s) => <span className="hd" key={s}>{s}</span>)}
          {DAYS.map((d, di) => (<Fragment key={d}>
            <span className="dy">{d}</span>
            {SLOTS.map((_, si) => { const k = `${di}-${si}`; return <button key={k} className={on.has(k) ? "on" : ""} aria-pressed={on.has(k)} aria-label={`${d} ${SLOTS[si]}`} onClick={() => toggle(k)} />; })}
          </Fragment>))}
        </div>
      </section>

      <section className="tc s8">
        <h3>اكتمال ملفك <span className="count">{n(pct)}٪</span></h3>
        <div className="meter"><i style={{ width: pct + "%" }} /></div>
        <ul className="steps">
          {steps.map((s) => (
            <li key={s.t} className={s.done ? "ok" : ""}>
              <span className="tick">{s.done ? "✓" : ""}</span>
              <span>{s.t}</span>
              {s.act && !s.done && <button className="btn primary dark sm" onClick={verify}>وثّق الآن</button>}
              {!s.act && !s.done && <small>مطلوب قبل أول تحويل</small>}
            </li>
          ))}
        </ul>
        {!nf.done && nf.state !== "لم تبدأ" && <p className="hint">{nf.state}</p>}
        {nf.number && !nf.done && <div className="nafath">{nf.number}</div>}
      </section>

      <section className="tc s4 rep">
        <h3>سمعتك</h3>
        <div className="rep-g"><div><b>٤٫٩</b><span>التقييم</span></div><div><b>٣٨ د</b><span>زمن الرد</span></div><div><b>٩٨٪</b><span>إتمام الحصص</span></div></div>
      </section>
    </div>
  );
}
