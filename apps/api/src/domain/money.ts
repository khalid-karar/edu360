/** All money is integer halalas (1 SAR = 100 halalas). Never floats. */
export type Halalas = number;

export function assertHalalas(value: number, label = "amount"): asserts value is Halalas {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of halalas, got ${value}`);
  }
}

/** Commission in basis points (1 bp = 0.01%). */
export interface CommissionSchedule {
  /** Rate for the first `threshold` completed sessions between a learner and a teacher. */
  initialBps: number;
  /** Rate from the next session on: staying on the platform is cheaper. */
  afterBps: number;
  threshold: number;
}
export interface CommissionPolicy {
  /** The first N approved teachers are "founding" teachers and use `founder`; everyone else uses `standard`. */
  founderLimit: number;
  founder: CommissionSchedule;
  standard: CommissionSchedule;
}
export const DEFAULT_POLICY: CommissionPolicy = {
  founderLimit: 100,
  founder: { initialBps: 500, afterBps: 300, threshold: 10 },
  standard: { initialBps: 1500, afterBps: 1000, threshold: 10 },
};

export function commissionBps(priorCompletedSessions: number, schedule: CommissionSchedule = DEFAULT_POLICY.standard): number {
  if (!Number.isInteger(priorCompletedSessions) || priorCompletedSessions < 0) {
    throw new RangeError("priorCompletedSessions must be a non-negative integer");
  }
  return priorCompletedSessions < schedule.threshold ? schedule.initialBps : schedule.afterBps;
}

export interface Split {
  gross: Halalas;
  commission: Halalas;
  net: Halalas;
  bps: number;
}

const rate = (amount: Halalas, bps: number): Halalas => Math.floor((amount * bps + 5000) / 10_000);

/**
 * Splits a captured amount into platform commission and teacher net.
 * `priorCompletedSessions` = completed sessions between this learner and this teacher
 * before the current one. Rounds half up in integer arithmetic.
 * VAT treatment is intentionally not computed here: pending the tax advisor.
 */
export function splitAmount(gross: Halalas, priorCompletedSessions: number, schedule: CommissionSchedule = DEFAULT_POLICY.standard): Split {
  assertHalalas(gross, "gross");
  const bps = commissionBps(priorCompletedSessions, schedule);
  const commission = rate(gross, bps);
  return { gross, commission, net: gross - commission, bps };
}

export interface PaidSplit {
  commission: Halalas;
  /** What the platform adds from its own pocket because the learner paid less than the teacher's price. */
  credit: Halalas;
  net: Halalas;
}

/**
 * Split of `paid` halalas kept from a booking whose learner price was `price` and the teacher's price `list`.
 * The commission is taken on the teacher's price, so a discount code costs the platform, never the teacher:
 * net = paid - commission + credit = listShare - commission.
 */
export function splitPaid(paid: Halalas, price: Halalas, list: Halalas, bps: number): PaidSplit {
  assertHalalas(paid, "paid");
  const listShare = price === list ? paid : Math.round((paid * list) / price);
  const commission = rate(listShare, bps);
  return { commission, credit: listShare - paid, net: listShare - commission };
}

/** Portion of an amount in basis points, rounded down so we never over-capture. */
export function portion(amount: Halalas, bps: number): Halalas {
  assertHalalas(amount);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError("bps must be 0..10000");
  return Math.floor((amount * bps) / 10_000);
}
