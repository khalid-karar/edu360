import { describe, expect, it } from "vitest";
import { commissionBps, portion, splitAmount } from "../src/domain/money.js";

describe("commission", () => {
  it("charges 20% on the first five sessions with a teacher", () => {
    for (const prior of [0, 1, 4]) expect(commissionBps(prior)).toBe(2000);
  });

  it("drops to 12% from the sixth session", () => {
    for (const prior of [5, 6, 50]) expect(commissionBps(prior)).toBe(1200);
  });

  it("splits 100 SAR exactly", () => {
    expect(splitAmount(10_000, 0)).toEqual({ gross: 10_000, commission: 2000, net: 8000, bps: 2000 });
    expect(splitAmount(10_000, 5)).toEqual({ gross: 10_000, commission: 1200, net: 8800, bps: 1200 });
  });

  it("always adds back up to the gross and rounds half up", () => {
    for (const gross of [1, 7, 333, 12_345, 99_999]) {
      const s = splitAmount(gross, 0);
      expect(s.commission + s.net).toBe(gross);
      expect(Number.isInteger(s.commission)).toBe(true);
    }
    expect(splitAmount(25, 0).commission).toBe(5); // 25 * 20% = 5
    expect(splitAmount(3, 0).commission).toBe(1); // 0.6 rounds up
  });

  it("rejects fractional or negative money", () => {
    expect(() => splitAmount(10.5, 0)).toThrow(RangeError);
    expect(() => splitAmount(-1, 0)).toThrow(RangeError);
    expect(() => commissionBps(-1)).toThrow(RangeError);
  });

  it("portion rounds down so we never over-capture", () => {
    expect(portion(10_001, 5000)).toBe(5000);
    expect(portion(10_000, 10_000)).toBe(10_000);
  });
});
