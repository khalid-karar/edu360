"use client";
import { ErrorNote, Shell, Spinner } from "../../../../components/portal-ui";
import { useLoad } from "../../../../components/staff/common";

interface Overview {
  school: { name: string; inviteCode: string };
  families: number;
  minFamilies: number;
  stats: null | {
    completedLessons: number;
    hours: number;
    activeFamilies30d: number | null;
    byCategory: { category: string; lessons: number }[];
    signupsByMonth: { month: string; signups: number }[];
  };
}

export default function School() {
  return (
    <Shell roles={["school"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const q = useLoad<Overview>("/school/overview");
  if (q.err) return <ErrorNote error={q.err} />;
  if (!q.data) return <Spinner />;
  const { school, families, minFamilies, stats } = q.data;
  const max = Math.max(1, ...(stats?.signupsByMonth.map((m) => m.signups) ?? [1]));
  return (
    <>
      <h1>{school.name}</h1>
      <div className="card stack">
        <h3>رمز المدرسة</h3>
        <p>شاركه مع أولياء الأمور ليكتبوه عند التسجيل:</p>
        <b className="ltr" style={{ fontSize: 28, letterSpacing: 4 }} data-testid="school-code">{school.inviteCode}</b>
      </div>
      <div className="grid">
        <div className="card tight"><span className="muted small">الأسر المسجّلة عبر مدرستك</span><b style={{ fontSize: 28 }}>{families}</b></div>
        {stats && <div className="card tight"><span className="muted small">دروس مكتملة</span><b style={{ fontSize: 28 }}>{stats.completedLessons}</b></div>}
        {stats && <div className="card tight"><span className="muted small">ساعات تعلّم</span><b style={{ fontSize: 28 }}>{stats.hours}</b></div>}
        {stats?.activeFamilies30d != null && <div className="card tight"><span className="muted small">أسر نشطة آخر 30 يوماً</span><b style={{ fontSize: 28 }}>{stats.activeFamilies30d}</b></div>}
      </div>
      {!stats && <div className="note sand">نحمي خصوصية الأسر: تظهر أرقام الدروس عندما تصل المجموعة إلى {minFamilies} أسر على الأقل.</div>}
      {stats && stats.signupsByMonth.length > 0 && (
        <div className="card stack">
          <h3>التسجيل الشهري</h3>
          {stats.signupsByMonth.map((m) => (
            <div key={m.month} className="row" style={{ gap: 8 }}>
              <span className="ltr small" style={{ width: 70 }}>{m.month}</span>
              <div style={{ background: "var(--accent, #1f6f5c)", height: 12, borderRadius: 6, width: `${(m.signups / max) * 100}%`, minWidth: 4 }} />
              <span className="small">{m.signups}</span>
            </div>
          ))}
        </div>
      )}
      {stats && stats.byCategory.length > 0 && (
        <div className="card stack">
          <h3>التخصصات الأكثر طلباً</h3>
          {stats.byCategory.map((c) => <div key={c.category} className="row between"><span>{c.category}</span><b>{c.lessons}</b></div>)}
        </div>
      )}
    </>
  );
}
