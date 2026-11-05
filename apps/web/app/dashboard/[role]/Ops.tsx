"use client";
import { useState } from "react";
import { S, Count, Tag, Stat, Chips, Meter, Bars, Av, n, sar } from "./ui";

/* ---------------- vetting ---------------- */
const APPL = [
  { id: "p1", name: "أ. لمى الجهني", subject: "فيزياء", left: "يومان", checks: [["الهوية عبر نفاذ", true], ["وثيقة العمل الحر", true], ["شهادة البكالوريوس", true], ["المقابلة", false]], risk: "منخفض" },
  { id: "p2", name: "أ. بدر المطيري", subject: "حاسب آلي", left: "٣ أيام", checks: [["الهوية عبر نفاذ", true], ["وثيقة العمل الحر", true], ["شهادة البكالوريوس", false], ["المقابلة", false]], risk: "متوسط" },
  { id: "p3", name: "أ. دانة الرشيد", subject: "لغة عربية", left: "اليوم", checks: [["الهوية عبر نفاذ", true], ["وثيقة العمل الحر", true], ["شهادة البكالوريوس", true], ["المقابلة", true]], risk: "منخفض" },
] as const;
const RUBRIC = ["إتقان المادة", "وضوح الشرح", "التعامل مع المتعلّم", "الالتزام والمظهر المهني"];

export function Vetting() {
  const [sel, setSel] = useState<string>(APPL[0].id);
  const [score, setScore] = useState<Record<string, number[]>>({ p3: [5, 4, 5, 5] });
  const [dec, setDec] = useState<Record<string, string>>({});
  const a = APPL.find((x) => x.id === sel)!;
  const sc = score[a.id] ?? [0, 0, 0, 0];
  const total = sc.reduce((x, y) => x + y, 0);
  const rate = (i: number, v: number) => setScore({ ...score, [a.id]: sc.map((x, j) => (j === i ? v : x)) });
  return (
    <div className="t12">
      <S span={12} title="طابور التحقق">
        <div className="kpis"><Stat v={n(APPL.filter((x) => !dec[x.id]).length)} l="بانتظار المراجعة" /><Stat v="١٫٨ يوم" l="متوسط وقت المراجعة (الهدف ٣)" /><Stat v="٩٢٪" l="نسبة القبول" /><Stat v={n(Object.keys(dec).length)} l="قرارات اليوم" /></div>
      </S>
      <S span={5} title="المتقدمون">
        <ul className="queue">
          {APPL.map((x) => (
            <li key={x.id}><button className={"qrow" + (sel === x.id ? " on" : "")} onClick={() => setSel(x.id)}>
              <Av t={x.name.slice(3, 4)} /><span><b>{x.name}</b><small>{x.subject} · يتبقى {x.left}</small></span>
              {dec[x.id] ? <Tag t={dec[x.id]} tone={dec[x.id] === "مقبول" ? "go" : dec[x.id] === "مرفوض" ? "bad" : "warn"} /> : <Tag t={`مخاطر ${x.risk}`} tone={x.risk === "منخفض" ? "go" : "warn"} />}
            </button></li>
          ))}
        </ul>
      </S>
      <S span={7} title={a.name} extra={<Count t={a.subject} />}>
        <ul className="steps" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {a.checks.map(([t, ok]) => <li key={t} className={ok ? "ok" : ""}><span className="tick">{ok ? "✓" : ""}</span><span>{t}</span></li>)}
        </ul>
        <h4 className="sub">تقييم المقابلة والحصة التجريبية</h4>
        {RUBRIC.map((r, i) => (
          <div className="rub" key={r}><span>{r}</span>
            <div className="rate" role="group" aria-label={r}>{[1, 2, 3, 4, 5].map((v) => <button key={v} className={v <= sc[i] ? "on" : ""} aria-label={`${v}`} onClick={() => rate(i, v)}>{n(v)}</button>)}</div></div>
        ))}
        <p className="cap">المجموع: <b>{n(total)}</b> من ٢٠ {total >= 16 ? "· يكفي للقبول" : total ? "· دون حد القبول (١٦)" : ""}</p>
        {dec[a.id] ? <p className="hint">سُجّل القرار في سجل التدقيق.</p> :
          <div className="acts"><button className="btn primary dark sm" disabled={total < 16} onClick={() => setDec({ ...dec, [a.id]: "مقبول" })}>قبول</button>
            <button className="btn outline sm" onClick={() => setDec({ ...dec, [a.id]: "مشروط" })}>قبول بشروط</button>
            <button className="btn outline sm" onClick={() => setDec({ ...dec, [a.id]: "مرفوض" })}>رفض (إعادة التقديم بعد ٩٠ يومًا)</button></div>}
        <p className="cap">دوري هنا التحقق فقط. لا أستطيع اعتماد تحويلات مالية.</p>
      </S>
    </div>
  );
}

