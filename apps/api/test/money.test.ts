import { describe, expect, it } from "vitest";
import { commissionBps, DEFAULT_POLICY, portion, splitAmount, splitPaid } from "../src/domain/money.js";

const OLD = { initialBps: 2000, afterBps: 1200, threshold: 5 };

describe("commission schedule", () => {
  it("defaults: standard teachers 15% for 10 sessions then 10%", () => {
    for (const prior of [0, 1, 9]) expect(commissionBps(prior)).toBe(1500);
    for (const prior of [10, 11, 50]) expect(commissionBps(prior)).toBe(1000);
  });

  it("defaults: founding teachers 5% for 10 sessions then 3%", () => {
    for (const prior of [0, 9]) expect(commissionBps(prior, DEFAULT_POLICY.founder)).toBe(500);
    for (const prior of [10, 40]) expect(commissionBps(prior, DEFAULT_POLICY.founder)).toBe(300);
  });

  it("follows any schedule it is given", () => {
    for (const prior of [0, 4]) expect(commissionBps(prior, OLD)).toBe(2000);
    for (const prior of [5, 50]) expect(commissionBps(prior, OLD)).toBe(1200);
  });

  it("splits 100 SAR exactly", () => {
    expect(splitAmount(10_000, 0, OLD)).toEqual({ gross: 10_000, commission: 2000, net: 8000, bps: 2000 });
    expect(splitAmount(10_000, 5, OLD)).toEqual({ gross: 10_000, commission: 1200, net: 8800, bps: 1200 });
    expect(splitAmount(10_000, 0, DEFAULT_POLICY.founder)).toEqual({ gross: 10_000, commission: 500, net: 9500, bps: 500 });
  });

  it("always adds back up to the gross and rounds half up", () => {
    for (const gross of [1, 7, 333, 12_345, 99_999]) {
      const s = splitAmount(gross, 0, OLD);
      expect(s.commission + s.net).toBe(gross);
    }
    expect(splitAmount(25, 0, OLD).commission).toBe(5); // 25 * 20% = 5
    expect(splitAmount(3, 0, OLD).commission).toBe(1); // 0.6 rounds up
  });

  it("rejects fractional or negative halalas", () => {
    expect(() => splitAmount(10.5, 0)).toThrow(RangeError);
    expect(() => splitAmount(-1, 0)).toThrow(RangeError);
    expect(() => commissionBps(-1)).toThrow(RangeError);
  });
});

describe("a discount costs the platform, not the teacher", () => {
  it("without a discount it is the plain split", () => {
    expect(splitPaid(10_000, 10_000, 10_000, 1500)).toEqual({ commission: 1500, credit: 0, net: 8500 });
  });

  it("learner pays 80 for a 100 lesson at 15%: teacher still nets 85, platform tops up 20 and keeps 15 commission", () => {
    const s = splitPaid(8000, 8000, 10_000, 1500);
    expect(s).toEqual({ commission: 1500, credit: 2000, net: 8500 });
    expect(8000 - s.commission + s.credit).toBe(s.net); // what the payout formula computes
  });

  it("scales a part-capture (late cancel fee) in proportion", () => {
    const s = splitPaid(4000, 8000, 10_000, 1000); // half of the lesson captured
    expect(s.net).toBe(4500);
    expect(4000 - s.commission + s.credit).toBe(s.net);
  });
});

describe("portion", () => {
  it("rounds down so we never over-capture", () => {
    expect(portion(999, 5000)).toBe(499);
  });
});
