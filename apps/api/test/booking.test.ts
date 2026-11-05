import { describe, expect, it } from "vitest";
import {
  InvalidTransition,
  captureDeadline,
  checkBookable,
  isRequestExpired,
  nextStatus,
  settleCancellation,
  settleCompleted,
  settleDeclined,
  settleNoShow,
} from "../src/domain/booking.js";

const now = new Date("2026-11-10T10:00:00Z");
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe("booking horizon", () => {
  it("accepts a lesson between 2 hours and 10 days ahead", () => {
    expect(checkBookable(now, inHours(2))).toEqual({ ok: true });
    expect(checkBookable(now, inHours(240))).toEqual({ ok: true });
  });

  it("rejects past, too-soon and too-far bookings", () => {
    expect(checkBookable(now, inHours(-1))).toEqual({ ok: false, reason: "in_past" });
    expect(checkBookable(now, inHours(1))).toEqual({ ok: false, reason: "too_soon" });
    expect(checkBookable(now, inHours(241))).toEqual({ ok: false, reason: "too_far" });
  });

  it("keeps the latest session well inside the 14-day mada capture window", () => {
    const authorizedAt = now;
    const latestSessionEnd = new Date(inHours(240).getTime() + 3_600_000);
    expect(latestSessionEnd.getTime()).toBeLessThan(captureDeadline(authorizedAt).getTime() - 3 * 86_400_000);
  });
});

describe("teacher acceptance window", () => {
  it("expires after 12 hours", () => {
    expect(isRequestExpired(now, inHours(11))).toBe(false);
    expect(isRequestExpired(now, inHours(12))).toBe(true);
  });
});

describe("settlement of held money", () => {
  const price = 15_000;

  it("captures in full for a completed lesson", () => {
    expect(settleCompleted(price)).toEqual({ action: "capture", amount: price });
  });

  it("voids when the teacher declines, cancels, or does not show", () => {
    expect(settleDeclined()).toEqual({ action: "void" });
    expect(settleCancellation("teacher", now, inHours(1), price)).toEqual({ action: "void" });
    expect(settleNoShow("teacher", price)).toEqual({ action: "void" });
  });

  it("lets a learner cancel free at least 24 hours before", () => {
    expect(settleCancellation("learner", now, inHours(24), price)).toEqual({ action: "void" });
    expect(settleCancellation("learner", now, inHours(48), price)).toEqual({ action: "void" });
  });

  it("charges the teacher half for a late learner cancellation", () => {
    expect(settleCancellation("learner", now, inHours(23), price)).toEqual({ action: "capture", amount: 7500 });
    expect(settleCancellation("learner", now, inHours(-1), price)).toEqual({ action: "capture", amount: 7500 });
  });

  it("charges in full when the learner does not show", () => {
    expect(settleNoShow("learner", price)).toEqual({ action: "capture", amount: price });
  });
});

describe("booking state machine", () => {
  it("follows the happy path", () => {
    expect(nextStatus("requested", "accept")).toBe("confirmed");
    expect(nextStatus("confirmed", "complete")).toBe("completed");
  });

  it("handles every exit", () => {
    expect(nextStatus("requested", "decline")).toBe("declined");
    expect(nextStatus("requested", "cancel")).toBe("cancelled");
    expect(nextStatus("confirmed", "cancel")).toBe("cancelled");
    expect(nextStatus("confirmed", "teacher_no_show")).toBe("no_show_teacher");
    expect(nextStatus("confirmed", "learner_no_show")).toBe("no_show_learner");
  });

  it("refuses impossible moves, so a finished booking can never be re-settled", () => {
    expect(() => nextStatus("completed", "cancel")).toThrow(InvalidTransition);
    expect(() => nextStatus("cancelled", "complete")).toThrow(InvalidTransition);
    expect(() => nextStatus("requested", "complete")).toThrow(InvalidTransition);
    expect(() => nextStatus("no_show_teacher", "learner_no_show")).toThrow(InvalidTransition);
  });
});
