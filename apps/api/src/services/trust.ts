import type { Db } from "../db/db.js";
import { strikeAction, type StrikeAction } from "../domain/strikes.js";
import { HttpError } from "../http/errors.js";
import type { PaymentProvider } from "../payments/provider.js";
import { audit } from "./audit.js";
import { notify } from "./notifications.js";
import { cancelUpcomingForTeacher } from "./bookings.js";

/** A strike counts toward the ladder for 12 months. */
export const STRIKE_ACTIVE_DAYS = 365;
export const SUSPENSION_DAYS = 14;
const DAY = 86_400_000;

export interface StrikeInput {
  userId: string;
  reason: string;
  zeroTolerance: boolean;
  reportId?: string | undefined;
}
export interface StrikeResult {
  strikeId: string;
  level: number;
  action: StrikeAction;
  suspendedUntil: Date | null;
  cancelledBookings: number;
}

/**
 * Applies the published ladder: warning, then a 14-day suspension with payouts frozen, then a permanent ban;
 * zero-tolerance conduct is an instant ban. A suspended or banned teacher disappears from search and every
 * upcoming lesson is cancelled with the learner's hold released. Staff and children cannot be struck
 * (a child's conduct is the guardian's responsibility).
 */
export async function issueStrike(
  d: { db: Db; payments: PaymentProvider; now: () => Date },
  staffId: string,
  input: StrikeInput,
): Promise<StrikeResult> {
  const now = d.now();
  const res = await d.db.tx(async (tx) => {
    const u = (await tx.query<{ role: string; status: string }>("SELECT role, status FROM users WHERE id = $1 FOR UPDATE", [input.userId])).rows[0];
    if (!u || !["learner", "guardian", "teacher"].includes(u.role)) throw new HttpError(u ? 422 : 404, u ? "cannot_strike_role" : "not_found");
    if (u.status === "banned") throw new HttpError(409, "already_banned");
    if (input.reportId) {
      const r = await tx.query("SELECT 1 FROM reports WHERE id = $1 AND reported_user_id = $2", [input.reportId, input.userId]);
      if (!r.rowCount) throw new HttpError(422, "report_mismatch");
    }
    const prior = (
      await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM strikes WHERE user_id = $1 AND created_at > $2", [
        input.userId,
        new Date(now.getTime() - STRIKE_ACTIVE_DAYS * DAY),
      ])
    ).rows[0]!.n;
    const action = strikeAction(prior, input.zeroTolerance);
    const level = input.zeroTolerance ? 3 : Math.min(prior + 1, 3);
    const s = await tx.query<{ id: string }>(
      `INSERT INTO strikes (user_id, level, zero_tolerance, reason, issued_by, created_at, action, report_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [input.userId, level, input.zeroTolerance, input.reason, staffId, now, action, input.reportId ?? null],
    );
    let suspendedUntil: Date | null = null;
    if (action === "suspend_14d") {
      suspendedUntil = new Date(now.getTime() + SUSPENSION_DAYS * DAY);
      await tx.query("UPDATE users SET status='suspended', suspended_until=$2 WHERE id=$1", [input.userId, suspendedUntil]);
    } else if (action === "ban") {
      await tx.query("UPDATE users SET status='banned', suspended_until=NULL WHERE id=$1", [input.userId]);
    }
    if (action !== "warn" && u.role === "teacher") {
      await tx.query("UPDATE teacher_profiles SET status='suspended', payouts_frozen=true WHERE user_id=$1", [input.userId]);
    }
    await notify(tx, { userId: input.userId, kind: "strike", link: "/portal/account" }, now);
    await audit(tx, {
      actorId: staffId,
      action: "safety.strike_issued",
      targetType: "user",
      targetId: input.userId,
      reason: input.reason,
      detail: { strikeId: s.rows[0]!.id, level, action, zeroTolerance: input.zeroTolerance, reportId: input.reportId ?? null },
    });
    return { strikeId: s.rows[0]!.id, level, action, suspendedUntil, teacher: u.role === "teacher" };
  });

  let cancelledBookings = 0;
  if (res.action !== "warn" && res.teacher) cancelledBookings = (await cancelUpcomingForTeacher(d, input.userId)).cancelled;
  return { strikeId: res.strikeId, level: res.level, action: res.action, suspendedUntil: res.suspendedUntil, cancelledBookings };
}

/** Ends 14-day suspensions that have run their course. A ban is never lifted here. */
export async function liftExpiredSuspensions(db: Db, now: Date): Promise<number> {
  const due = await db.query<{ id: string; role: string }>(
    "SELECT id, role FROM users WHERE status = 'suspended' AND suspended_until IS NOT NULL AND suspended_until <= $1 LIMIT 200",
    [now],
  );
  for (const u of due.rows) {
    await db.tx(async (tx) => {
      const r = await tx.query("UPDATE users SET status='active', suspended_until=NULL WHERE id=$1 AND status='suspended' AND suspended_until <= $2", [u.id, now]);
      if (!r.rowCount) return;
      if (u.role === "teacher") {
        await tx.query(
          `UPDATE teacher_profiles SET payouts_frozen=false,
             status = CASE WHEN adults_only THEN 'conditional'::teacher_status ELSE 'approved'::teacher_status END
           WHERE user_id=$1 AND status='suspended'`,
          [u.id],
        );
      }
      await audit(tx, { actorId: null, action: "safety.suspension_ended", targetType: "user", targetId: u.id });
    });
  }
  return due.rows.length;
}
