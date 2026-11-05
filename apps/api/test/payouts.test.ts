import { describe, expect, it } from "vitest";
import { buildPayoutRun, payoutEligibleAt, teacherNet, type PayoutCandidate, type TeacherPayoutState } from "../src/domain/payouts.js";
import { strikeAction } from "../src/domain/strikes.js";

const now = new Date("2026-12-01T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

const veteran: TeacherPayoutState = { approvedAt: ago(24 * 90), hasPriorPayout: true, payoutsFrozen: false };
const candidate = (over: Partial<PayoutCandidate> = {}): PayoutCandidate => ({
  paymentId: "p1",
  teacherId: "t1",
  capturedAt: ago(72),
  net: 8000,
  disputed: false,
  ...over,
});

describe("payout eligibility", () => {
  it("opens 48 hours after capture", () => {
    const captured = new Date("2026-12-01T00:00:00Z");
    expect(payoutEligibleAt(captured).toISOString()).toBe("2026-12-03T00:00:00.000Z");
  });

  it("pays out captured lessons past the dispute window and sums per teacher", () => {
    const run = buildPayoutRun(
      [candidate({ paymentId: "a", net: 8000 }), candidate({ paymentId: "b", net: 4400 })],
      new Map([["t1", veteran]]),
      now,
    );
    expect(run.skipped).toEqual([]);
    expect(run.batches).toEqual([{ teacherId: "t1", paymentIds: ["a", "b"], amount: 12_400, needsReview: false }]);
  });

  it("holds back anything still in the dispute window, disputed, or for a frozen teacher", () => {
    const run = buildPayoutRun(
      [
        candidate({ paymentId: "recent", capturedAt: ago(10) }),
        candidate({ paymentId: "disputed", disputed: true }),
        candidate({ paymentId: "frozen", teacherId: "t2" }),
        candidate({ paymentId: "ghost", teacherId: "nobody" }),
        candidate({ paymentId: "zero", net: 0 }),
      ],
      new Map([
        ["t1", veteran],
        ["t2", { ...veteran, payoutsFrozen: true }],
      ]),
      now,
    );
    expect(run.batches).toEqual([]);
    expect(Object.fromEntries(run.skipped.map((s) => [s.paymentId, s.reason]))).toEqual({
      recent: "in_dispute_window",
      disputed: "disputed",
      frozen: "teacher_frozen",
      ghost: "unknown_teacher",
      zero: "nothing_to_pay",
    });
  });

  it("makes new teachers wait 14 days for the first payout, then flags it for review", () => {
    const rookie = (daysApproved: number): TeacherPayoutState => ({
      approvedAt: ago(24 * daysApproved),
      hasPriorPayout: false,
      payoutsFrozen: false,
    });
    const early = buildPayoutRun([candidate()], new Map([["t1", rookie(10)]]), now);
    expect(early.skipped).toEqual([{ paymentId: "p1", reason: "new_teacher_hold" }]);

    const later = buildPayoutRun([candidate()], new Map([["t1", rookie(15)]]), now);
    expect(later.batches[0]?.needsReview).toBe(true);
  });
});

describe("refunds reduce what the teacher earns", () => {
  it("recomputes commission on the amount kept", () => {
    expect(teacherNet(10_000, 0, 0)).toBe(8000);
    expect(teacherNet(10_000, 5000, 0)).toBe(4000); // keeps 5000, 20% commission
    expect(teacherNet(10_000, 10_000, 0)).toBe(0);
    expect(() => teacherNet(100, 200, 0)).toThrow(RangeError);
  });
});

describe("strike policy", () => {
  it("escalates warn, suspend, ban", () => {
    expect(strikeAction(0)).toBe("warn");
    expect(strikeAction(1)).toBe("suspend_14d");
    expect(strikeAction(2)).toBe("ban");
    expect(strikeAction(7)).toBe("ban");
  });

  it("bans instantly for zero-tolerance conduct", () => {
    expect(strikeAction(0, true)).toBe("ban");
  });
});
