import { randomUUID } from "node:crypto";
import type { Db } from "../db/db.js";
import { isAligned, lessonSpan, slotIsFree, type Span } from "../domain/availability.js";
import {
  LESSON_MINUTES,
  NO_SHOW_GRACE_MINUTES,
  PAYMENT_HOLD_MINUTES,
  REQUEST_EXPIRY_HOURS,
  checkBookable,
  nextStatus,
  settleCancellation,
  settleCompleted,
  settleDeclined,
  settleNoShow,
  type BookingEvent,
  type BookingStatus,
  type Settlement,
} from "../domain/booking.js";
import { splitAmount } from "../domain/money.js";
import { payoutEligibleAt } from "../domain/payouts.js";
import { HttpError, isUniqueViolation } from "../http/errors.js";
import { ProviderError, confirmAuthorization, type PaymentProvider } from "../payments/provider.js";
import { audit } from "./audit.js";

const MIN = 60_000;
const HOUR = 3_600_000;

export interface BookingDeps {
  db: Db;
  payments: PaymentProvider;
  now: () => Date;
}

export interface BookingRow {
  id: string;
  learner_id: string;
  payer_id: string;
  teacher_id: string;
  category_id: number;
  status: BookingStatus;
  starts_at: Date;
  duration_min: number;
  price_halalas: number;
  created_at: Date;
  expires_at: Date | null;
  cancelled_by: string | null;
}

export interface PaymentRow {
  id: string;
  booking_id: string;
  psp_reference: string;
  amount_halalas: number;
  captured_halalas: number;
  status: string;
}

export interface Actor {
  id: string;
  role: string;
}

const ACTIVE = `((status = 'awaiting_payment' AND expires_at > $NOW) OR status IN ('requested','confirmed'))`;

async function lockBooking(tx: Db, id: string): Promise<BookingRow> {
  const r = await tx.query<BookingRow>("SELECT * FROM bookings WHERE id = $1 FOR UPDATE", [id]);
  if (!r.rows[0]) throw new HttpError(404, "not_found");
  return r.rows[0];
}

const paymentOf = async (tx: Db, bookingId: string) =>
  (await tx.query<PaymentRow>("SELECT * FROM payments WHERE booking_id = $1", [bookingId])).rows[0];

const endOf = (b: BookingRow) => new Date(b.starts_at.getTime() + b.duration_min * MIN);

// ───────────────────────────── creating a booking ─────────────────────────────

export interface NewBooking {
  teacherId: string;
  categoryId: number;
  startsAt: Date;
  /** A child of the caller. Omit to book for yourself. */
  learnerId?: string | undefined;
}

