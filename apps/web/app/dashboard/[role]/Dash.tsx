"use client";
import { useEffect, useState, type ReactNode } from "react";
import "../../demo.css";
import {
  ROLES, TEACHERS, LEARNER_SESSIONS, CHILDREN, APPROVALS, TEACHER_REQUESTS, EARNINGS, APPLICANTS, REPORTS,
  PAYOUTS, REFUNDS, AUDIT_SEED, TEACHER_NATIONAL_ID, type RoleKey,
} from "../../demo-data";
import { api, clearSession, getSession, type Session } from "../../demo-session";

const sar = (n: number) => `${n.toLocaleString("ar-SA", { maximumFractionDigits: 2 })} ر.س`;

function Card({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return <section className={"dcard" + (wide ? " wide" : "")}><h3>{title}</h3>{children}</section>;
}
function Badge({ t, tone = "" }: { t: string; tone?: string }) { return <span className={"badge " + tone}>{t}</span>; }
function Kpi({ n, l }: { n: string; l: string }) { return <div className="kpi"><b>{n}</b><span>{l}</span></div>; }

export default function Dash({ role }: { role: string }) {
  const [s, setS] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setS(getSession()); setReady(true); }, []);
  if (!ready) return null;
  const meta = ROLES.find((r) => r.key === role);
  if (!meta) return <main className="demo-login"><p>دور غير معروف.</p><a href="/login">تسجيل الدخول</a></main>;
  if (!s || s.role !== meta.key) {
    return (
      <main className="demo-login">
        <div className="demo-banner">سجّل الدخول أولاً لعرض لوحة «{meta.ar}».</div>
        <a className="btn primary dark" href="/login">تسجيل الدخول</a>
      </main>
    );
  }
  return (
    <div className="dash">
      <header className="dbar">
        <div><b>عِلمك</b> <span className="pill">تجريبي</span></div>
        <div className="who">{meta.icon} {s.name} · {meta.ar}</div>
        <div className="sw">
          <a href="/login">تبديل الدور</a>
          <button onClick={() => { clearSession(); window.location.href = "/login"; }}>خروج</button>
        </div>
      </header>
      <div className="demo-banner">بيانات وهمية للعرض فقط — لا دفع حقيقي، ولا رسائل، ولا هوية حقيقية.</div>
      <main className="dgrid">{VIEWS[meta.key]({ name: s.name })}</main>
    </div>
  );
}

/* ---------------- learner ---------------- */
function Learner({ name }: { name: string }) {
  const [q, setQ] = useState("");
  const [pay, setPay] = useState<Record<string, string>>({});
  const list = TEACHERS.filter((t) => !q || t.subject.includes(q) || t.name.includes(q));
  async function book(id: string, price: number) {
    setPay((p) => ({ ...p, [id]: "جارٍ حجز المبلغ…" }));
    const a = await api<{ id: string; status: string }>("/api/mock-pay/authorize", { amount: price * 100, bookingId: `bk_${id}_${Date.now()}` });
    setPay((p) => ({ ...p, [id]: a ? `تم حجز ${sar(price)} — لا يُحوَّل للمعلّم إلا بعد الحصة` : `تم حجز ${sar(price)} (محاكاة محلية)` }));
  }
  return (<>
    <Card title={`أهلاً ${name.split(" ")[0]}`} wide><div className="kpis"><Kpi n="٢" l="حصص قادمة" /><Kpi n="٥" l="حصص مكتملة" /><Kpi n="٤.٩" l="متوسط تقييمك للمعلّمين" /></div></Card>
    <Card title="حصصي">
      <ul className="rows">{LEARNER_SESSIONS.map((x) => (
        <li key={x.id}><div><b>{x.subject}</b> — {x.teacher}<small>{x.when}</small></div><Badge t={x.status} tone={x.status === "قادمة" ? "go" : ""} /></li>
      ))}</ul>
    </Card>
    <Card title="ابحث عن معلّم" wide>
      <input className="search" placeholder="المادة أو اسم المعلّم…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tgrid">{list.map((t) => (
        <article key={t.id} className="tcard">
          <div className="av">{t.name.slice(3, 4)}</div>
          <h4>{t.name} <Badge t="موثّق" tone="go" /></h4>
          <p>{t.subject} · {t.level} · {t.city}</p>
          <p className="bio">{t.bio}</p>
          <p>⭐ {t.rating} ({t.sessions} حصة) · <b>{sar(t.price)}</b>/ساعة</p>
          <button className="btn primary dark" onClick={() => book(t.id, t.price)}>احجز وادفع (تجريبي)</button>
          {pay[t.id] && <p className="hint">{pay[t.id]}</p>}
        </article>))}
      </div>
    </Card>
  </>);
}

