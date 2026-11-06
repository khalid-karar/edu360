"use client";
import { useEffect, useState } from "react";
import { BADGE, TeacherCard, LANG, type TeacherItem } from "../../../../components/teacher-card";
import { ErrorNote, Field, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { useSession } from "../../../../lib/session";

interface Cat { id: number; nameAr: string; allowsMinors: boolean }
interface Child { id: string; displayName: string; age: number }

export default function Search() {
  return (
    <Shell roles={["learner", "guardian"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const { user } = useSession();
  const [cats, setCats] = useState<Cat[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [f, setF] = useState({ categoryId: "", language: "", gender: "", maxPrice: "", childId: "", badge: "", minRating: "", sort: "popular" });
  const [items, setItems] = useState<TeacherItem[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    api<{ items: Cat[] }>("GET", "/categories").then((r) => setCats(r.items)).catch(setErr);
    if (user?.role === "guardian") api<{ items: Child[] }>("GET", "/guardian/children").then((r) => setChildren(r.items)).catch(() => {});
  }, [user]);

  function query(offset: number) {
    const q = new URLSearchParams();
    if (f.categoryId) q.set("categoryId", f.categoryId);
    if (f.language) q.set("language", f.language);
    if (f.gender) q.set("gender", f.gender);
    if (f.maxPrice) q.set("maxPriceHalalas", String(Math.round(Number(f.maxPrice) * 100)));
    if (f.childId) q.set("childId", f.childId);
    if (f.badge) q.set("badge", f.badge);
    if (f.minRating) q.set("minRating", f.minRating);
    if (f.sort !== "popular") q.set("sort", f.sort);
    q.set("offset", String(offset));
    return api<{ items: TeacherItem[]; nextOffset: number | null }>("GET", `/teachers?${q}`);
  }

  useEffect(() => {
    setItems(null);
    setErr(null);
    query(0).then((r) => { setItems(r.items); setNext(r.nextOffset); }).catch(setErr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const shown = cats.filter((c) => !f.childId || c.allowsMinors);

  return (
    <>
      <div>
        <h1>ابحث عن معلّم</h1>
        <p className="muted">معلّمون موثّقون الهوية ومدقَّقة شهاداتهم. الدفع محمي حتى انتهاء الدرس.</p>
      </div>
      <div className="card">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {children.length > 0 && (
            <Field label="البحث لـ">
              <select value={f.childId} onChange={set("childId")}>
                <option value="">لي أنا</option>
                {children.map((c) => <option key={c.id} value={c.id}>{c.displayName} ({c.age} سنة)</option>)}
              </select>
            </Field>
          )}
          <Field label="التخصص">
            <select value={f.categoryId} onChange={set("categoryId")}>
              <option value="">الكل</option>
              {shown.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
            </select>
          </Field>
          <Field label="لغة التدريس">
            <select value={f.language} onChange={set("language")}>
              <option value="">الكل</option>
              {Object.entries(LANG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="جنس المعلّم">
            <select value={f.gender} onChange={set("gender")}>
              <option value="">الكل</option>
              <option value="female">معلّمة</option>
              <option value="male">معلّم</option>
            </select>
          </Field>
          <Field label="أعلى سعر للساعة (ر.س)">
            <input inputMode="numeric" value={f.maxPrice} onChange={(e) => setF({ ...f, maxPrice: e.target.value.replace(/\D/g, "") })} placeholder="مثال: 100" />
          </Field>
          <Field label="الشارة">
            <select value={f.badge} onChange={set("badge")}>
              <option value="">الكل</option>
              {Object.entries(BADGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="التقييم">
            <select value={f.minRating} onChange={set("minRating")}>
              <option value="">الكل</option>
              <option value="4">4 فأكثر</option>
              <option value="4.5">4.5 فأكثر</option>
            </select>
          </Field>
          <Field label="الترتيب">
            <select value={f.sort} onChange={set("sort")}>
              <option value="popular">الأكثر دروساً</option>
              <option value="rating">الأعلى تقييماً</option>
              <option value="price_low">الأقل سعراً</option>
              <option value="price_high">الأعلى سعراً</option>
            </select>
          </Field>
        </div>
      </div>
      <ErrorNote error={err} />
      {!items && !err && <Spinner />}
      {items && items.length === 0 && <div className="empty">لا نتائج بهذه الخيارات. جرّب تخفيف الفلاتر.</div>}
      {items && items.length > 0 && <div className="grid">{items.map((t) => <TeacherCard key={t.teacherId} t={t} childId={f.childId || undefined} />)}</div>}
      {next !== null && (
        <button className="btn ghost" onClick={() => query(next).then((r) => { setItems([...(items ?? []), ...r.items]); setNext(r.nextOffset); }).catch(setErr)}>عرض المزيد</button>
      )}
    </>
  );
}