/** Reserves the slot for 15 minutes while the learner pays. Nothing is charged or held on the card yet. */
export async function createBooking(d: BookingDeps, who: Actor, input: NewBooking): Promise<BookingRow> {
  const now = d.now();
  return d.db.tx(async (tx) => {
    let learnerId = who.id;
    let child: { gender: string | null } | undefined;
    if (input.learnerId && input.learnerId !== who.id) {
      const c = await tx.query<{ gender: string | null }>(
        "SELECT gender FROM users WHERE id = $1 AND guardian_id = $2 AND role = 'minor' AND status = 'active'",
        [input.learnerId, who.id],
      );
      if (!c.rows[0]) throw new HttpError(403, "not_your_child");
      learnerId = input.learnerId;
      child = c.rows[0];
    }

    // Locking the teacher row serialises bookings for this teacher, so two learners cannot take the same hour.
    const t = (
      await tx.query<{ status: string; adults_only: boolean; gender: string | null; user_status: string }>(
        `SELECT t.status, t.adults_only, i.gender, u.status AS user_status
           FROM teacher_profiles t JOIN users u ON u.id = t.user_id
           LEFT JOIN identity_verifications i ON i.user_id = t.user_id
          WHERE t.user_id = $1 FOR UPDATE OF t`,
        [input.teacherId],
      )
    ).rows[0];
    if (!t || t.user_status !== "active" || (t.status !== "approved" && t.status !== "conditional")) {
      throw new HttpError(422, "teacher_unavailable");
    }
    const cat = (
      await tx.query<{ price_halalas: number; allows_minors: boolean }>(
        `SELECT tc.price_halalas, c.allows_minors FROM teacher_categories tc JOIN categories c ON c.id = tc.category_id
          WHERE tc.teacher_id = $1 AND tc.category_id = $2 AND tc.approved AND c.active`,
        [input.teacherId, input.categoryId],
      )
    ).rows[0];
    if (!cat) throw new HttpError(422, "category_unavailable");

    if (child) {
      if (t.adults_only) throw new HttpError(403, "adults_only_teacher");
      if (!cat.allows_minors) throw new HttpError(403, "category_not_for_minors");
      const ok = (
        await tx.query<{ cross_gender_ok: boolean }>(
          "SELECT cross_gender_ok FROM guardian_teacher_approvals WHERE guardian_id = $1 AND teacher_id = $2",
          [who.id, input.teacherId],
        )
      ).rows[0];
      if (!ok) throw new HttpError(403, "teacher_not_approved");
      if (t.gender !== child.gender && !ok.cross_gender_ok) throw new HttpError(403, "cross_gender_not_approved");
    }

    const bookable = checkBookable(now, input.startsAt);
    if (!bookable.ok) throw new HttpError(422, bookable.reason);
    if (!isAligned(input.startsAt)) throw new HttpError(422, "misaligned_start");
    const lesson = lessonSpan(input.startsAt, LESSON_MINUTES);

    const windows = await tx.query<{ starts_at: Date; ends_at: Date }>(
      "SELECT starts_at, ends_at FROM availability WHERE teacher_id = $1 AND starts_at <= $2 AND ends_at >= $3",
      [input.teacherId, lesson.start, lesson.end],
    );
    const clash = (who2: "teacher_id" | "learner_id", id: string) =>
      tx.query<{ starts_at: Date; duration_min: number }>(
        `SELECT starts_at, duration_min FROM bookings
          WHERE ${who2} = $1 AND ${ACTIVE.replace("$NOW", "$4")}
            AND starts_at < $3 AND starts_at + duration_min * interval '1 minute' > $2`,
        [id, lesson.start, lesson.end, now],
      );
    const toSpan = (r: { starts_at: Date; duration_min: number }): Span => ({ start: r.starts_at, end: new Date(r.starts_at.getTime() + r.duration_min * MIN) });
    const winSpans = windows.rows.map((w): Span => ({ start: w.starts_at, end: w.ends_at }));
    const teacherBusy = (await clash("teacher_id", input.teacherId)).rows.map(toSpan);
    if (!slotIsFree(lesson, winSpans, [])) throw new HttpError(409, "slot_unavailable");
    if (!slotIsFree(lesson, winSpans, teacherBusy)) throw new HttpError(409, "slot_taken");
    if ((await clash("learner_id", learnerId)).rows.length) throw new HttpError(409, "learner_busy");

    const r = await tx.query<BookingRow>(
      `INSERT INTO bookings (learner_id, payer_id, teacher_id, category_id, status, starts_at, duration_min, price_halalas, created_at, expires_at)
       VALUES ($1,$2,$3,$4,'awaiting_payment',$5,$6,$7,$8,$9) RETURNING *`,
      [learnerId, who.id, input.teacherId, input.categoryId, input.startsAt, LESSON_MINUTES, cat.price_halalas, now, new Date(now.getTime() + PAYMENT_HOLD_MINUTES * MIN)],
    );
    return r.rows[0]!;
  });
}

// ───────────────────────────── the card hold ─────────────────────────────

export type AttachResult =
  | { ok: true; booking: BookingRow }
  | { ok: false; reason: string };

/**
 * Confirms with the provider (never the client) that a real hold of exactly this amount exists for this
 * booking, then moves the booking to "requested" so the teacher can see it. Safe to call twice: the
 * client and the webhook both do.
 */