/* ---------------- guardian ---------------- */
function Guardian() {
  const [ap, setAp] = useState<Record<string, string>>({});
  return (<>
    <Card title="أبنائي">
      <ul className="rows">{CHILDREN.map((c) => <li key={c.id}><div><b>{c.name}</b> · {c.age} سنوات<small>القادمة: {c.next}</small></div><Badge t="حساب طفل" /></li>)}</ul>
      <button className="btn outline">+ إضافة طفل (تجريبي)</button>
    </Card>
    <Card title="معلّمون بانتظار موافقتك">
      <ul className="rows">{APPROVALS.map((a) => (
        <li key={a.id}><div><b>{a.teacher}</b> — {a.subject}<small>لـ {a.child} · ⭐ {a.rating}</small></div>
          {ap[a.id] ? <Badge t={ap[a.id]} tone={ap[a.id] === "تمت الموافقة" ? "go" : "bad"} /> :
            <div className="acts"><button className="btn primary dark sm" onClick={() => setAp({ ...ap, [a.id]: "تمت الموافقة" })}>موافقة</button><button className="btn outline sm" onClick={() => setAp({ ...ap, [a.id]: "مرفوض" })}>رفض</button></div>}
        </li>))}</ul>
    </Card>
    <Card title="الرقابة" wide>
      <ul className="rows">
        <li><div>أرى كل محادثات أبنائي مع المعلّمين<small>المحادثات مفلترة: لا أرقام ولا حسابات خارجية</small></div><Badge t="مفعّل" tone="go" /></li>
        <li><div>تسجيل الجلسات للمراجعة<small>تُحفظ ٣٠ يوماً ويصلها ولي الأمر والإشراف فقط</small></div><Badge t="مفعّل" tone="go" /></li>
        <li><div>المدفوعات هذا الشهر<small>٦ حصص</small></div><b>{sar(420)}</b></li>
      </ul>
    </Card>
  </>);
}

/* ---------------- minor ---------------- */
function Minor() {
  return (<>
    <Card title="حصصي القادمة" wide>
      <ul className="rows">
        <li><div><b>قرآن وتجويد</b> — أ. ريم الدوسري<small>الإثنين ٥:٠٠ م</small></div><button className="btn primary dark sm">انضم للحصة</button></li>
        <li><div><b>برمجة للأطفال</b> — أ. منى الحربي<small>بانتظار موافقة ولي الأمر</small></div><Badge t="بانتظار الموافقة" /></li>
      </ul>
    </Card>
    <Card title="حدود حسابي"><ul className="rows plain">
      <li>🔒 لا أستطيع الحجز أو الدفع بنفسي</li><li>💬 أراسل فقط المعلّمين الذين وافق عليهم ولي أمري</li><li>👀 ولي أمري يرى المحادثات والتسجيلات</li></ul></Card>
    <Card title="أبلغ عن مشكلة"><p>إذا شعرت بعدم الارتياح في أي حصة اضغط الزر وسيصل البلاغ للإشراف فوراً.</p><button className="btn outline">🚩 إبلاغ</button></Card>
  </>);
}

