import type { Db } from "../db/db.js";
import type { TeacherStats } from "../domain/badges.js";

/** Everything the badges, the rating filter and the sort need, for the given teachers, in one query. */
export async function teacherStats(db: Db, ids: string[]): Promise<Map<string, TeacherStats>> {
  if (!ids.length) return new Map();
  const r = await db.query<{ user_id: string; completed_sessions: number; reliability_score: string; rating_avg: string | null; rating_n: number; rank: number | null; reply_avg: string | null; reply_n: number }>(
    `SELECT t.user_id, t.completed_sessions, t.reliability_score,
            rt.avg AS rating_avg, COALESCE(rt.n, 0)::int AS rating_n,
            CASE WHEN t.approved_at IS NULL THEN NULL
                 ELSE (SELECT count(*)::int FROM teacher_profiles x WHERE x.approved_at IS NOT NULL AND (x.approved_at, x.user_id) <= (t.approved_at, t.user_id)) END AS rank,
            rp.avg AS reply_avg, COALESCE(rp.n, 0)::int AS reply_n
       FROM teacher_profiles t
       LEFT JOIN LATERAL (SELECT avg(r.rating) AS avg, count(*) AS n FROM reviews r JOIN bookings b ON b.id = r.booking_id WHERE b.teacher_id = t.user_id) rt ON true
       LEFT JOIN LATERAL (
         SELECT avg(mins) AS avg, count(*) AS n FROM (
           SELECT extract(epoch FROM (min(m.created_at) FILTER (WHERE m.sender_id = i.teacher_id) - min(m.created_at) FILTER (WHERE m.sender_id = i.payer_id))) / 60 AS mins
             FROM inquiries i JOIN messages m ON m.inquiry_id = i.id AND NOT m.blocked
            WHERE i.teacher_id = t.user_id GROUP BY i.id
           HAVING bool_or(m.sender_id = i.teacher_id) AND bool_or(m.sender_id = i.payer_id)
         ) x WHERE mins >= 0
       ) rp ON true
      WHERE t.user_id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(
    r.rows.map((x) => [
      x.user_id,
      {
        completedSessions: x.completed_sessions,
        reliability: Number(x.reliability_score),
        ratingAvg: x.rating_avg === null ? null : Number(x.rating_avg),
        ratingCount: x.rating_n,
        approvalRank: x.rank,
        replyMinutesAvg: x.reply_avg === null ? null : Number(x.reply_avg),
        replyThreads: x.reply_n,
      },
    ]),
  );
}