export async function attachAuthorizedPayment(d: BookingDeps, bookingId: string, paymentId: string): Promise<AttachResult> {
  const now = d.now();
  try {
    return await d.db.tx(async (tx): Promise<AttachResult> => {
      const b = await lockBooking(tx, bookingId);
      const have = await paymentOf(tx, bookingId);
      if (have) {
        if (have.psp_reference === paymentId) return { ok: true, booking: b };
        // A second hold for the same booking (double payment): release it, keep the first.
        const extra = await d.payments.getPayment(paymentId).catch(() => undefined);
        if (extra?.status === "authorized" && extra.metadata["booking_id"] === bookingId) await d.payments.void(paymentId).catch(() => {});
        return { ok: false, reason: "booking_not_payable" };
      }

      let check;
      try {
        check = await confirmAuthorization(d.payments, paymentId, { bookingId, amount: b.price_halalas });
      } catch (e) {
        if (e instanceof ProviderError && e.status === 404) return { ok: false, reason: "payment_not_found" };
        throw e;
      }
      if (!check.ok) return { ok: false, reason: check.reason };

      // A real hold exists but the booking cannot use it (too late, or already cancelled): release it.
      if (b.status !== "awaiting_payment" || (b.expires_at && b.expires_at <= now)) {
        await d.payments.void(paymentId).catch(() => {});
        if (b.status === "awaiting_payment") {
          await tx.query("UPDATE bookings SET status='cancelled', cancelled_by='system', expires_at=NULL WHERE id=$1", [b.id]);
        }
        return { ok: false, reason: b.status === "awaiting_payment" ? "payment_window_expired" : "booking_not_payable" };
      }

      await tx.query(
        `INSERT INTO payments (booking_id, psp_reference, amount_halalas, status, authorized_at, created_at)
         VALUES ($1,$2,$3,'authorized',$4,$4)`,
        [b.id, paymentId, b.price_halalas, now],
      );
      const status = nextStatus(b.status, "payment_authorized");
      const upd = await tx.query<BookingRow>(
        "UPDATE bookings SET status=$2, expires_at=$3 WHERE id=$1 RETURNING *",
        [b.id, status, new Date(now.getTime() + REQUEST_EXPIRY_HOURS * HOUR)],
      );
      return { ok: true, booking: upd.rows[0]! };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: "payment_already_used" }; // one hold backs one booking only
    throw e;
  }
}

// ───────────────────────────── settling the money ─────────────────────────────

/**
 * Releases or charges the held money. Asks the provider first, so a retry after a failure is safe:
 * a payment that is already voided or captured counts as done. If the provider call throws, the
 * surrounding transaction rolls back and nothing changes.
 */
async function applySettlement(tx: Db, d: BookingDeps, b: BookingRow, p: PaymentRow | undefined, s: Settlement): Promise<void> {
  if (!p) return;
  const now = d.now();
  const cur = await d.payments.getPayment(p.psp_reference);
  if (s.action === "void" || s.amount === 0) {
    if (cur.status === "authorized") await d.payments.void(p.psp_reference);
    else if (cur.status !== "voided") throw new HttpError(409, "payment_state_conflict", { provider: cur.status });
    await tx.query("UPDATE payments SET status='voided', voided_at=$2 WHERE id=$1", [p.id, now]);
    return;
  }
  let captured = s.amount;
  if (cur.status === "authorized") await d.payments.capture(p.psp_reference, s.amount);
  else if (cur.status === "captured") captured = cur.capturedAmount ?? s.amount;
  else throw new HttpError(409, "payment_state_conflict", { provider: cur.status });

  // Commission depends on how many lessons this learner already completed with this teacher.
  const prior = await tx.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bookings WHERE learner_id=$1 AND teacher_id=$2 AND status='completed' AND id <> $3",
    [b.learner_id, b.teacher_id, b.id],
  );
  const split = splitAmount(captured, prior.rows[0]?.n ?? 0);
  await tx.query(
    `UPDATE payments SET status='captured', captured_halalas=$2, commission_halalas=$3, captured_at=$4, payout_eligible_at=$5 WHERE id=$1`,
    [p.id, captured, split.commission, now, payoutEligibleAt(now)],
  );
}

async function move(tx: Db, b: BookingRow, event: BookingEvent, extra: { cancelledBy?: string } = {}): Promise<BookingStatus> {
  let status: BookingStatus;
  try {
    status = nextStatus(b.status, event);
  } catch {
    throw new HttpError(409, "invalid_state", { status: b.status, event });
  }
  await tx.query("UPDATE bookings SET status=$2, expires_at=NULL, cancelled_by=COALESCE($3, cancelled_by) WHERE id=$1", [b.id, status, extra.cancelledBy ?? null]);
  return status;
}

// ───────────────────────────── teacher actions ─────────────────────────────

function ownBookingAsTeacher(b: BookingRow, teacherId: string) {
  if (b.teacher_id !== teacherId) throw new HttpError(404, "not_found"); // never confirm that someone else's booking exists
}

export async function acceptBooking(d: BookingDeps, teacherId: string, bookingId: string): Promise<void> {
  const now = d.now();
  await d.db.tx(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    ownBookingAsTeacher(b, teacherId);
    if (b.status === "requested" && b.expires_at && b.expires_at <= now) throw new HttpError(409, "request_expired");
    await move(tx, b, "accept");
    await tx.query("INSERT INTO sessions (booking_id, room_name) VALUES ($1,$2) ON CONFLICT (booking_id) DO NOTHING", [b.id, `ilmak-${randomUUID()}`]);
  });
}

export async function declineBooking(d: BookingDeps, teacherId: string, bookingId: string): Promise<void> {
  await d.db.tx(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    ownBookingAsTeacher(b, teacherId);
    await move(tx, b, "decline");
    await applySettlement(tx, d, b, await paymentOf(tx, b.id), settleDeclined());
  });
}