/* ---------------- teacher ---------------- */
function Teacher() {
  const [nf, setNf] = useState<{ state: string; number?: string }>({ state: "لم تبدأ" });
  const [payout, setPayout] = useState("");
  async function verify() {
    setNf({ state: "جارٍ الطلب…" });
    const r = await api<{ requestId: string; number: string }>("/api/nafath/start", { nationalId: TEACHER_NATIONAL_ID });
    if (!r) { setNf({ state: "تم التحقق (محاكاة محلية)" }); return; }
    setNf({ state: "افتح تطبيق نفاذ واختر الرقم", number: r.number });
    for (let i = 0; i < 6; i++) {
      await new Promise((x) => setTimeout(x, 1500));
      const st = await api<{ status: string }>(`/api/nafath/status?requestId=${r.requestId}`);
      if (st?.status === "approved") return setNf({ state: "تم التوثيق عبر نفاذ ✓" });
      if (st?.status === "rejected") return setNf({ state: "رُفض الطلب" });
    }
    setNf({ state: "انتهت المهلة" });
  }
  const net = (e: (typeof EARNINGS)[number]) => e.gross * (1 - e.rate);
  return (<>
    <Card title="توثيق الهوية"><p>الحالة: <b>{nf.state}</b></p>
      {nf.number && <div className="nafath">الرقم: <b>{nf.number}</b></div>}
      <button className="btn primary dark" onClick={verify}>توثيق عبر نفاذ (تجريبي)</button></Card>
    <Card title="طلبات جديدة"><ul className="rows">{TEACHER_REQUESTS.map((r) => <li key={r.id}><div><b>{r.subject}</b> — {r.learner}<small>{r.when}</small></div><button className="btn primary dark sm">قبول</button></li>)}</ul></Card>
    <Card title="أرباحي" wide>
      <table className="tbl"><thead><tr><th>الفترة</th><th>الحصص</th><th>الإجمالي</th><th>العمولة</th><th>الصافي</th></tr></thead>
        <tbody>{EARNINGS.map((e) => <tr key={e.week}><td>{e.week}</td><td>{e.sessions}</td><td>{sar(e.gross)}</td><td>{e.rate * 100}٪</td><td><b>{sar(net(e))}</b></td></tr>)}</tbody></table>
      <p className="hint">العمولة ٢٠٪ على أول ٥ حصص مع كل متعلّم، ثم ١٢٪.</p>
      <button className="btn outline" onClick={() => setPayout("تم رفع طلب التحويل للمالية (تجريبي)")}>اطلب تحويلاً</button>{payout && <p className="hint">{payout}</p>}
    </Card>
  </>);
}

/* ---------------- vetting ---------------- */
function Vetting() {
  const [d, setD] = useState<Record<string, string>>({});
  return (<>
    <Card title="طلبات المعلّمين بانتظار المراجعة" wide>
      <ul className="rows">{APPLICANTS.map((a) => (
        <li key={a.id}><div><b>{a.name}</b> — {a.subject}<small>{a.docs}</small></div>
          <Badge t={`مخاطر ${a.risk}`} tone={a.risk === "منخفض" ? "go" : "warn"} />
          {d[a.id] ? <Badge t={d[a.id]} tone={d[a.id] === "مقبول" ? "go" : "bad"} /> :
            <div className="acts"><button className="btn primary dark sm" onClick={() => setD({ ...d, [a.id]: "مقبول" })}>قبول</button><button className="btn outline sm" onClick={() => setD({ ...d, [a.id]: "مرفوض" })}>رفض</button></div>}
        </li>))}</ul>
    </Card>
    <Card title="مؤشراتي"><div className="kpis"><Kpi n="٣" l="بانتظار المراجعة" /><Kpi n="٩٢٪" l="نسبة القبول" /><Kpi n="١.٨ يوم" l="متوسط وقت المراجعة" /></div></Card>
    <Card title="ما لا أستطيع فعله"><p>لا أعتمد التحويلات المالية ولا أغلق قضايا السلامة — فصل الصلاحيات.</p></Card>
  </>);
}

