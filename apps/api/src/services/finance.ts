import type { Db } from "../db/db.js";
import { DISPUTE_WINDOW_HOURS, buildPayoutRun, type PayoutBatch, type PayoutCandidate, type SkipReason, type TeacherPayoutState } from "../domain/payouts.js";
import { splitAmount } from "../domain/money.js";
import { HttpError, isUniqueViolation } from "../http/errors.js";
import type { PaymentProvider } from "../payments/provider.js";
import { audit } from "./audit.js";
import { notify } from "./notifications.js";

export interface FinanceDeps {
  db: Db;
  payments: PaymentProvider;
  now: () => Date;
}
const HOUR = 3_600_000;

// ───────────────────────────── disputes ─────────────────────────────

/** The payer disputes a lesson within 48 hours of the charge. Opening one stops the payout until finance decides. */
export async function openDispute(d: FinanceDeps, payerId: string, bookingId: string, reason: string): Promise<string> {
  const now = d.now();
  try {
    return await d.db.tx(async (tx) => {
      const b = (await tx.query<{ payer_id: string; status: string; teacher_id: string }>("SELECT payer_id, status, teacher_id FROM bookings WHERE id = $1 FOR UPDATE", [bookingId])).rows[0];
      if (!b || b.payer_id !== payerId) throw new HttpError(404, "not_found");
      if (b.status !== "completed" && b.status !== "no_show_learner") throw new HttpError(409, "not_disputable");
      const p = (await tx.query<{ status: string; captured_at: Date | null; payout_id: string | null }>("SELECT status, captured_at, payout_id FROM payments WHERE booking_id = $1", [bookingId])).rows[0];
      if (!p || p.status !== "captured" || !p.captured_at) throw new HttpError(409, "not_disputable");
      if (p.payout_id || now.getTime() > p.captured_at.getTime() + DISPUTE_WINDOW_HOURS * HOUR) throw new HttpError(409, "dispute_window_closed");
      const r = await tx.query<{ id: string }>("INSERT INTO disputes (booking_id, opened_by, reason, created_at) VALUES ($1,$2,$3,$4) RETURNING id", [bookingId, payerId, reason, now]);
      await audit(tx, { actorId: payerId, action: "dispute.opened", targetType: "dispute", targetId: r.rows[0]!.id, reason, detail: { bookingId } });
      await notify(tx, { userId: b.teacher_id, kind: "dispute_opened", link: `/portal/booking?id=${bookingId}` }, now);
      return r.rows[0]!.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "dispute_exists");
    throw e;
  }
}

export type DisputeDecision =
  | { outcome: "full_refund" }
  | { outcome: "partial_refund"; refundHalalas: number }
  | { outcome: "release_to_teacher" };

/**
 * Finance decides. The provider is asked to refund first; if our database write then fails, a retry finds
 * the provider already refunded exactly this amount and carries on, so money is never refunded twice.
 * The teacher's commission is recomputed on what the platform actually kept.
 */
export async function decideDispute(d: FinanceDeps, staffId: string, disputeId: string, decision: DisputeDecision, note: string): Promise<{ refundedHalalas: number }> {
  const now = d.now();
  return d.db.tx(async (tx) => {
    const disp = (await tx.query<{ booking_id: string; outcome: string | null }>("SELECT booking_id, outcome FROM disputes WHERE id = $1 FOR UPDATE", [disputeId])).rows[0];
    if (!disp) throw new HttpError(404, "not_found");
    if (disp.outcome) throw new HttpError(409, "already_decided");
    const p = (
      await tx.query<{ id: string; psp_reference: string; status: string; captured_halalas: number; payout_id: string | null; learner_id: string; teacher_id: string }>(
        `SELECT p.id, p.psp_reference, p.status, p.captured_halalas, p.payout_id, b.learner_id, b.teacher_id
           FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.booking_id = $1 FOR UPDATE OF p`,
        [disp.booking_id],
      )
    ).rows[0];
    if (!p || p.status !== "captured") throw new HttpError(409, "payment_state_conflict");

    let refund = 0;
    if (decision.outcome === "full_refund") refund = p.captured_halalas;
    else if (decision.outcome === "partial_refund") {
      refund = decision.refundHalalas;
      if (!Number.isSafeInteger(refund) || refund < 1 || refund >= p.captured_halalas) throw new HttpError(422, "bad_refund_amount", { max: p.captured_halalas - 1 });
    }

    if (refund > 0) {
      if (p.payout_id) throw new HttpError(409, "already_paid_out");
      const cur = await d.payments.getPayment(p.psp_reference);
      if (cur.status === "captured") await d.payments.refund(p.psp_reference, refund);
      else if (!(cur.status === "refunded" && (cur.refundedAmount ?? 0) === refund)) throw new HttpError(409, "payment_state_conflict", { provider: cur.status });

      const prior = (
        await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM bookings WHERE learner_id=$1 AND teacher_id=$2 AND status='completed' AND id <> $3", [p.learner_id, p.teacher_id, disp.booking_id])
      ).rows[0]!.n;
      const kept = p.captured_halalas - refund;
      const commission = kept === 0 ? 0 : splitAmount(kept, prior).commission;
      await tx.query("UPDATE payments SET status=$2, refunded_halalas=$3, commission_halalas=$4 WHERE id=$1", [p.id, kept === 0 ? "refunded" : "partially_refunded", refund, commission]);
    }
    await tx.query("UPDATE disputes SET outcome=$2, refund_halalas=$3, decided_by=$4, decided_at=$5, note=$6 WHERE id=$1", [disputeId, decision.outcome, refund, staffId, now, note]);
    await audit(tx, { actorId: staffId, action: "finance.dispute_decided", targetType: "dispute", targetId: disputeId, reason: note, detail: { outcome: decision.outcome, refundHalalas: refund, bookingId: disp.booking_id } });
    const payer = (await tx.query<{ payer_id: string }>("SELECT payer_id FROM bookings WHERE id = $1", [disp.booking_id])).rows[0]!.payer_id;
    const label = decision.outcome === "release_to_teacher" ? "رُفض الاعتراض وأُفرج عن المبلغ للمعلّم" : decision.outcome === "full_refund" ? "قُبل الاعتراض واسترداد كامل" : "قُبل الاعتراض واسترداد جزئي";
    const amount = refund > 0 ? `${refund / 100} ر.س` : undefined;
    const link = `/portal/booking?id=${disp.booking_id}`;
    await notify(tx, { userId: payer, kind: "dispute_decided", vars: { decision: label, ...(amount ? { amount } : {}) }, link }, now);
    await notify(tx, { userId: p.teacher_id, kind: "dispute_decided", vars: { decision: label }, link }, now);
    return { refundedHalalas: refund };
  });
}

// ───────────────────────────── payout runs ─────────────────────────────

interface CandidateRow {
  payment_id: string;
  teacher_id: string;
  captured_at: Date;
  net: number;
  disputed: boolean;
}

async function plan(db: Db, now: Date) {
  const c = await db.query<CandidateRow>(
    `SELECT p.id AS payment_id, b.teacher_id, p.captured_at,
            (p.captured_halalas - p.refunded_halalas - p.commission_halalas) AS net,
            EXISTS (SELECT 1 FROM disputes x WHERE x.booking_id = p.booking_id AND x.outcome IS NULL) AS disputed
       FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE p.payout_id IS NULL AND p.status IN ('captured','partially_refunded') AND p.captured_at IS NOT NULL
      ORDER BY p.captured_at`,
  );
  const ids = [...new Set(c.rows.map((r) => r.teacher_id))];
  const t = ids.length
    ? await db.query<{ user_id: string; approved_at: Date | null; payouts_frozen: boolean; iban: string | null; prior: boolean }>(
        `SELECT t.user_id, t.approved_at, t.payouts_frozen, t.iban,
                EXISTS (SELECT 1 FROM payouts o WHERE o.teacher_id = t.user_id AND o.status IN ('approved','paid')) AS prior
           FROM teacher_profiles t WHERE t.user_id = ANY($1::uuid[])`,
        [ids],
      )
    : { rows: [] };
  const teachers = new Map<string, TeacherPayoutState>();
  for (const r of t.rows) {
    teachers.set(r.user_id, { approvedAt: r.approved_at ?? new Date(0), hasPriorPayout: r.prior, payoutsFrozen: r.payouts_frozen || !r.iban });
  }
  const cands: PayoutCandidate[] = c.rows.map((r) => ({ paymentId: r.payment_id, teacherId: r.teacher_id, capturedAt: r.captured_at, net: Number(r.net), disputed: r.disputed }));
  return buildPayoutRun(cands, teachers, now);
}

export interface RunSummary {
  batches: PayoutBatch[];
  skipped: Record<SkipReason, number>;
}
const summarize = (r: Awaited<ReturnType<typeof plan>>): RunSummary => {
  const skipped = { in_dispute_window: 0, disputed: 0, teacher_frozen: 0, new_teacher_hold: 0, unknown_teacher: 0, nothing_to_pay: 0 } satisfies Record<SkipReason, number>;
  for (const s of r.skipped) skipped[s.reason]++;
  return { batches: r.batches, skipped };
};

export async function previewPayoutRun(d: FinanceDeps): Promise<RunSummary> {
  return summarize(await plan(d.db, d.now()));
}

/**
 * Creates one payout per teacher for everything past the dispute window. A teacher's first payout waits
 * for a second finance officer to approve it; later ones are approved by the run itself. Runs are
 * serialised, and a payment can belong to only one payout.
 */
export async function createPayoutRun(d: FinanceDeps, staffId: string): Promise<{ payouts: { id: string; teacherId: string; amountHalalas: number; status: string }[]; skipped: RunSummary["skipped"] }> {
  const now = d.now();
  return d.db.tx(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(7001)");
    const p = await plan(tx, now);
    const out = [];
    for (const b of p.batches) {
      const status = b.needsReview ? "pending" : "approved";
      const r = await tx.query<{ id: string }>(
        `INSERT INTO payouts (teacher_id, amount_halalas, status, approved_by, created_by, needs_review, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [b.teacherId, b.amount, status, b.needsReview ? null : staffId, staffId, b.needsReview, now],
      );
      const id = r.rows[0]!.id;
      await tx.query("UPDATE payments SET payout_id = $1 WHERE id = ANY($2::uuid[]) AND payout_id IS NULL", [id, b.paymentIds]);
      await audit(tx, { actorId: staffId, action: "finance.payout_created", targetType: "payout", targetId: id, detail: { teacherId: b.teacherId, amountHalalas: b.amount, payments: b.paymentIds.length, needsReview: b.needsReview } });
      out.push({ id, teacherId: b.teacherId, amountHalalas: b.amount, status });
    }
    return { payouts: out, skipped: summarize(p).skipped };
  });
}

type PayoutAction = "approve" | "hold" | "mark_paid" | "fail";
const FROM: Record<PayoutAction, string[]> = {
  approve: ["pending", "on_hold"],
  hold: ["pending", "approved"],
  mark_paid: ["approved"],
  fail: ["approved"],
};

export async function actOnPayout(d: FinanceDeps, staffId: string, payoutId: string, action: PayoutAction, input: { bankReference?: string; note?: string } = {}): Promise<string> {
  const now = d.now();
  return d.db.tx(async (tx) => {
    const o = (await tx.query<{ status: string; created_by: string | null; needs_review: boolean }>("SELECT status, created_by, needs_review FROM payouts WHERE id = $1 FOR UPDATE", [payoutId])).rows[0];
    if (!o) throw new HttpError(404, "not_found");
    if (!FROM[action].includes(o.status)) throw new HttpError(409, "invalid_state", { status: o.status });
    // First payouts need a second pair of eyes: the person who ran the batch cannot approve it.
    if (action === "approve" && o.needs_review && o.created_by === staffId) throw new HttpError(403, "second_approver_required");

    let status: string;
    if (action === "approve") {
      status = "approved";
      await tx.query("UPDATE payouts SET status='approved', approved_by=$2 WHERE id=$1", [payoutId, staffId]);
    } else if (action === "hold") {
      status = "on_hold";
      await tx.query("UPDATE payouts SET status='on_hold', note=$2 WHERE id=$1", [payoutId, input.note ?? null]);
    } else if (action === "mark_paid") {
      status = "paid";
      await tx.query("UPDATE payouts SET status='paid', paid_at=$2, bank_reference=$3 WHERE id=$1", [payoutId, now, input.bankReference ?? null]);
    } else {
      status = "failed";
      await tx.query("UPDATE payouts SET status='failed', note=$2 WHERE id=$1", [payoutId, input.note ?? null]);
      // Release the payments so the next run picks them up again.
      await tx.query("UPDATE payments SET payout_id = NULL WHERE payout_id = $1", [payoutId]);
    }
    const pt = (await tx.query<{ teacher_id: string; amount_halalas: number }>("SELECT teacher_id, amount_halalas FROM payouts WHERE id = $1", [payoutId])).rows[0]!;
    const said: Partial<Record<PayoutAction, string>> = { approve: "اعتُمد تحويلك وسيُرسل إلى حسابك قريباً", hold: "عُلّق تحويلك مؤقتاً للمراجعة", mark_paid: "تم تحويل المبلغ إلى حسابك", fail: "تعذّر تحويل المبلغ، سنعيد إدراجه في الدفعة القادمة" };
    await notify(tx, { userId: pt.teacher_id, kind: "payout_update", vars: { decision: said[action] ?? "", amount: `${pt.amount_halalas / 100} ر.س` }, link: "/portal/earnings" }, now);
    await audit(tx, { actorId: staffId, action: `finance.payout_${action}`, targetType: "payout", targetId: payoutId, reason: input.note ?? null, detail: input.bankReference ? { bankReference: input.bankReference } : undefined });
    return status;
  });
}