/** After the lesson is over, the teacher confirms it happened and the held money is charged. Payout still waits out the 48-hour dispute window. */
export async function completeBooking(d: BookingDeps, teacherId: string, bookingId: string): Promise<void> {
  const now = d.now();
  await d.db.tx(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    ownBookingAsTeacher(b, teacherId);
    if (b.status === "confirmed" && now < endOf(b)) throw new HttpError(409, "lesson_not_finished");
    await move(tx, b, "complete");
    await applySettlement(tx, d, b, await paymentOf(tx, b.id), settleCompleted(b.price_halalas));
    await tx.query("UPDATE teacher_profiles SET completed_sessions = completed_sessions + 1 WHERE user_id = $1", [b.teacher_id]);
  });
}

// ───────────────────────────── cancelling and no-shows ─────────────────────────────

export async function cancelBooking(d: BookingDeps, actor: Actor, bookingId: string): Promise<void> {
  const now = d.now();
  await d.db.tx(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    const by = actor.id === b.teacher_id ? "teacher" : actor.id === b.payer_id ? "learner" : null;
    if (!by) throw new HttpError(404, "not_found");
    if (b.status === "confirmed" && now >= b.starts_at) throw new HttpError(409, "already_started");
    await move(tx, b, "cancel", { cancelledBy: by });
    // Before the teacher has agreed, leaving is always free. After that, the published late-cancel rule applies.
    const s: Settlement = b.status === "confirmed" ? settleCancellation(by, now, b.starts_at, b.price_halalas) : settleDeclined();
    await applySettlement(tx, d, b, await paymentOf(tx, b.id), s);
  });
}

/**
 * The teacher reports the learner absent, or the payer reports the teacher absent. Allowed from 15 minutes
 * after the start until 24 hours later. Interim: it rests on one side's word until video attendance exists,
 * so every report is audited and the other side can dispute it.
 */
export async function reportNoShow(d: BookingDeps, actor: Actor, bookingId: string, who: "learner" | "teacher"): Promise<void> {
  const now = d.now();
  await d.db.tx(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    const reporter = who === "learner" ? b.teacher_id : b.payer_id;
    if (actor.id !== b.teacher_id && actor.id !== b.payer_id) throw new HttpError(404, "not_found");
    if (actor.id !== reporter) throw new HttpError(403, "forbidden");
    if (b.status === "confirmed") {
      if (now < new Date(b.starts_at.getTime() + NO_SHOW_GRACE_MINUTES * MIN)) throw new HttpError(409, "too_early");
      if (now > new Date(b.starts_at.getTime() + 24 * HOUR)) throw new HttpError(409, "too_late");
    }
    await move(tx, b, who === "teacher" ? "teacher_no_show" : "learner_no_show");
    await applySettlement(tx, d, b, await paymentOf(tx, b.id), settleNoShow(who, b.price_halalas));
    if (who === "teacher") {
      await tx.query("UPDATE teacher_profiles SET reliability_score = GREATEST(0, reliability_score - 0.05) WHERE user_id = $1", [b.teacher_id]);
    }
    await audit(tx, { actorId: actor.id, action: "booking.no_show_reported", targetType: "booking", targetId: b.id, detail: { absent: who } });
  });
}

// ───────────────────────────── expiry sweep ─────────────────────────────

/** Frees slots nobody paid for and releases card holds for requests the teacher never answered. */
export async function expireStale(d: BookingDeps): Promise<{ cancelled: number; declined: number }> {
  const now = d.now();
  const out = { cancelled: 0, declined: 0 };
  const due = await d.db.query<{ id: string; status: string }>(
    "SELECT id, status FROM bookings WHERE status IN ('awaiting_payment','requested') AND expires_at <= $1 ORDER BY expires_at LIMIT 200",
    [now],
  );
  for (const row of due.rows) {
    try {
      await d.db.tx(async (tx) => {
        const b = await lockBooking(tx, row.id);
        if (b.status !== row.status || !b.expires_at || b.expires_at > now) return; // someone acted first
        if (b.status === "awaiting_payment") {
          await move(tx, b, "cancel", { cancelledBy: "system" });
          out.cancelled++;
        } else {
          await move(tx, b, "decline", { cancelledBy: "system" });
          await applySettlement(tx, d, b, await paymentOf(tx, b.id), settleDeclined());
          out.declined++;
        }
      });
    } catch (e) {
      console.error(`expiry of booking ${row.id} failed`, e); // the next sweep tries again
    }
  }
  return out;
}
