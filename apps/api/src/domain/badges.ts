/** Trust badges. Earned from what a teacher has done on the platform, never bought and never set by hand. Pure: no database. */
export const BADGES = ["founding", "experienced", "top_rated", "reliable", "fast_replier"] as const;
export type Badge = (typeof BADGES)[number];

export const FOUNDING_LIMIT = 100;        // the first 100 teachers approved
export const EXPERIENCED_SESSIONS = 20;   // completed lessons
export const TOP_RATED_AVG = 4.7;
export const TOP_RATED_MIN_REVIEWS = 5;
export const RELIABLE_SCORE = 0.95;
export const RELIABLE_MIN_SESSIONS = 10;
export const FAST_REPLY_MINUTES = 180;    // average time to first answer on pre-booking questions
export const FAST_REPLY_MIN_THREADS = 3;

export interface TeacherStats {
  completedSessions: number;
  reliability: number;
  ratingAvg: number | null;
  ratingCount: number;
  /** 1 = first teacher ever approved. Null when not approved yet. */
  approvalRank: number | null;
  replyMinutesAvg: number | null;
  replyThreads: number;
}

export function badgesFor(s: TeacherStats): Badge[] {
  const out: Badge[] = [];
  if (s.approvalRank !== null && s.approvalRank <= FOUNDING_LIMIT) out.push("founding");
  if (s.completedSessions >= EXPERIENCED_SESSIONS) out.push("experienced");
  if (s.ratingAvg !== null && s.ratingCount >= TOP_RATED_MIN_REVIEWS && s.ratingAvg >= TOP_RATED_AVG) out.push("top_rated");
  if (s.completedSessions >= RELIABLE_MIN_SESSIONS && s.reliability >= RELIABLE_SCORE) out.push("reliable");
  if (s.replyMinutesAvg !== null && s.replyThreads >= FAST_REPLY_MIN_THREADS && s.replyMinutesAvg <= FAST_REPLY_MINUTES) out.push("fast_replier");
  return out;
}
