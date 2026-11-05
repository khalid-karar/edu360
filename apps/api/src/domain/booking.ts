import { portion, type Halalas } from "./money.js";

/** Moyasar: a mada authorization must be captured within 14 days. */
export const AUTH_WINDOW_DAYS = 14;
/** Leaves 4 days of the 14 for the session, capture and retries. */
export const MAX_BOOKING_HORIZON_DAYS = 10;
export const MIN_LEAD_MINUTES = 120;
export const REQUEST_EXPIRY_HOURS = 12; // teacher must accept within this time
export const FREE_CANCELLATION_HOURS = 24;
/** Teacher keeps this share when a learner cancels late or does not show. */
export const LATE_CANCEL_TEACHER_BPS = 5000;
export const LEARNER_NO_SHOW_TEACHER_BPS = 10_000;

const MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

export type BookableCheck =
  | { ok: true }
  | { ok: false; reason: "in_past" | "too_soon" | "too_far" };

export function checkBookable(now: Date, startsAt: Date): BookableCheck {
  const diff = startsAt.getTime() - now.getTime();
  if (diff <= 0) return { ok: false, reason: "in_past" };
  if (diff < MIN_LEAD_MINUTES * MS.minute) return { ok: false, reason: "too_soon" };
  if (diff > MAX_BOOKING_HORIZON_DAYS * MS.day) return { ok: false, reason: "too_far" };
  return { ok: true };
}

export function isRequestExpired(requestedAt: Date, now: Date): boolean {
  return now.getTime() - requestedAt.getTime() >= REQUEST_EXPIRY_HOURS * MS.hour;
}

/** What to do with the held (authorized) money. */
export type Settlement = { action: "void" } | { action: "capture"; amount: Halalas };

export type CancelledBy = "learner" | "teacher";

export function settleCancellation(by: CancelledBy, now: Date, startsAt: Date, price: Halalas): Settlement {
  if (by === "teacher") return { action: "void" };
  const hoursBefore = (startsAt.getTime() - now.getTime()) / MS.hour;
  if (hoursBefore >= FREE_CANCELLATION_HOURS) return { action: "void" };
  return { action: "capture", amount: portion(price, LATE_CANCEL_TEACHER_BPS) };
}

export function settleNoShow(who: "teacher" | "learner", price: Halalas): Settlement {
  if (who === "teacher") return { action: "void" };
  return { action: "capture", amount: portion(price, LEARNER_NO_SHOW_TEACHER_BPS) };
}

export const settleDeclined = (): Settlement => ({ action: "void" });
export const settleCompleted = (price: Halalas): Settlement => ({ action: "capture", amount: price });

/** Capture deadline: the authorization lapses after this. */
export function captureDeadline(authorizedAt: Date): Date {
  return new Date(authorizedAt.getTime() + AUTH_WINDOW_DAYS * MS.day);
}

export type BookingStatus =
  | "requested"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "completed"
  | "no_show_teacher"
  | "no_show_learner";

export type BookingEvent =
  | "accept"
  | "decline"
  | "cancel"
  | "complete"
  | "teacher_no_show"
  | "learner_no_show";

const TRANSITIONS: Record<BookingStatus, Partial<Record<BookingEvent, BookingStatus>>> = {
  requested: { accept: "confirmed", decline: "declined", cancel: "cancelled" },
  confirmed: {
    cancel: "cancelled",
    complete: "completed",
    teacher_no_show: "no_show_teacher",
    learner_no_show: "no_show_learner",
  },
  declined: {},
  cancelled: {},
  completed: {},
  no_show_teacher: {},
  no_show_learner: {},
};

export class InvalidTransition extends Error {
  constructor(public from: BookingStatus, public event: BookingEvent) {
    super(`Cannot apply "${event}" to a booking that is "${from}"`);
  }
}

export function nextStatus(status: BookingStatus, event: BookingEvent): BookingStatus {
  const next = TRANSITIONS[status][event];
  if (!next) throw new InvalidTransition(status, event);
  return next;
}
