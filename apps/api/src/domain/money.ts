/** All money is integer halalas (1 SAR = 100 halalas). Never floats. */
export type Halalas = number;

export function assertHalalas(value: number, label = "amount"): asserts value is Halalas {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of halalas, got ${value}`);
  }
}

/** Commission in basis points (1 bp = 0.01%). */
export const COMMISSION_BPS_NEW = 2000; // 20% on a learner's first sessions with a teacher
export const COMMISSION_BPS_LOYAL = 1200; // 12% afterwards: staying on the platform is cheaper
export const LOYALTY_THRESHOLD = 5;

export function commissionBps(priorCompletedSessions: number): number {
  if (!Number.isInteger(priorCompletedSessions) || priorCompletedSessions < 0) {
    throw new RangeError("priorCompletedSessions must be a non-negative integer");
  }
  return priorCompletedSessions < LOYALTY_THRESHOLD ? COMMISSION_BPS_NEW : COMMISSION_BPS_LOYAL;
}

export interface Split {
  gross: Halalas;
  commission: Halalas;
  net: Halalas;
  bps: number;
}

/**
 * Splits a captured amount into platform commission and teacher net.
 * `priorCompletedSessions` = completed sessions between this learner and this teacher
 * before the current one. Rounds half up in integer arithmetic.
 * VAT treatment is intentionally not computed here: pending the tax advisor.
 */
export function splitAmount(gross: Halalas, priorCompletedSessions: number): Split {
  assertHalalas(gross, "gross");
  const bps = commissionBps(priorCompletedSessions);
  const commission = Math.floor((gross * bps + 5000) / 10_000);
  return { gross, commission, net: gross - commission, bps };
}

/** Portion of an amount in basis points, rounded down so we never over-capture. */
export function portion(amount: Halalas, bps: number): Halalas {
  assertHalalas(amount);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError("bps must be 0..10000");
  return Math.floor((amount * bps) / 10_000);
}
