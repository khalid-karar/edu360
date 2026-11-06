import type { Db } from "../db/db.js";
import { newToken, sha256hex } from "../security/crypto.js";

export interface NewSession {
  userId: string;
  mfaVerified: boolean;
  hours: number;
  ip: string | undefined;
  userAgent: string | undefined;
  now: Date;
}

/** The token is shown once. Only its SHA-256 is stored, so a database leak does not leak live sessions. */
export async function createSession(db: Db, s: NewSession): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(s.now.getTime() + s.hours * 3_600_000);
  await db.query(
    `INSERT INTO auth_sessions (user_id, token_hash, mfa_verified, ip, user_agent, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [s.userId, sha256hex(token), s.mfaVerified, s.ip ?? null, s.userAgent?.slice(0, 200) ?? null, s.now, expiresAt],
  );
  return { token, expiresAt };
}

export async function revokeSession(db: Db, sessionId: string, now: Date): Promise<void> {
  await db.query("UPDATE auth_sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL", [sessionId, now]);
}

export interface SessionRow {
  session_id: string;
  mfa_verified: boolean;
  user_id: string;
  role: string;
  status: string;
  display_name: string;
}

export async function findSession(db: Db, token: string, now: Date): Promise<SessionRow | undefined> {
  const r = await db.query<SessionRow>(
    `SELECT s.id AS session_id, s.mfa_verified, u.id AS user_id, u.role, u.status, u.display_name
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`,
    [sha256hex(token), now],
  );
  return r.rows[0];
}
