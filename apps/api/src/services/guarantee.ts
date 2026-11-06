import type { Db } from "../db/db.js";
import { GUARANTEE_MAX_PER_LEARNER, GUARANTEE_TEACHER_MONTHLY_CAP, teacherCompensation, type GuaranteeBlock } from "../domain/guarantee.js";
import { HttpError } from "../http/errors.js";
import type { PaymentProvider } from "../payments/provider.js";
import { audit } from "./audit.js";
import { notify } from "./notifications.js";

export interface GuaranteeStatus {
  eligible: boolean;
  reason?: GuaranteeBlock;
  /** End of the window in which the claim can still be made. */
  until?: Date;
}

interface Facts {
  status: string;
  payer_id: string;
  learner_id: string;
  teacher_id: string;
  pay_status: string | null;
  payout_id: string | null;
  payout_eligible_at: Date | null;
  captured_halalas: number | null;
  starts_at: Date;
}

async function facts(db: Db, bookingId: string, lock: boolean): Promise<Facts | undefined> {
  return (
    await db.query<Facts>(
      `SELECT b.status, b.payer_id, b.learner_id, b.teacher_id, p.status AS pay_status, p.payout_id, p.payout_eligible_at, p.captured_halalas, b.starts_at
         FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id WHERE b.id = $1 ${lock ? "FOR UPDATE OF b" : ""}`,
      [bookingId],
    )
  ).rows[0];
}

async function judge(db: Db, f: Facts, bookingId: string, viewerId: string, now: Date): Promise<GuaranteeStatus> {
  const no = (reason: GuaranteeBlock): GuaranteeStatus => ({ eligible: false, reason });
  if (f.payer_id !== viewerId) return no("not_payer");
  if (f.status !== "completed") return no("not_completed");
  if ((await db.query("SELECT 1 FROM disputes WHERE booking_id = $1", [bookingId])).rowCount) return no("dispute_exists");
  if (f.pay_status !== "captured" || !f.captured_halalas) return no("payment_not_captured");
  if (f.payout_id) return no("already_paid_out");
  if (!f.payout_eligible_at || now >= f.payout_eligible_at) return no("window_closed");
  const earlier = await db.query("SELECT 1 FROM bookings WHERE learner_id = $1 AND teacher_id = $2 AND status = 'completed' AND id <> $3 AND starts_at < $4", [f.learner_id, f.teacher_id, bookingId, f.starts_at]);
  if (earlier.rowCount) return no("not_first_lesson");
  const used = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM disputes WHERE kind = 'guarantee' AND opened_by = $1", [viewerId])).rows[0]!.n;
  if (used >= GUARANTEE_MAX_PER_LEARNER) return no("learner_limit_reached");
  const month = new Date(now.getTime() - 30 * 86_400_000);
  const teacherClaims = (
    await db.query<{ n: number }>("SELECT count(*)::int AS n FROM disputes d JOIN bookings b ON b.id = d.booking_id WHERE d.kind = 'guarantee' AND b.teacher_id = $1 AND d.created_at > $2", [f.teacher_id, month])
  ).rows[0]!.n;
  if (teacherClaims >= GUARANTEE_TEACHER_MONTHLY_CAP) return no("teacher_cap_reached");
  return { eligible: true, until: f.payout_eligible_at };
}

export async function guaranteeStatus(db: Db, now: Date, viewerId: string, bookingId: string): Promise<GuaranteeStatus> {
  const f = await facts(db, bookingId, false);
  if (!f || (f.payer_id !== viewerId && f.teacher_id !== viewerId)) throw new HttpError(404, "not_found");
  return judge(db, f, bookingId, viewerId, now);
}

/**
 * Refunds the whole lesson at the provider first, then records it. If the provider call fails nothing changes and
 * the learner can try again. The claim is a dispute row decided by the system, so the booking cannot also be disputed.
 */
export async function claimGuarantee(
  d: { db: Db; payments: PaymentProvider; now: () => Date },
  payerId: string,
  bookingId: string,
  why: string,
): Promise<{ refundedHalalas: number }> {
  const now = d.now();
  return d.db.tx(async (tx) => {
    const f = await facts(tx, bookingId, true);
    if (!f || f.payer_id !== payerId) throw new HttpError(404, "not_found");
    const j = await judge(tx, f, bookingId, payerId, now);
    if (!j.eligible) throw new HttpError(409, "guarantee_unavailable", { reason: j.reason });

    const pay = (await tx.query<{ id: string; psp_reference: string }>("SELECT id, psp_reference FROM payments WHERE booking_id = $1 FOR UPDATE", [bookingId])).rows[0]!;
    const captured = f.captured_halalas!;
    const cur = await d.payments.getPayment(pay.psp_reference);
    if (cur.status === "captured") await d.payments.refund(pay.psp_reference, captured);
    else if (!(cur.status === "refunded" && (cur.refundedAmount ?? 0) === captured)) throw new HttpError(409, "payment_state_conflict", { provider: cur.status });

    const credit = teacherCompensation(captured);
    await tx.query("UPDATE payments SET status='refunded', refunded_halalas=$2, commission_halalas=0, platform_credit_halalas=$3 WHERE id=$1", [pay.id, captured, credit]);
    const disp = await tx.query<{ id: string }>(
      `INSERT INTO disputes (booking_id, opened_by, reason, outcome, decided_by, decided_at, created_at, refund_halalas, note, kind)
       VALUES ($1,$2,$3,'full_refund',NULL,$4,$4,$5,'ضمان الدرس الأول: استرداد تلقائي','guarantee') RETURNING id`,
      [bookingId, payerId, why, now, captured],
    );
    await audit(tx, { actorId: payerId, action: "guarantee.claimed", targetType: "booking", targetId: bookingId, reason: why, detail: { disputeId: disp.rows[0]!.id, refundHalalas: captured, teacherCreditHalalas: credit } });
    const link = `/portal/booking?id=${bookingId}`;
    await notify(tx, { userId: payerId, kind: "guarantee_claimed", vars: { by: "learner", amount: `${captured / 100} ر.س` }, link }, now);
    await notify(tx, { userId: f.teacher_id, kind: "guarantee_claimed", vars: { by: "teacher", amount: `${credit / 100} ر.س` }, link }, now);
    return { refundedHalalas: captured };
  });
}
