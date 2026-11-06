import { splitAmount } from "./money.js";

/**
 * First-lesson guarantee: a learner's first completed lesson with a teacher can be refunded in full, no questions,
 * while it is still inside the dispute window. The teacher is not left out of pocket: the platform tops them up
 * with half of what they would normally have earned.
 */
export const GUARANTEE_MAX_PER_LEARNER = 3;
export const GUARANTEE_TEACHER_MONTHLY_CAP = 5;
export const TEACHER_COMPENSATION_SHARE_BPS = 5000;

export type GuaranteeBlock =
  | "not_completed"
  | "not_payer"
  | "not_first_lesson"
  | "window_closed"
  | "already_paid_out"
  | "dispute_exists"
  | "learner_limit_reached"
  | "teacher_cap_reached"
  | "payment_not_captured";

/** Half of the teacher's normal net on this lesson, rounded down. The platform pays it; the learner is refunded in full. */
export function teacherCompensation(capturedHalalas: number): number {
  const normalNet = splitAmount(capturedHalalas, 0).net; // a first lesson is always in the top commission band
  return Math.floor((normalNet * TEACHER_COMPENSATION_SHARE_BPS) / 10_000);
}