/* ---------------- safety ---------------- */
const CASES = [
  { id: "x2", kind: "بلاغ سلوك", child: true, who: "جلسة #٨٨٤", sev: "عالٍ", sla: "يتبقى ٤٠ دقيقة", ev: "ولي أمر: «المعلّم طلب من الطفل إغلاق الكاميرا وفتح محادثة خارجية».", strikes: 0 },
  { id: "x1", kind: "تواصل خارج المنصة", child: false, who: "معلّم #٣١٢", sev: "متوسط", sla: "يتبقى ١٨ ساعة", ev: "محادثة: «كلمني واتساب 05••••••••» (حُجب الرقم تلقائيًا).", strikes: 1 },
  { id: "x3", kind: "عدم حضور", child: false, who: "جلسة #٨٧٩", sev: "منخفض", sla: "يتبقى ٢٢ ساعة", ev: "لم ينضم المعلّم خلال ١٠ دقائق. استُرد المبلغ تلقائيًا.", strikes: 0 },
] as const;
const LEAK = [{ l: "١٠ أكت", v: 21 }, { l: "١٧ أكت", v: 19 }, { l: "٢٤ أكت", v: 17 }, { l: "٣١ أكت", v: 15 }, { l: "٧ نوف", v: 14 }, { l: "١٤ نوف", v: 12 }];

export function Safety() {
  const [f, setF] = useState<"الكل" | "الأطفال" | "عالٍ">("الكل");
  const [sel, setSel] = useState<string>(CASES[0].id);
  const [act, setAct] = useState<Record<string, string>>({});
  const shown = CASES.filter((c) => f === "الكل" || (f === "الأطفال" ? c.child : c.sev === "عالٍ"));
  const c = CASES.find((x) => x.id === sel)!;
  return (
    <div className="t12">
      <S span={12} cls="alert">
        <div className="alert-row"><div><p className="eyebrow">أولوية قصوى</p><h3 className="big">بلاغ متعلق بطفل ينتظر المراجعة</h3><p>الهدف: مراجعة بلاغات الأطفال خلال ساعتين.</p></div><b className="clock">٤٠ د</b></div>
      </S>
      <S span={5} title="البلاغات والإشارات" extra={<Count t={`${n(CASES.length - Object.keys(act).length)} مفتوح`} />}>
        <Chips items={["الكل", "الأطفال", "عالٍ"]} value={f} onChange={setF} />
        <ul className="queue">
          {shown.map((x) => (
            <li key={x.id}><button className={"qrow" + (sel === x.id ? " on" : "")} onClick={() => setSel(x.id)}>
              <span className={"sev " + (x.sev === "عالٍ" ? "hi" : x.sev === "متوسط" ? "mid" : "lo")} aria-hidden />
              <span><b>{x.kind}</b><small>{x.who} · {x.sla}</small></span>{act[x.id] ? <Tag t={act[x.id]} tone="go" /> : x.child ? <Tag t="طفل" tone="bad" /> : null}
            </button></li>
          ))}
        </ul>
      </S>
      <S span={7} title={`${c.kind} · ${c.who}`}>
        <blockquote className="evid">{c.ev}</blockquote>
        <p className="cap">إنذارات سابقة لهذا المعلّم: <b>{n(c.strikes)}</b>. الإنذار الأول تحذير، والثاني إيقاف ١٤ يومًا مع تجميد التحويلات، والثالث حظر نهائي.</p>
        {act[c.id] ? <p className="hint">سُجّل الإجراء «{act[c.id]}» في سجل التدقيق.</p> :
          <div className="acts"><button className="btn outline sm" onClick={() => setAct({ ...act, [c.id]: "تحذير" })}>تحذير</button><button className="btn outline sm" onClick={() => setAct({ ...act, [c.id]: "إيقاف ١٤ يومًا" })}>إيقاف مؤقت</button>
            <button className="btn outline sm" onClick={() => setAct({ ...act, [c.id]: "حظر نهائي" })}>حظر نهائي</button><button className="btn primary dark sm" onClick={() => setAct({ ...act, [c.id]: "أُغلقت" })}>إغلاق بلا إجراء</button></div>}
        {c.child && <p className="cap">سلوك جنسي أو استدراج مع قاصر يعني حظرًا نهائيًا فوريًا وإحالة للجهات المختصة.</p>}
      </S>
      <S span={7} title="محاولات التواصل خارج المنصة" extra={<Count t="في انخفاض" />}>
        <Bars data={LEAK} unit=" محاولة" />
        <p className="cap">١٢ محاولة هذا الأسبوع، بعد ٢١ قبل خمسة أسابيع.</p>
      </S>
      <S span={5} title="عيّنة التسجيلات ٥٪">
        <ul className="learners"><li><div><b>جلسة #٨٨٤</b><small>بانتظار المراجعة</small></div><Tag t="افتح" /></li><li><div><b>جلسة #٨٧٠</b><small>سليمة</small></div><Tag t="تمت" tone="go" /></li><li><div><b>جلسة #٨٦٥</b><small>سليمة</small></div><Tag t="تمت" tone="go" /></li></ul>
        <p className="cap">لا أغيّر الأسعار ولا التحويلات. فصل الصلاحيات.</p>
      </S>
    </div>
  );
}

