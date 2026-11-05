"use client";
import { useState } from "react";
import { api } from "../../demo-session";
import { TEACHERS, CHILDREN, APPROVALS } from "../../demo-data";
import { S, Count, Tag, Stat, Chips, Switch, Meter, Av, n, sar } from "./ui";

/* ---------------- learner ---------------- */
const CATS = ["الكل", "مدرسي", "قرآن", "لغات", "فنون", "برمجة"] as const;
const CAT_OF: Record<string, string> = { "رياضيات": "مدرسي", "لغة إنجليزية": "لغات", "قرآن وتجويد": "قرآن", "رسم وفنون": "فنون", "برمجة للأطفال": "برمجة" };
const FREE: Record<string, string> = { t1: "اليوم ٨:٠٠ م", t2: "غدًا ٤:٠٠ م", t3: "اليوم ٩:٠٠ م", t4: "الخميس ٥:٠٠ م", t5: "الجمعة ٤:٠٠ م" };

export function Learner() {
  const [cat, setCat] = useState<(typeof CATS)[number]>("الكل");
  const [q, setQ] = useState("");
  const [pay, setPay] = useState<Record<string, string>>({});
  const [stars, setStars] = useState(0);
  const list = TEACHERS.filter((t) => (cat === "الكل" || CAT_OF[t.subject] === cat) && (!q || t.subject.includes(q) || t.name.includes(q)));

  async function book(id: string, price: number) {
    setPay((p) => ({ ...p, [id]: "جارٍ حجز المبلغ…" }));
    const a = await api<{ id: string }>("/api/mock-pay/authorize", { amount: price * 100, bookingId: `bk_${id}_${Date.now()}` });
    setPay((p) => ({ ...p, [id]: `${sar(price)} محجوزة، ولا تصل المعلّمة إلا بعد الحصة${a ? "" : " (محاكاة محلية)"}` }));
  }

  return (
    <div className="t12">
      <S span={7} cls="next" title="حصتك القادمة">
        <div className="next-row">
          <div>
            <h3 className="big">رياضيات · ثانوي</h3>
            <p className="next-who">مع أ. نورة العتيبي · الأحد ٧:٠٠ م · ٦٠ دقيقة</p>
            <div className="flow" aria-label="مسار الدفع">
              <span className="on">محجوز</span><hr /><span>الحصة</span><hr /><span>٤٨ ساعة للمراجعة</span><hr /><span>تحويل للمعلّمة</span>
            </div>
          </div>
          <div className="next-act"><button className="btn primary dark">ادخل الفصل</button><button className="btn outline sm">أعد الجدولة</button></div>
        </div>
        <p className="next-note">{sar(85)} محجوزة عندنا. لو لم تحضر المعلّمة تُستردّ كاملة تلقائيًا.</p>
      </S>

      <S span={5} title="هدفك هذا الشهر" extra={<Count t="٥ من ٨ حصص" />}>
        <Meter pct={62} />
        <div className="kpis" style={{ marginTop: 16 }}><Stat v="٥" l="حصص مكتملة" /><Stat v="٣ أسابيع" l="التزام متواصل" /><Stat v="٤٫٩" l="متوسط تقييمك" /></div>
      </S>

      <S span={12} title="ابحث عن معلّم" extra={<Count t={`${n(list.length)} معلّمة ومعلّم`} />}>
        <Chips items={[...CATS]} value={cat} onChange={setCat} />
        <input className="search" placeholder="اسم المعلّم أو المادة" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="tgrid">
          {list.map((t) => (
            <article key={t.id} className="tcard">
              <div className="tc-top"><Av t={t.name.slice(3, 4)} /><div><h4>{t.name}</h4><p className="mut">{t.subject} · {t.level} · {t.city}</p></div></div>
              <p className="bio">{t.bio}</p>
              <p className="meta"><b>{n(t.rating, 1)}</b> تقييم · {n(t.sessions)} حصة <Tag t="موثّق" tone="go" /></p>
              <p className="free">أقرب موعد: <b>{FREE[t.id]}</b></p>
              <button className="btn primary dark" onClick={() => book(t.id, t.price)}>احجز بـ {sar(t.price)}</button>
              {pay[t.id] && <p className="hint">{pay[t.id]}</p>}
            </article>
          ))}
          {!list.length && <p className="mut">لا نتائج. جرّب تصنيفًا آخر.</p>}
        </div>
      </S>

      <S span={6} title="حصصي">
        <ul className="rows">
          <li><div><b>رياضيات</b> · أ. نورة العتيبي<small>الأحد ٧:٠٠ م</small></div><Tag t="قادمة" tone="go" /></li>
          <li><div><b>إنجليزي</b> · أ. سارة القحطاني<small>الثلاثاء ٦:٣٠ م</small></div><Tag t="قادمة" tone="go" /></li>
          <li><div><b>رياضيات</b> · أ. نورة العتيبي<small>الأسبوع الماضي · قيّم الحصة خلال ٤٨ ساعة</small></div>
            <div className="stars" role="group" aria-label="تقييم الحصة">{[1, 2, 3, 4, 5].map((s) => <button key={s} className={s <= stars ? "on" : ""} aria-label={`${s} نجوم`} onClick={() => setStars(s)}>★</button>)}</div></li>
        </ul>
        {stars > 0 && <p className="hint">شكرًا، تقييمك يظهر في ملف المعلّمة بعد التحقق من الحصة.</p>}
      </S>

      <S span={6} title="دفعك محمي">
        <ol className="tl">
          <li><b>تدفع عند الحجز</b><small>يُحجز المبلغ ولا يصل المعلّم</small></li>
          <li><b>تحضر الحصة</b><small>مسجّلة داخل المنصة لحمايتك</small></li>
          <li><b>٤٨ ساعة للمراجعة</b><small>أي مشكلة؟ أبلغ وتراجعها الإدارة</small></li>
          <li><b>يُحوَّل للمعلّم</b><small>بعد خصم عمولة المنصة منه، لا منك</small></li>
        </ol>
      </S>
    </div>
  );
}

