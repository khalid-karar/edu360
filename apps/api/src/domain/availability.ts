import { LESSON_MINUTES, MAX_BOOKING_HORIZON_DAYS, MIN_LEAD_MINUTES } from "./booking.js";

const MIN = 60_000;
export const SLOT_STEP_MINUTES = 15;
export const MIN_WINDOW_MINUTES = 60;
export const MAX_WINDOW_MINUTES = 12 * 60;
export const MAX_FUTURE_WINDOWS = 100;
export const MAX_WINDOW_AHEAD_DAYS = 60;

export interface Span {
  start: Date;
  end: Date;
}

export const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

export const lessonSpan = (startsAt: Date, minutes = LESSON_MINUTES): Span => ({
  start: startsAt,
  end: new Date(startsAt.getTime() + minutes * MIN),
});

export const isAligned = (d: Date) => d.getTime() % (SLOT_STEP_MINUTES * MIN) === 0;

/** Is the whole lesson inside one of the teacher's availability windows, and clear of existing bookings? */
export function slotIsFree(lesson: Span, windows: Span[], busy: Span[]): boolean {
  const inside = windows.some((w) => w.start <= lesson.start && lesson.end <= w.end);
  return inside && !busy.some((b) => overlaps(lesson, b));
}

/**
 * Bookable start times: every 15 minutes inside each window where the whole lesson fits, nothing else
 * overlaps, and the start is between 2 hours and 10 days from now (the booking policy).
 */
export function openSlots(windows: Span[], busy: Span[], now: Date, limit = 50): Date[] {
  const earliest = now.getTime() + MIN_LEAD_MINUTES * MIN;
  const latest = now.getTime() + MAX_BOOKING_HORIZON_DAYS * 86_400_000;
  const step = SLOT_STEP_MINUTES * MIN;
  const out: Date[] = [];
  for (const w of [...windows].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    let t = Math.max(w.start.getTime(), earliest);
    t = Math.ceil(t / step) * step;
    for (; t <= latest && out.length < limit; t += step) {
      const lesson = lessonSpan(new Date(t));
      if (lesson.end > w.end) break;
      if (!busy.some((b) => overlaps(lesson, b))) out.push(lesson.start);
    }
    if (out.length >= limit) break;
  }
  return out;
}
