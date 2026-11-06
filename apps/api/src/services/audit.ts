import type { Db } from "../db/db.js";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  detail?: Record<string, unknown>;
}

/** Append-only (the table refuses UPDATE and DELETE). Call it inside the same transaction as the change it records. */
export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.query(
    "INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, detail) VALUES ($1,$2,$3,$4,$5,$6)",
    [e.actorId, e.action, e.targetType, e.targetId, e.reason ?? null, e.detail ? JSON.stringify(e.detail) : null],
  );
}
