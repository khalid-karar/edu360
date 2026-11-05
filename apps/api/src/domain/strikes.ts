export type StrikeAction = "warn" | "suspend_14d" | "ban";

/**
 * Published strike policy. Strike 1: warning. Strike 2: 14-day suspension with payouts frozen.
 * Strike 3: permanent ban. Zero-tolerance conduct (grooming or sexual behaviour with minors,
 * fraud, threats, impersonation) is an instant permanent ban and, where the law requires, a referral.
 */
export function strikeAction(priorActiveStrikes: number, zeroTolerance = false): StrikeAction {
  if (!Number.isInteger(priorActiveStrikes) || priorActiveStrikes < 0) {
    throw new RangeError("priorActiveStrikes must be a non-negative integer");
  }
  if (zeroTolerance) return "ban";
  if (priorActiveStrikes === 0) return "warn";
  if (priorActiveStrikes === 1) return "suspend_14d";
  return "ban";
}
