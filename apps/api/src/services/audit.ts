import type { Db } from "../db/db.js";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  detail?: Record<string, unknown>;
  /** Defaults to the database clock. Pass the app clock when something later counts entries by time. */
  at?: Date;
}

/** Append-only (the table refuses UPDATE and DELETE). Call it inside the same transaction as the change it records. */
export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.query(
    "INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))",
    [e.actorId, e.action, e.targetType, e.targetId, e.reason ?? null, e.detail ? JSON.stringify(e.detail) : null, e.at ?? null],
  );
}
