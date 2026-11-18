import type { Db } from "../db/db.js";

const DAY = 86_400_000;
const RIYADH_OFFSET = 3 * 3_600_000; // no daylight saving, so a fixed offset is exact
const DAYS = 14;

/** Calendar days (Riyadh) ending today, oldest first, as "YYYY-MM-DD". */
function lastDays(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now.getTime() + RIYADH_OFFSET - i * DAY).toISOString().slice(0, 10));
  return out;
}
const fill = (days: string[], rows: { day: string; n: number }[]) => {
  const by = new Map(rows.map((r) => [r.day, r.n]));
  return days.map((day) => ({ day, n: by.get(day) ?? 0 }));
};
const count = async (db: Db, sql: string, params: unknown[] = []) => (await db.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;

/**
 * The numbers an administrator checks first: who is joining, where teachers are in the funnel, how lessons and money are moving,
 * and what is waiting for a person. Counts and sums only: no row here identifies anyone.
 */
export async function adminAnalytics(db: Db, now: Date) {
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since7 = new Date(now.getTime() - 7 * DAY);
  const days = lastDays(now, DAYS);
  const dayOf = (col: string) => `to_char(${col} + interval '3 hours', 'YYYY-MM-DD')`;
  const windowStart = new Date(now.getTime() - (DAYS + 1) * DAY);

  const roles = await db.query<{ role: string; n: number }>("SELECT role::text AS role, count(*)::int AS n FROM users WHERE deleted_at IS NULL AND role IN ('learner','guardian','minor','teacher','school') GROUP BY role");
  const signups = await db.query<{ day: string; n: number }>(
    `SELECT ${dayOf("created_at")} AS day, count(*)::int AS n FROM users WHERE created_at > $1 AND role IN ('learner','guardian','teacher') GROUP BY 1`,
    [windowStart],
  );
  const pipeline = await db.query<{ status: string; n: number }>("SELECT status::text AS status, count(*)::int AS n FROM teacher_profiles GROUP BY status");
  const bookings = await db.query<{ status: string; n: number }>("SELECT status::text AS status, count(*)::int AS n FROM bookings WHERE created_at > $1 GROUP BY status", [since30]);
  const completed = await db.query<{ day: string; n: number }>(
    `SELECT ${dayOf("p.captured_at")} AS day, count(*)::int AS n FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE b.status = 'completed' AND p.captured_at > $1 GROUP BY 1`,
    [windowStart],
  );
  const money = (await db.query<{ gmv: string; commission: string; refunded: string; lessons: number }>(
    `SELECT COALESCE(sum(captured_halalas),0)::text AS gmv, COALESCE(sum(commission_halalas),0)::text AS commission,
            COALESCE(sum(refunded_halalas),0)::text AS refunded, count(*)::int AS lessons
       FROM payments WHERE captured_at > $1`,
    [since30],
  )).rows[0]!;
  const owed = await db.query<{ status: string; total: string }>("SELECT status::text AS status, COALESCE(sum(amount_halalas),0)::text AS total FROM payouts WHERE status IN ('pending','approved','on_hold') GROUP BY status");
  const ratings = (await db.query<{ avg: string | null; n: number }>("SELECT avg(rating)::text AS avg, count(*)::int AS n FROM reviews WHERE created_at > $1", [since30])).rows[0]!;
  const schools = await db.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM schools GROUP BY status");

  const byRole = Object.fromEntries(roles.rows.map((r) => [r.role, r.n]));
  const num = (rows: { n: number }[]) => rows.reduce((a, r) => a + r.n, 0);
  const statusCount = (rows: { status: string; n: number }[], s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  const gmv = Number(money.gmv);
  const refunded = Number(money.refunded);

  return {
    generatedAt: now.toISOString(),
    users: {
      learners: byRole["learner"] ?? 0,
      guardians: byRole["guardian"] ?? 0,
      children: byRole["minor"] ?? 0,
      teachers: byRole["teacher"] ?? 0,
      schools: byRole["school"] ?? 0,
      newLast7d: await count(db, "SELECT count(*)::int AS n FROM users WHERE created_at > $1 AND role IN ('learner','guardian','teacher')", [since7]),
      signupsByDay: fill(days, signups.rows),
    },
    teacherPipeline: {
      draft: statusCount(pipeline.rows, "draft"),
      submitted: statusCount(pipeline.rows, "submitted"),
      interview: statusCount(pipeline.rows, "interview"),
      approved: statusCount(pipeline.rows, "approved") + statusCount(pipeline.rows, "conditional"),
      rejected: statusCount(pipeline.rows, "rejected"),
      suspended: statusCount(pipeline.rows, "suspended"),
    },
    bookings30d: {
      total: num(bookings.rows),
      byStatus: Object.fromEntries(bookings.rows.map((r) => [r.status, r.n])),
      completedByDay: fill(days, completed.rows),
    },
    money30d: {
      grossHalalas: gmv,
      commissionHalalas: Number(money.commission),
      refundedHalalas: refunded,
      paidLessons: money.lessons,
      averageLessonHalalas: money.lessons ? Math.round(gmv / money.lessons) : 0,
      refundRate: gmv ? Math.round((refunded / gmv) * 1000) / 10 : 0,
      payoutsOwedHalalas: Object.fromEntries(owed.rows.map((r) => [r.status, Number(r.total)])),
    },
    quality30d: { reviews: ratings.n, averageRating: ratings.avg ? Math.round(Number(ratings.avg) * 10) / 10 : null },
    waiting: {
      teacherApplications: statusCount(pipeline.rows, "submitted") + statusCount(pipeline.rows, "interview"),
      openReports: await count(db, "SELECT count(*)::int AS n FROM reports WHERE status IN ('open','reviewing')"),
      openFlags: await count(db, "SELECT count(*)::int AS n FROM flags WHERE status = 'open'"),
      openDisputes: await count(db, "SELECT count(*)::int AS n FROM disputes WHERE outcome IS NULL"),
      openAppeals: await count(db, "SELECT count(*)::int AS n FROM appeals WHERE status = 'open'"),
      pendingSchools: statusCount(schools.rows, "pending"),
      pendingCategoryRequests: await count(db, "SELECT count(*)::int AS n FROM category_requests WHERE status = 'pending'"),
      suspendedUsers: await count(db, "SELECT count(*)::int AS n FROM users WHERE status = 'suspended'"),
      bannedUsers: await count(db, "SELECT count(*)::int AS n FROM users WHERE status = 'banned'"),
    },
    schools: {
      approved: statusCount(schools.rows, "approved"),
      pending: statusCount(schools.rows, "pending"),
      families: await count(db, "SELECT count(*)::int AS n FROM users WHERE school_id IS NOT NULL"),
    },
  };
}
