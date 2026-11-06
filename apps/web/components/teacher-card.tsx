import Link from "next/link";
import { shortDay, sar, timeLabel } from "../lib/format";
import { Avatar } from "./portal-ui";

export interface TeacherItem {
  teacherId: string;
  displayName: string;
  gender: string | null;
  languages: string[];
  bioPreview?: string | null;
  completedSessions: number;
  rating: { average: number | null; count: number };
  categories: { categoryId: number; nameAr: string; priceHalalas: number }[];
  nextSlotAt: string | null;
  forChild?: { sameGender: boolean; approved: boolean; crossGenderApproved: boolean };
}
export const LANG: Record<string, string> = { ar: "العربية", en: "English", ur: "اردو", hi: "हिन्दी", fr: "Français", tl: "Tagalog", other: "أخرى" };

export function Stars({ rating }: { rating: TeacherItem["rating"] }) {
  if (!rating.count) return <span className="muted small">لا تقييمات بعد</span>;
  return <span className="small"><span style={{ color: "#e8a317" }}>★</span> <b>{rating.average}</b> <span className="muted">({rating.count})</span></span>;
}

export function TeacherCard({ t, childId }: { t: TeacherItem; childId?: string }) {
  const href = `/portal/teacher?id=${t.teacherId}${childId ? `&child=${childId}` : ""}`;
  const from = Math.min(...t.categories.map((c) => c.priceHalalas));
  return (
    <Link href={href} className="card" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="row">
        <Avatar name={t.displayName} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{t.displayName}</h3>
          <div className="row" style={{ gap: 8 }}>
            <Stars rating={t.rating} />
            <span className="muted small">· {t.completedSessions} درس</span>
          </div>
        </div>
        {t.categories.length > 0 && <div className="price">{sar(from)}<small className="muted"> /ساعة</small></div>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {t.categories.map((c) => <span className="chip" key={c.categoryId}>{c.nameAr}</span>)}
        {t.languages.map((l) => <span className="chip" key={l} style={{ background: "#fff", border: "1px solid var(--line)" }}>{LANG[l] ?? l}</span>)}
      </div>
      {t.bioPreview && <p className="muted small">{t.bioPreview}</p>}
      <div className="row between small">
        {t.nextSlotAt ? <span>أقرب موعد: <b>{shortDay(t.nextSlotAt)} {timeLabel(t.nextSlotAt)}</b></span> : <span className="muted">لا مواعيد متاحة حالياً</span>}
        {t.forChild && !t.forChild.approved && <span className="badge wait">يحتاج اعتمادك</span>}
        {t.forChild?.approved && <span className="badge ok">معتمد لطفلك</span>}
      </div>
    </Link>
  );
}