/* ---------------- guardian ---------------- */
export function Guardian() {
  const [ap, setAp] = useState<Record<string, string>>({});
  const [sw, setSw] = useState({ rec: true, women: true, text: true, silent: false });
  const kids = [
    { ...CHILDREN[0], hrs: "٣ ساعات", msgs: 24, color: "g1" },
    { ...CHILDREN[1], hrs: "ساعة ونصف", msgs: 9, color: "g2" },
  ];
  const set = (k: keyof typeof sw) => (v: boolean) => setSw({ ...sw, [k]: v });
  return (
    <div className="t12">
      {kids.map((c) => (
        <S key={c.id} span={6} cls="child">
          <div className="tc-top"><Av t={c.name.slice(0, 1)} k={c.color} /><div><h3 style={{ margin: 0 }}>{c.name}</h3><p className="mut">{n(c.age)} سنوات</p></div></div>
          <p className="next-who">القادمة: <b>{c.next}</b></p>
          <div className="kpis" style={{ margin: "12px 0" }}><Stat v={c.hrs} l="تعلّم هذا الأسبوع" /><Stat v={n(c.msgs)} l="رسائل راجعتها" /></div>
          <div className="acts"><button className="btn outline sm">المحادثات</button><button className="btn outline sm">تسجيلات الحصص</button><button className="btn outline sm">انضمام صامت</button></div>
        </S>
      ))}

      <S span={6} title="معلّمون ينتظرون موافقتك" extra={<Count t={`${n(APPROVALS.filter((a) => !ap[a.id]).length)} معلّق`} />}>
        <p className="mut" style={{ marginBottom: 8 }}>لا تُفتح المحادثة مع أي معلّم قبل أن توافق.</p>
        <ul className="rows">
          {APPROVALS.map((a) => (
            <li key={a.id}><div><b>{a.teacher}</b><small>{a.subject} لـ {a.child} · تقييم {n(a.rating, 1)} · موثّقة بنفاذ</small></div>
              {ap[a.id] ? <Tag t={ap[a.id]} tone={ap[a.id] === "وافقت" ? "go" : "bad"} /> :
                <div className="acts"><button className="btn primary dark sm" onClick={() => setAp({ ...ap, [a.id]: "وافقت" })}>موافقة</button><button className="btn outline sm" onClick={() => setAp({ ...ap, [a.id]: "رفضت" })}>رفض</button></div>}
            </li>
          ))}
        </ul>
      </S>

      <S span={6} title="ضوابط الأمان">
        <ul className="opts">
          <li><div><b>تسجيل كل الحصص</b><small>أنت والإشراف فقط يصلكم التسجيل، ويُحذف بعد ٣٠ يومًا</small></div><Switch on={sw.rec} onChange={set("rec")} label="تسجيل الحصص" /></li>
          <li><div><b>معلّمات فقط للأبناء</b><small>الإعداد الافتراضي لأقل من ١٨ سنة</small></div><Switch on={sw.women} onChange={set("women")} label="معلمات فقط" /></li>
          <li><div><b>نصوص الحصة فقط في المحادثة</b><small>بلا صور ولا ملفات ولا روابط</small></div><Switch on={sw.text} onChange={set("text")} label="نصوص فقط" /></li>
          <li><div><b>إشعار قبل كل حصة</b><small>تصلك رسالة وبإمكانك الانضمام صامتًا</small></div><Switch on={sw.silent} onChange={set("silent")} label="إشعار قبل الحصة" /></li>
        </ul>
      </S>

      <S span={7} title="ملاحظات بعد الحصص">
        <ol className="tl">
          <li><b>أ. ريم الدوسري · لعبدالله</b><small>أتمّ مراجعة سورة النبأ بتجويد جيد. الواجب: إعادة الآيات ١٥ إلى ٢٥.</small></li>
          <li><b>أ. هند الشمري · لريم</b><small>رسمت منظر البحر بالألوان المائية. تحتاج تدريبًا على مزج الألوان.</small></li>
        </ol>
      </S>
      <S span={5} title="مدفوعات هذا الشهر" extra={<Count t={sar(420)} />}>
        <ul className="learners">
          <li><div><b>عبدالله</b><small>٤ حصص</small></div><b>{sar(240)}</b></li>
          <li><div><b>ريم</b><small>٢ حصتان</small></div><b>{sar(180)}</b></li>
        </ul>
      </S>
    </div>
  );
}