/* ---------------- safety ---------------- */
function Safety() {
  const [a, setA] = useState<Record<string, string>>({});
  return (<>
    <Card title="البلاغات والإشارات" wide>
      <ul className="rows">{REPORTS.map((r) => (
        <li key={r.id}><div><b>{r.kind}</b> — {r.who}<small>{r.detail}</small></div>
          <Badge t={r.sev} tone={r.sev === "عالٍ" ? "bad" : r.sev === "متوسط" ? "warn" : ""} />
          {a[r.id] ? <Badge t={a[r.id]} tone="go" /> :
            <div className="acts"><button className="btn outline sm" onClick={() => setA({ ...a, [r.id]: "تحذير" })}>تحذير</button><button className="btn outline sm" onClick={() => setA({ ...a, [r.id]: "إيقاف" })}>إيقاف</button><button className="btn primary dark sm" onClick={() => setA({ ...a, [r.id]: "أُغلق" })}>إغلاق</button></div>}
        </li>))}</ul>
    </Card>
    <Card title="لوحة التسرّب خارج المنصة"><div className="kpis"><Kpi n="١٢" l="محاولات هذا الأسبوع" /><Kpi n="٣" l="معلّمون بإنذار" /></div></Card>
    <Card title="عيّنة تسجيلات ٥٪"><ul className="rows plain"><li>جلسة #٨٨٤ — بانتظار المراجعة</li><li>جلسة #٨٧٠ — سليمة ✓</li></ul></Card>
  </>);
}

/* ---------------- finance ---------------- */
function Finance() {
  const [p, setP] = useState<Record<string, string>>({});
  return (<>
    <Card title="تحويلات المعلّمين بانتظار الاعتماد" wide>
      <ul className="rows">{PAYOUTS.map((y) => (
        <li key={y.id}><div><b>{y.teacher}</b><small>{y.period}</small></div><b>{sar(y.net)}</b>
          {p[y.id] ? <Badge t={p[y.id]} tone="go" /> : <button className="btn primary dark sm" onClick={() => setP({ ...p, [y.id]: "تم الاعتماد" })}>اعتماد</button>}
        </li>))}</ul>
    </Card>
    <Card title="طلبات الاسترداد"><ul className="rows">{REFUNDS.map((f) => (
      <li key={f.id}><div><b>جلسة {f.session}</b><small>{f.reason}</small></div><b>{sar(f.amount)}</b>
        {p[f.id] ? <Badge t={p[f.id]} tone="go" /> : <button className="btn outline sm" onClick={() => setP({ ...p, [f.id]: "تم الاسترداد" })}>تنفيذ</button>}</li>))}</ul></Card>
    <Card title="التسوية والضريبة"><ul className="rows plain"><li>تسوية موياسر: مطابقة ✓ (محاكاة)</li><li>ضريبة القيمة المضافة ١٥٪ على العمولة</li><li>فاتورة إلكترونية (ZATCA): قيد الربط</li></ul></Card>
  </>);
}

/* ---------------- admin ---------------- */
function Admin() {
  const [log, setLog] = useState<string[]>(AUDIT_SEED);
  const act = (t: string) => setLog([`الآن — admin/طلال: ${t}`, ...log]);
  return (<>
    <Card title="مؤشرات المنصة" wide><div className="kpis">
      <Kpi n="١٨٤" l="معلّم موثّق" /><Kpi n="١٢٤" l="حصة اليوم" /><Kpi n="٢.١٪" l="نسبة النزاعات" /><Kpi n="٨٨٬٤٠٠ ر.س" l="إجمالي المعاملات (GMV)" /></div></Card>
    <Card title="الرسوم والسياسات">
      <ul className="rows plain"><li>العمولة: ٢٠٪ أول ٥ حصص، ١٢٪ بعدها</li><li>إلغاء قبل ٢٤ ساعة: استرداد كامل</li><li>غياب المعلّم: استرداد كامل</li></ul>
      <button className="btn outline" onClick={() => act("طلب تعديل سياسة الإلغاء (تجريبي)")}>تعديل السياسات</button>
    </Card>
    <Card title="التصنيفات"><ul className="rows plain"><li>مدرسي · قرآن · لغات · فنون · برمجة</li></ul><button className="btn outline" onClick={() => act("إضافة تصنيف «مهارات حياتية»")}>+ تصنيف</button></Card>
    <Card title="سجل التدقيق (لا يُحذف)" wide><ul className="rows plain auditlog">{log.map((l, i) => <li key={i}>{l}</li>)}</ul></Card>
  </>);
}

const VIEWS: Record<RoleKey, (p: { name: string }) => ReactNode> = {
  learner: (p) => <Learner {...p} />, guardian: () => <Guardian />, minor: () => <Minor />, teacher: () => <Teacher />,
  vetting: () => <Vetting />, safety: () => <Safety />, finance: () => <Finance />, admin: () => <Admin />,
};
