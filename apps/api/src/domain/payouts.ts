import { splitAmount, type Halalas } from "./money.js";

export const DISPUTE_WINDOW_HOURS = 48;
export const NEW_TEACHER_FIRST_PAYOUT_DAYS = 14;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Earliest moment a captured payment may be paid out: after the dispute window. */
export function payoutEligibleAt(capturedAt: Date): Date {
  return new Date(capturedAt.getTime() + DISPUTE_WINDOW_HOURS * HOUR);
}

/** Teacher's net after a (partial) refund: commission is recomputed on what was actually kept. */
export function teacherNet(captured: Halalas, refunded: Halalas, priorSessions: number): Halalas {
  if (refunded > captured) throw new RangeError("refunded cannot exceed captured");
  return splitAmount(captured - refunded, priorSessions).net;
}

export interface PayoutCandidate {
  paymentId: string;
  teacherId: string;
  capturedAt: Date;
  net: Halalas;
  disputed: boolean;
}

export interface TeacherPayoutState {
  approvedAt: Date;
  hasPriorPayout: boolean;
  payoutsFrozen: boolean;
}

export type SkipReason =
  | "in_dispute_window"
  | "disputed"
  | "teacher_frozen"
  | "new_teacher_hold"
  | "unknown_teacher"
  | "nothing_to_pay";

export interface PayoutBatch {
  teacherId: string;
  paymentIds: string[];
  amount: Halalas;
  /** A teacher's first payout is always reviewed by a finance officer. */
  needsReview: boolean;
}

export function buildPayoutRun(
  candidates: PayoutCandidate[],
  teachers: Map<string, TeacherPayoutState>,
  now: Date,
): { batches: PayoutBatch[]; skipped: { paymentId: string; reason: SkipReason }[] } {
  const byTeacher = new Map<string, PayoutBatch>();
  const skipped: { paymentId: string; reason: SkipReason }[] = [];

  for (const c of candidates) {
    const teacher = teachers.get(c.teacherId);
    const reason = skipReason(c, teacher, now);
    if (reason) {
      skipped.push({ paymentId: c.paymentId, reason });
      continue;
    }
    const batch =
      byTeacher.get(c.teacherId) ??
      { teacherId: c.teacherId, paymentIds: [], amount: 0, needsReview: !teacher!.hasPriorPayout };
    batch.paymentIds.push(c.paymentId);
    batch.amount += c.net;
    byTeacher.set(c.teacherId, batch);
  }
  return { batches: [...byTeacher.values()], skipped };
}

function skipReason(c: PayoutCandidate, t: TeacherPayoutState | undefined, now: Date): SkipReason | null {
  if (!t) return "unknown_teacher";
  if (c.disputed) return "disputed";
  if (t.payoutsFrozen) return "teacher_frozen";
  if (now < payoutEligibleAt(c.capturedAt)) return "in_dispute_window";
  if (!t.hasPriorPayout && now.getTime() < t.approvedAt.getTime() + NEW_TEACHER_FIRST_PAYOUT_DAYS * DAY) {
    return "new_teacher_hold";
  }
  if (c.net <= 0) return "nothing_to_pay";
  return null;
}
