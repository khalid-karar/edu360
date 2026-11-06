import type { Db } from "../db/db.js";
import { HttpError, isUniqueViolation } from "../http/errors.js";
import { audit } from "./audit.js";
import { notify } from "./notifications.js";

export const APPEAL_WINDOW_DAYS = 30;
const DAY = 86_400_000;

/** A person appeals one of their own strikes, once, within 30 days. Banned people can too: that is the whole point. */
export async function fileAppeal(db: Db, now: Date, userId: string, strikeId: string, reason: string): Promise<string> {
  try {
    return await db.tx(async (tx) => {
      const s = (await tx.query<{ created_at: Date; voided_at: Date | null }>("SELECT created_at, voided_at FROM strikes WHERE id = $1 AND user_id = $2", [strikeId, userId])).rows[0];
      if (!s) throw new HttpError(404, "not_found");
      if (s.voided_at) throw new HttpError(409, "strike_already_voided");
      if (now.getTime() > s.created_at.getTime() + APPEAL_WINDOW_DAYS * DAY) throw new HttpError(409, "appeal_window_closed");
      const r = await tx.query<{ id: string }>("INSERT INTO appeals (strike_id, user_id, reason, created_at) VALUES ($1,$2,$3,$4) RETURNING id", [strikeId, userId, reason, now]);
      await audit(tx, { actorId: userId, action: "appeal.filed", targetType: "appeal", targetId: r.rows[0]!.id, reason, detail: { strikeId } });
      const officers = await tx.query<{ id: string }>("SELECT id FROM users WHERE role = 'safety_officer' AND status = 'active'");
      for (const o of officers.rows) await notify(tx, { userId: o.id, kind: "appeal_filed", link: "/portal/staff" }, now);
      return r.rows[0]!.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "appeal_exists");
    throw e;
  }
}

/**
 * A different safety officer from the one who issued the strike decides. Reversing voids the strike (it no
 * longer counts toward the ladder) and, if nothing else keeps the person out, restores the account.
 * Lessons cancelled while the person was suspended stay cancelled: the money was already released.
 */
export async function decideAppeal(
  d: { db: Db; now: () => Date },
  staffId: string,
  appealId: string,
  outcome: "upheld" | "reversed",
  note: string,
): Promise<{ restored: boolean }> {
  const now = d.now();
  return d.db.tx(async (tx) => {
    const a = (await tx.query<{ status: string; strike_id: string; user_id: string }>("SELECT status, strike_id, user_id FROM appeals WHERE id = $1 FOR UPDATE", [appealId])).rows[0];
    if (!a) throw new HttpError(404, "not_found");
    if (a.status !== "open") throw new HttpError(409, "already_decided");
    const strike = (await tx.query<{ issued_by: string | null }>("SELECT issued_by FROM strikes WHERE id = $1 FOR UPDATE", [a.strike_id])).rows[0]!;
    if (strike.issued_by === staffId) throw new HttpError(403, "cannot_decide_own_strike");

    let restored = false;
    if (outcome === "reversed") {
      await tx.query("UPDATE strikes SET voided_at = $2, voided_by = $3 WHERE id = $1", [a.strike_id, now, staffId]);
      const u = (await tx.query<{ role: string; status: string }>("SELECT role, status FROM users WHERE id = $1 FOR UPDATE", [a.user_id])).rows[0]!;
      if (u.status === "banned" || u.status === "suspended") {
        const still = await tx.query<{ action: string; created_at: Date }>(
          "SELECT action, created_at FROM strikes WHERE user_id = $1 AND voided_at IS NULL AND action IN ('ban','suspend_14d') ORDER BY created_at DESC",
          [a.user_id],
        );
        const ban = still.rows.find((x) => x.action === "ban");
        const susp = still.rows.find((x) => x.action === "suspend_14d" && x.created_at.getTime() + 14 * DAY > now.getTime());
        if (ban) {
          // another ban still stands
        } else if (susp) {
          await tx.query("UPDATE users SET status='suspended', suspended_until=$2 WHERE id=$1", [a.user_id, new Date(susp.created_at.getTime() + 14 * DAY)]);
        } else {
          await tx.query("UPDATE users SET status='active', suspended_until=NULL WHERE id=$1", [a.user_id]);
          if (u.role === "teacher") {
            await tx.query(
              `UPDATE teacher_profiles SET payouts_frozen=false,
                 status = CASE WHEN adults_only THEN 'conditional'::teacher_status ELSE 'approved'::teacher_status END
               WHERE user_id=$1 AND status='suspended'`,
              [a.user_id],
            );
          }
          restored = true;
        }
      }
    }
    await tx.query("UPDATE appeals SET status=$2, decided_by=$3, decision_note=$4, decided_at=$5 WHERE id=$1", [appealId, outcome, staffId, note, now]);
    await audit(tx, { actorId: staffId, action: "appeal.decided", targetType: "appeal", targetId: appealId, reason: note, detail: { outcome, strikeId: a.strike_id, restored } });
    await notify(tx, { userId: a.user_id, kind: "appeal_decided", vars: { decision: outcome, note }, link: "/portal/account" }, now);
    return { restored };
  });
}