/* ---------------- minor ---------------- */
export function Minor() {
  const [joined, setJoined] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({ h1: true });
  const [rep, setRep] = useState<"" | "pick" | "sent">("");
  const tasks = [{ id: "h1", t: "أراجع آيات النبأ ١ إلى ١٤" }, { id: "h2", t: "أعيد الآيات ١٥ إلى ٢٥ مرتين" }, { id: "h3", t: "أسجّل سؤالًا للمعلّمة" }];
  const pct = Math.round((tasks.filter((t) => done[t.id]).length / tasks.length) * 100);
  return (
    <div className="t12">
      <S span={7} cls="next" title="حصتي القادمة">
        <div className="next-row">
          <div><h3 className="big">قرآن وتجويد</h3><p className="next-who">مع أ. ريم الدوسري · الإثنين ٥:٠٠ م</p><p className="next-eta">بعد يوم واحد</p></div>
          <div className="next-act"><button className="btn primary dark" onClick={() => setJoined(true)}>انضم للحصة</button>{joined && <small>تفتح الغرفة قبل الموعد بعشر دقائق. ولي أمرك يستطيع مشاهدتها.</small>}</div>
        </div>
      </S>
      <S span={5} title="ورد هذا الأسبوع" extra={<Count t="سورة النبأ" />}>
        <Meter pct={38} /><p className="cap">حفظت ١٥ آية من ٤٠. باقي ٢٥ آية.</p>
        <div className="kpis" style={{ marginTop: 12 }}><Stat v="٥ أيام" l="مراجعة متواصلة" /><Stat v="٣" l="حصص هذا الشهر" /></div>
      </S>
      <S span={6} title="واجباتي" extra={<Count t={`${n(pct)}٪`} />}>
        <Meter pct={pct} />
        <ul className="steps" style={{ gridTemplateColumns: "1fr", marginTop: 12 }}>
          {tasks.map((t) => (
            <li key={t.id} className={done[t.id] ? "ok" : ""}>
              <button className="tick tickbtn" aria-label={t.t} aria-pressed={!!done[t.id]} onClick={() => setDone({ ...done, [t.id]: !done[t.id] })}>{done[t.id] ? "✓" : ""}</button><span>{t.t}</span>
            </li>
          ))}
        </ul>
      </S>
      <S span={6} title="حسابي بأمان">
        <ul className="opts plainopts">
          <li><b>لا أحجز ولا أدفع وحدي.</b> ولي أمري يتولّى ذلك.</li>
          <li><b>أراسل فقط معلّمين وافق عليهم ولي أمري</b>، وفي موضوع الحصة.</li>
          <li><b>ولي أمري يرى المحادثات والتسجيلات.</b> هذا لحمايتي.</li>
        </ul>
        {rep === "" && <button className="btn outline" onClick={() => setRep("pick")}>أريد الإبلاغ عن مشكلة</button>}
        {rep === "pick" && (
          <div className="report"><p>ماذا حدث؟ سيصل البلاغ للإشراف فورًا، ولن يعرف المعلّم أنك أبلغت.</p>
            <div className="acts">{["شيء أزعجني في الحصة", "طلب مني التحدث خارج المنصة", "مشكلة أخرى"].map((r) => <button key={r} className="btn outline sm" onClick={() => setRep("sent")}>{r}</button>)}</div></div>
        )}
        {rep === "sent" && <p className="hint">وصل بلاغك. شكرًا لأنك أخبرتنا، وسيراجعه الإشراف خلال ساعتين.</p>}
      </S>
    </div>
  );
}
