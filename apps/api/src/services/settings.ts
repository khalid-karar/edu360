import { z } from "zod";
import type { Db } from "../db/db.js";
import { DEFAULT_POLICY, type CommissionPolicy, type CommissionSchedule } from "../domain/money.js";
import { audit } from "./audit.js";

const Schedule = z
  .object({
    initialBps: z.number().int().min(0).max(5000),
    afterBps: z.number().int().min(0).max(5000),
    threshold: z.number().int().min(1).max(200),
  })
  .strict();
export const PolicySchema = z.object({ founderLimit: z.number().int().min(0).max(100_000), founder: Schedule, standard: Schedule }).strict();

const KEY = "commission";

/** The commission policy in force. Falls back to the defaults if the row is missing or unreadable. */
export async function getPolicy(db: Db): Promise<CommissionPolicy> {
  const r = await db.query<{ value: unknown }>("SELECT value FROM platform_settings WHERE key = $1", [KEY]);
  const parsed = PolicySchema.safeParse(r.rows[0]?.value);
  return parsed.success ? parsed.data : DEFAULT_POLICY;
}

export async function setPolicy(db: Db, adminId: string, policy: CommissionPolicy, now: Date): Promise<void> {
  await db.tx(async (tx) => {
    const before = await getPolicy(tx);
    await tx.query(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [KEY, JSON.stringify(policy), adminId, now],
    );
    await audit(tx, { actorId: adminId, action: "settings.commission_changed", targetType: "settings", targetId: KEY, detail: { before, after: policy } });
  });
}

/** Locks the policy row so concurrent approvals cannot both take the last founding place. */
export async function lockPolicy(db: Db): Promise<CommissionPolicy> {
  await db.query("SELECT 1 FROM platform_settings WHERE key = $1 FOR UPDATE", [KEY]);
  return getPolicy(db);
}

export async function foundingCount(db: Db): Promise<number> {
  return (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM teacher_profiles WHERE founding")).rows[0]!.n;
}

/** Which schedule applies to this teacher. */
export async function scheduleFor(db: Db, teacherId: string): Promise<CommissionSchedule> {
  const policy = await getPolicy(db);
  const f = await db.query<{ founding: boolean }>("SELECT founding FROM teacher_profiles WHERE user_id = $1", [teacherId]);
  return f.rows[0]?.founding ? policy.founder : policy.standard;
}
