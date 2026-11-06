export const RUBRIC_KEYS = ["knowledge", "communication", "conduct", "tech"] as const;
export const RUBRIC_MAX_EACH = 5;
/** Out of 20. Below this a teacher cannot be accepted, not even with conditions. */
export const PASS_SCORE = 16;
export const REAPPLY_AFTER_DAYS = 90;
export const CONDUCT_VERSION = "2026-11-v1";

export type Rubric = Record<(typeof RUBRIC_KEYS)[number], number>;
export type VettingDecision = "approved" | "conditional" | "rejected";

export const rubricTotal = (r: Rubric) => RUBRIC_KEYS.reduce((n, k) => n + r[k], 0);

export type DecisionCheck =
  | { ok: true }
  | { ok: false; reason: "score_too_low" | "reason_required" | "no_accepted_credential" };

export function checkDecision(
  decision: VettingDecision,
  rubric: Rubric,
  reason: string | undefined,
  acceptedCredentials: number,
): DecisionCheck {
  if (decision === "rejected") return reason?.trim() ? { ok: true } : { ok: false, reason: "reason_required" };
  if (rubricTotal(rubric) < PASS_SCORE) return { ok: false, reason: "score_too_low" };
  if (decision === "conditional" && !reason?.trim()) return { ok: false, reason: "reason_required" };
  if (acceptedCredentials < 1) return { ok: false, reason: "no_accepted_credential" };
  return { ok: true };
}

export function canReapply(lastRejectedAt: Date | null, now: Date): boolean {
  if (!lastRejectedAt) return true;
  return now.getTime() - lastRejectedAt.getTime() >= REAPPLY_AFTER_DAYS * 86_400_000;
}