/* ---------------- finance ---------------- */
const PAY = [
  { id: "y1", t: "أ. نورة العتيبي", net: 673.2, note: "" }, { id: "y2", t: "أ. ريم الدوسري", net: 1210.5, note: "" },
  { id: "y3", t: "أ. سارة القحطاني", net: 402, note: "" }, { id: "y4", t: "أ. هند الشمري", net: 244.8, note: "معلّمة جديدة: التحويل الأول بعد ١٤ يومًا" },
];
const GMV = [{ l: "الأحد", v: 11200 }, { l: "الإثنين", v: 12800 }, { l: "الثلاثاء", v: 9800 }, { l: "الأربعاء", v: 13600 }, { l: "الخميس", v: 15100 }, { l: "الجمعة", v: 8900 }, { l: "السبت", v: 17000 }];

export function Finance() {
  const [pick, setPick] = useState<Set<string>>(new Set(["y1", "y2", "y3"]));
  const [done, setDone] = useState(false);
  const [rf, setRf] = useState<Record<string, boolean>>({});
  const total = PAY.filter((p) => pick.has(p.id)).reduce((s, p) => s + p.net, 0);
  const tog = (id: string) => setPick((s) => { const c = new Set(s); c.has(id) ? c.delete(id) : c.add(id); return c; });
  return (
    <div className="t12">
      <S span={12} title="هذا الأسبوع"><div className="kpis"><Stat v={sar(88400)} l="إجمالي المعاملات" /><Stat v={sar(412)} l="محجوز قيد الحصة" /><Stat v={sar(14870)} l="العمولة المحصّلة" /><Stat v={sar(2230.5)} l="ضريبة ١٥٪ على العمولة" /></div></S>
      <S span={7} title="دفعة التحويل الأسبوعية" extra={<Count t={sar(total)} />}>
        <ul className="opts">
          {PAY.map((p) => (
            <li key={p.id}><label className="chk"><input type="checkbox" checked={pick.has(p.id)} disabled={done || !!p.note} onChange={() => tog(p.id)} /><div><b>{p.t}</b><small>{p.note || "الأسبوع الماضي · الآيبان مطابق لنفاذ"}</small></div></label><b>{sar(p.net)}</b></li>
          ))}
        </ul>
        {done ? <p className="hint">اعتُمدت الدفعة ({n(pick.size)} معلّمين) وسُجّلت في سجل التدقيق.</p> : <button className="btn primary dark" disabled={!pick.size} onClick={() => setDone(true)}>اعتمد {n(pick.size)} تحويلات</button>}
      </S>
      <S span={5} title="طلبات الاسترداد">
        <ul className="rows">
          <li><div><b>جلسة #٨٧٩</b><small>غياب المعلّم · استرداد كامل</small></div>{rf.f1 ? <Tag t="نُفّذ" tone="go" /> : <button className="btn outline sm" onClick={() => setRf({ ...rf, f1: true })}>{sar(70)}</button>}</li>
          <li><div><b>جلسة #٨٦١</b><small>إلغاء قبل أقل من ٢٤ ساعة · ٥٠٪</small></div>{rf.f2 ? <Tag t="نُفّذ" tone="go" /> : <button className="btn outline sm" onClick={() => setRf({ ...rf, f2: true })}>{sar(42.5)}</button>}</li>
        </ul>
      </S>
      <S span={7} title="المعاملات اليومية"><Bars data={GMV} hi={4} unit=" ر.س" /></S>
      <S span={5} title="التسوية والفواتير">
        <ul className="steps" style={{ gridTemplateColumns: "1fr" }}>
          <li className="ok"><span className="tick">✓</span><span>تسوية مزوّد الدفع: الفرق ٠٫٠٠ (محاكاة)</span></li>
          <li className="ok"><span className="tick">✓</span><span>ضريبة القيمة المضافة محسوبة على العمولة</span></li>
          <li><span className="tick" /><span>فاتورة ZATCA الإلكترونية</span><small>قيد الربط</small></li>
        </ul>
        <p className="cap">لا أعتمد المعلّمين ولا أغلق قضايا السلامة.</p>
      </S>
    </div>
  );
}

