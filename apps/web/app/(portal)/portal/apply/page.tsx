"use client";
import { useCallback, useEffect, useState } from "react";
import { ErrorNote, Field, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { dayLabel, sar } from "../../../../lib/format";
import { useSession } from "../../../../lib/session";

interface Me {
  status: string;
  conductVersion: string;
  profile: { bio: string | null; languages: string[]; freelanceDocumentNo: string | null; hasEmployerNoc: boolean; hasIntroVideo: boolean; iban: string | null; ibanHolderName: string | null; conductSigned: boolean; adultsOnly: boolean };
  categories: { categoryId: number; nameAr: string; priceHalalas: number; approved: boolean }[];
  credentials: { id: string; categoryId: number; kind: string; verdict: string | null }[];
  lastDecision: { decision: string; reason: string | null; at: string } | null;
  missing: string[];
}
interface Cat { id: number; nameAr: string; minPriceHalalas: number; maxPriceHalalas: number }

const LANGS: [string, string][] = [["ar", "العربية"], ["en", "English"], ["ur", "اردو"], ["hi", "हिन्दी"], ["fr", "Français"], ["tl", "Tagalog"], ["other", "أخرى"]];
const KINDS: [string, string][] = [["degree", "شهادة جامعية"], ["ijazah", "إجازة"], ["certificate", "شهادة تخصص"], ["portfolio", "أعمال سابقة"], ["sample_video", "فيديو تجريبي"]];
const MISSING: Record<string, string> = { identity: "توثيق الهوية", freelance_document: "وثيقة العمل الحر", bio: "النبذة", languages: "اللغات", intro_video: "فيديو التعريف", categories: "التخصصات", credentials: "مستند واحد على الأقل لكل تخصص", code_of_conduct: "توقيع ميثاق السلوك", iban: "الحساب البنكي" };
const STATUS: Record<string, string> = { draft: "مسودة", submitted: "قيد المراجعة", interview: "في مرحلة المقابلة", approved: "معتمد", conditional: "معتمد مشروط", rejected: "مرفوض", suspended: "موقوف" };

const CODE = [
  "لا أشارك رقم جوالي أو بريدي أو حساباتي ولا أطلب ذلك من المتعلّم، وكل التواصل داخل المنصة.",
  "لا أتواصل مع أي طفل خارج حجز قائم، ولا أراسل القاصر بما لا علاقة له بالدرس.",
  "الدرس يتم داخل المنصة فقط، وأحضر في موعدي. الغياب أو الإلغاء المتكرر يُحاسَب.",
  "ما أذكره عن مؤهلاتي وخبرتي صحيح، ويحق للمنصة التحقق منه وسحب الاعتماد عند المخالفة.",
  "أي سلوك مخلّ مع قاصر يعني الحظر الفوري وإبلاغ الجهات المختصة.",
  "المخالفات تتصاعد: تنبيه، ثم إيقاف 14 يوماً مع تجميد التحويلات، ثم حظر.",
];

/** No storage is wired yet: only the file name is recorded, under the key shape the API requires. */
const keyFor = (userId: string, file: File | undefined, fallback: string) => {
  const base = (file?.name ?? fallback).replace(/[^A-Za-z0-9._-]/g, "") || fallback;
  return `uploads/${userId}/${Date.now()}-${base}`.slice(0, 200);
};

export default function Apply() {
  return (
    <Shell roles={["teacher"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const { user } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([api<Me>("GET", "/teacher/me"), api<{ items: Cat[] }>("GET", "/categories")]);
      setMe(m);
      setCats(c.items);
    } catch (e) {
      setErr(e);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!user) return null;
  if (!me) return <><h1>ملفي كمعلّم</h1><ErrorNote error={err} />{!err && <Spinner />}</>;
  const editable = me.status === "draft" || me.status === "rejected";
  return (
    <>
      <h1>ملفي كمعلّم</h1>
      <div className="card">
        <div className="row between"><b>حالة الطلب</b><span className={`badge ${me.status === "approved" || me.status === "conditional" ? "ok" : me.status === "rejected" ? "bad" : "wait"}`}>{STATUS[me.status] ?? me.status}</span></div>
        {me.status === "submitted" && <p className="muted">استلمنا طلبك. يراجع فريق التدقيق مستنداتك ثم يتواصل معك لموعد المقابلة.</p>}
        {me.status === "interview" && <p className="muted">مستنداتك قيد الاعتماد، وتتم المقابلة معك قريباً.</p>}
        {(me.status === "approved" || me.status === "conditional") && <p className="muted">ملفك ظاهر للمتعلّمين{me.profile.adultsOnly ? " (للكبار فقط حالياً)" : ""}. أضف أوقاتك من صفحة «أوقاتي».</p>}
        {me.status === "rejected" && <div className="note err">رُفض طلبك{me.lastDecision?.reason ? `: ${me.lastDecision.reason}` : ""}. يمكنك التعديل وإعادة التقديم بعد 90 يوماً من الرفض ({me.lastDecision ? dayLabel(me.lastDecision.at) : ""}).</div>}
        {editable && me.missing.length > 0 && <div className="note sand">ينقصك: {me.missing.map((m) => MISSING[m] ?? m).join("، ")}</div>}
      </div>

      {editable && (
        <>
          <div className="note sand">سياسة المنصة: الدرس الأول لكل متعلّم معك مضمون. إن لم يناسبه استرد مبلغه كاملاً، وتعوّضك المنصة بنصف صافي ربحك من ذلك الدرس. لا يُحسب هذا مخالفة عليك.</div>
          <p className="muted small">رفع الملفات تجريبي حالياً: يُسجَّل اسم الملف فقط حتى يُربط التخزين.</p>
          <ProfileForm me={me} userId={user.id} onSaved={load} />
          <CategoriesForm me={me} cats={cats} onSaved={load} />
          {me.categories.length > 0 && <Credentials me={me} userId={user.id} onSaved={load} />}
          <Conduct me={me} onSaved={load} />
          <Payout me={me} onSaved={load} />
          <Submit me={me} onSaved={load} />
        </>
      )}
      {!editable && me.categories.length > 0 && (
        <div className="card"><h3>تخصصاتي</h3>
          {me.categories.map((c) => <div key={c.categoryId} className="row between"><span>{c.nameAr}</span><span className="muted small">{sar(c.priceHalalas)} · {c.approved ? "معتمد" : "قيد الاعتماد"}</span></div>)}
        </div>
      )}
    </>
  );
}

function useSave(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null); setOk(false);
    try { await fn(); setOk(true); onSaved(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return { busy, err, ok, run };
}

function Saved({ s }: { s: { err: unknown; ok: boolean } }) {
  return <>{<ErrorNote error={s.err} />}{s.ok && <div className="note info">تم الحفظ.</div>}</>;
}

function ProfileForm({ me, userId, onSaved }: { me: Me; userId: string; onSaved: () => void }) {
  const [bio, setBio] = useState(me.profile.bio ?? "");
  const [langs, setLangs] = useState<string[]>(me.profile.languages.length ? me.profile.languages : ["ar"]);
  const [doc, setDoc] = useState(me.profile.freelanceDocumentNo ?? "");
  const [video, setVideo] = useState<File | undefined>();
  const [noc, setNoc] = useState<File | undefined>();
  const s = useSave(onSaved);
  const save = () => s.run(() => api("PUT", "/teacher/profile", {
    bio: bio.trim(), languages: langs, freelanceDocumentNo: doc.trim(),
    introVideoKey: keyFor(userId, video, "intro.mp4"),
    ...(noc ? { employerNocKey: keyFor(userId, noc, "noc.pdf") } : {}),
  }));
  return (
    <div className="card stack">
      <h3>1. التعريف بك</h3>
      <Field label="نبذة عنك" hint={`40 حرفاً على الأقل (${bio.trim().length}). تظهر للمتعلّمين.`}><textarea rows={4} maxLength={1000} value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
      <div className="stack"><span>لغات التدريس</span>
        <div className="row">{LANGS.map(([k, l]) => <label key={k} className="chip"><input type="checkbox" checked={langs.includes(k)} onChange={(e) => setLangs(e.target.checked ? [...langs, k] : langs.filter((x) => x !== k))} /> {l}</label>)}</div>
      </div>
      <Field label="رقم وثيقة العمل الحر"><input className="ltr" value={doc} onChange={(e) => setDoc(e.target.value)} /></Field>
      <Field label="فيديو تعريفي قصير" hint={me.profile.hasIntroVideo ? "سبق رفعه. اختر ملفاً جديداً للاستبدال، أو ارفع نفس الملف عند الحفظ." : undefined}><input type="file" accept="video/*" onChange={(e) => setVideo(e.target.files?.[0])} /></Field>
      <Field label="خطاب عدم ممانعة جهة العمل (اختياري، للموظفين)"><input type="file" accept="application/pdf,image/*" onChange={(e) => setNoc(e.target.files?.[0])} /></Field>
      <Saved s={s} />
      <div><button className="btn" disabled={s.busy || bio.trim().length < 40 || !langs.length || doc.trim().length < 4} onClick={save}>حفظ</button></div>
    </div>
  );
}

function CategoriesForm({ me, cats, onSaved }: { me: Me; cats: Cat[]; onSaved: () => void }) {
  const [sel, setSel] = useState<Record<number, string>>(() => Object.fromEntries(me.categories.map((c) => [c.categoryId, String(c.priceHalalas / 100)])));
  const s = useSave(onSaved);
  const ids = Object.keys(sel).map(Number);
  const bad = ids.some((id) => { const c = cats.find((x) => x.id === id); const p = Math.round(Number(sel[id]) * 100); return !c || !(p >= c.minPriceHalalas && p <= c.maxPriceHalalas); });
  const save = () => {
    if (me.credentials.length > 0 && !confirm("تغيير التخصصات يعيد المراجعة، وتُحذف مستندات أي تخصص ترفعه من القائمة. متابعة؟")) return;
    return s.run(() => api("PUT", "/teacher/categories", { categories: ids.map((id) => ({ categoryId: id, priceHalalas: Math.round(Number(sel[id]) * 100) })) }));
  };
  return (
    <div className="card stack">
      <h3>2. التخصصات والأسعار</h3>
      <p className="muted small">اختر حتى 3 تخصصات، وسعر الساعة ضمن النطاق المسموح.</p>
      {cats.map((c) => {
        const on = c.id in sel;
        return (
          <div key={c.id} className="row between">
            <label className="row"><input type="checkbox" checked={on} disabled={!on && ids.length >= 3} onChange={(e) => { const n = { ...sel }; if (e.target.checked) n[c.id] = String(c.minPriceHalalas / 100); else delete n[c.id]; setSel(n); }} /> {c.nameAr}</label>
            {on ? <span className="row"><input style={{ width: 90 }} inputMode="decimal" value={sel[c.id]} onChange={(e) => setSel({ ...sel, [c.id]: e.target.value })} aria-label={`سعر ${c.nameAr}`} /><span className="muted small">ر.س ({c.minPriceHalalas / 100}–{c.maxPriceHalalas / 100})</span></span> : <span className="muted small">{c.minPriceHalalas / 100}–{c.maxPriceHalalas / 100} ر.س</span>}
          </div>
        );
      })}
      <Saved s={s} />
      <div><button className="btn" disabled={s.busy || ids.length === 0 || bad} onClick={save}>حفظ التخصصات</button></div>
    </div>
  );
}

function Credentials({ me, userId, onSaved }: { me: Me; userId: string; onSaved: () => void }) {
  const [kind, setKind] = useState<Record<number, string>>({});
  const [file, setFile] = useState<Record<number, File | undefined>>({});
  const s = useSave(onSaved);
  const add = (categoryId: number) => s.run(() => api("POST", "/teacher/credentials", { categoryId, kind: kind[categoryId] ?? "degree", fileKey: keyFor(userId, file[categoryId], "doc.pdf") }));
  return (
    <div className="card stack">
      <h3>3. المستندات</h3>
      <p className="muted small">لكل تخصص مستند واحد على الأقل يثبت أهليتك (شهادة أو إجازة أو أعمال).</p>
      {me.categories.map((c) => {
        const mine = me.credentials.filter((x) => x.categoryId === c.categoryId);
        return (
          <div key={c.categoryId} className="stack">
            <b>{c.nameAr}</b>
            {mine.length === 0 && <span className="muted small">لا مستندات بعد.</span>}
            {mine.map((x) => <span key={x.id} className="chip">{KINDS.find(([k]) => k === x.kind)?.[1] ?? x.kind}</span>)}
            <div className="row">
              <select value={kind[c.categoryId] ?? "degree"} onChange={(e) => setKind({ ...kind, [c.categoryId]: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input type="file" onChange={(e) => setFile({ ...file, [c.categoryId]: e.target.files?.[0] })} />
              <button className="btn ghost" disabled={s.busy || !file[c.categoryId]} onClick={() => add(c.categoryId)}>إضافة</button>
            </div>
          </div>
        );
      })}
      <Saved s={s} />
    </div>
  );
}

function Conduct({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [agree, setAgree] = useState(false);
  const s = useSave(onSaved);
  return (
    <div className="card stack">
      <h3>4. ميثاق السلوك</h3>
      <ol style={{ margin: 0, paddingInlineStart: 20, display: "flex", flexDirection: "column", gap: 6 }}>{CODE.map((c) => <li key={c}>{c}</li>)}</ol>
      {me.profile.conductSigned ? <div className="note info">وقّعت الميثاق (النسخة {me.conductVersion}).</div> : (
        <>
          <label className="row"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> قرأت الميثاق وألتزم به</label>
          <Saved s={s} />
          <div><button className="btn" disabled={s.busy || !agree} onClick={() => s.run(() => api("POST", "/teacher/code-of-conduct/sign", { version: me.conductVersion }))}>توقيع الميثاق</button></div>
        </>
      )}
    </div>
  );
}

function Payout({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState(me.profile.ibanHolderName ?? "");
  const s = useSave(onSaved);
  return (
    <div className="card stack">
      <h3>5. الحساب البنكي</h3>
      <p className="muted small">يجب أن يكون الحساب باسمك كما في الهوية. {me.profile.iban && <>الحالي: <span className="ltr">{me.profile.iban}</span></>}</p>
      <Field label="رقم الآيبان"><input className="ltr" placeholder="SA…" value={iban} onChange={(e) => setIban(e.target.value)} /></Field>
      <Field label="اسم صاحب الحساب"><input value={holder} onChange={(e) => setHolder(e.target.value)} /></Field>
      <Saved s={s} />
      <div><button className="btn" disabled={s.busy || iban.trim().length < 15 || holder.trim().length < 5} onClick={() => s.run(() => api("PUT", "/teacher/payout", { iban, holderName: holder.trim() }))}>حفظ الحساب</button></div>
    </div>
  );
}

function Submit({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const s = useSave(onSaved);
  return (
    <div className="card stack">
      <h3>6. تقديم الطلب</h3>
      {me.missing.length > 0 ? <p className="muted">أكمل الخطوات الناقصة أولاً: {me.missing.map((m) => MISSING[m] ?? m).join("، ")}.</p> : <p>كل شيء جاهز. بعد التقديم لا يمكنك تعديل الملف حتى يصدر القرار.</p>}
      <ErrorNote error={s.err} />
      <div><button className="btn coral" disabled={s.busy || me.missing.length > 0} onClick={() => confirm("تقديم الطلب للمراجعة؟") && s.run(() => api("POST", "/teacher/submit"))}>تقديم الطلب</button></div>
    </div>
  );
}
