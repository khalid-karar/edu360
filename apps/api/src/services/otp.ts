import { randomInt } from "node:crypto";
import type { Db } from "../db/db.js";
import { hmacHex, safeEqual } from "../security/crypto.js";
import type { SmsProvider } from "../providers/sms.js";
import { HttpError } from "../http/errors.js";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
/** At most this many codes per phone in the window, so nobody can use us to spam a number. */
export const OTP_MAX_REQUESTS = 3;
export const OTP_REQUEST_WINDOW_MS = 10 * 60_000;
export const PHONE_RE = /^\+9665\d{8}$/;

interface OtpDeps {
  db: Db;
  sms: SmsProvider;
  key: Buffer;
  now: () => Date;
}

const hashCode = (key: Buffer, phone: string, code: string) => hmacHex(key, `${phone}:${code}`);

/** Issues a code and sends it. Returns the code so mock mode can echo it; real mode never does. */
export async function requestOtp(d: OtpDeps, phone: string): Promise<string> {
  const now = d.now();
  const since = new Date(now.getTime() - OTP_REQUEST_WINDOW_MS);
  const recent = await d.db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1 AND created_at > $2",
    [phone, since],
  );
  if ((recent.rows[0]?.n ?? 0) >= OTP_MAX_REQUESTS) throw new HttpError(429, "otp_rate_limited");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await d.db.query(
    "INSERT INTO otp_codes (phone, code_hash, expires_at, created_at) VALUES ($1,$2,$3,$4)",
    [phone, hashCode(d.key, phone, code), new Date(now.getTime() + OTP_TTL_MS), now],
  );
  await d.sms.send(phone, `رمز التحقق في عِلمك: ${code}`);
  return code;
}

/**
 * Checks a code against the newest live one for this phone. Every check spends an attempt (5 max),
 * so guessing is capped. Does not consume the code: call consumeOtp once the login is really going ahead.
 */
export async function checkOtp(d: OtpDeps, phone: string, code: string): Promise<string | null> {
  const r = await d.db.query<{ id: string; code_hash: string }>(
    `UPDATE otp_codes SET attempts = attempts + 1
      WHERE id = (SELECT id FROM otp_codes
                   WHERE phone = $1 AND consumed_at IS NULL AND expires_at > $2 AND attempts < $3
                   ORDER BY created_at DESC LIMIT 1)
      RETURNING id, code_hash`,
    [phone, d.now(), OTP_MAX_ATTEMPTS],
  );
  const row = r.rows[0];
  if (!row) return null;
  return safeEqual(row.code_hash, hashCode(d.key, phone, code)) ? row.id : null;
}

/** One-shot: false if someone else already used this code. */
export async function consumeOtp(d: OtpDeps, id: string): Promise<boolean> {
  const r = await d.db.query("UPDATE otp_codes SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL", [id, d.now()]);
  return r.rowCount === 1;
}