/* ---------------- admin ---------------- */
const GMV8 = [{ l: "١٠ أكت", v: 41 }, { l: "١٧ أكت", v: 48 }, { l: "٢٤ أكت", v: 52 }, { l: "٣١ أكت", v: 61 }, { l: "٧ نوف", v: 66 }, { l: "١٤ نوف", v: 74 }, { l: "٢١ نوف", v: 81 }, { l: "٢٨ نوف", v: 88 }];
const CATS = [["مدرسي", "٥٠ – ١٢٠"], ["قرآن وتجويد", "٤٠ – ٩٠"], ["لغات", "٦٠ – ١٣٠"], ["فنون", "٦٠ – ١١٠"], ["برمجة", "٨٠ – ١٥٠"]];
const STAFF = [["مسؤولو التحقق", 3], ["الثقة والسلامة", 4], ["المالية", 2], ["مديرو النظام", 2]];

export function Admin() {
  const [log, setLog] = useState<string[]>(["٠٩:١٢ · vetting/ليلى: قبول أ. دانة الرشيد", "٠٨:٤٠ · finance/منال: اعتماد دفعة التحويل #٤١٧", "٠٨:٠٥ · safety/فهد: تحذير معلّم #٢٩٠"]);
  const [edit, setEdit] = useState(false);
  const [p, setP] = useState({ first: 20, after: 12, cancel: 24 });
  const [cat, setCat] = useState("");
  const [cats, setCats] = useState(CATS);
  const add = (t: string) => setLog((l) => [`الآن · admin/طلال: ${t}`, ...l]);
  return (
    <div className="t12">
      <S span={12} title="المنصة اليوم"><div className="kpis"><Stat v="١٨٤" l="معلّم موثّق" /><Stat v="١٢٤" l="حصة اليوم" /><Stat v="٢٫١٪" l="نسبة النزاعات (الهدف أقل من ٣٪)" /><Stat v="١٦٫٩٪" l="متوسط العمولة الفعلية" /></div></S>
      <S span={7} title="إجمالي المعاملات الأسبوعي" extra={<Count t="بالآلاف ر.س" />}><Bars data={GMV8} /></S>
      <S span={5} title="الرسوم والسياسات" extra={!edit && <button className="btn outline sm" onClick={() => setEdit(true)}>تعديل</button>}>
        <ul className="opts">
          {([["first", "عمولة أول ٥ حصص مع كل متعلّم", "٪"], ["after", "العمولة بعد ذلك", "٪"], ["cancel", "الاسترداد الكامل قبل الحصة بـ", "ساعة"]] as const).map(([k, l, u]) => (
            <li key={k}><div><b>{l}</b></div>{edit ? <input className="num" type="number" value={p[k]} min={0} max={100} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} aria-label={l} /> : <b>{n(p[k])} {u}</b>}</li>
          ))}
        </ul>
        {edit && <div className="acts"><button className="btn primary dark sm" onClick={() => { setEdit(false); add(`تعديل السياسات: ${p.first}٪ ثم ${p.after}٪، إلغاء ${p.cancel} ساعة`); }}>حفظ وتسجيل</button><button className="btn outline sm" onClick={() => setEdit(false)}>إلغاء</button></div>}
      </S>
      <S span={6} title="التصنيفات وحدود الأسعار (ر.س للساعة)">
        <ul className="learners">{cats.map(([c, b]) => <li key={c}><b>{c}</b><span className="mut">{b}</span></li>)}</ul>
        <form className="addcat" onSubmit={(e) => { e.preventDefault(); if (!cat.trim()) return; setCats([...cats, [cat.trim(), "٥٠ – ١٠٠"]]); add(`إضافة تصنيف «${cat.trim()}»`); setCat(""); }}>
          <input className="search" style={{ margin: 0 }} placeholder="اسم تصنيف جديد" value={cat} onChange={(e) => setCat(e.target.value)} /><button className="btn primary dark sm">أضف</button>
        </form>
      </S>
      <S span={6} title="الفريق والصلاحيات">
        <ul className="learners">{STAFF.map(([r, c]) => <li key={r}><div><b>{r}</b><small>مصادقة ثنائية مفعّلة</small></div><Count t={`${n(Number(c))}`} /></li>)}</ul>
      </S>
      <S span={12} title="سجل التدقيق" extra={<Tag t="لا يُعدَّل ولا يُحذف" />}>
        <ul className="audit">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </S>
    </div>
  );
}
