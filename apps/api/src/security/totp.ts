import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "./crypto.js";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export const TOTP_PERIOD_S = 30;

/** RFC 6238 (HMAC-SHA1, 6 digits, 30 s) for one time step. */
export function totpAt(secret: Buffer, step: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/**
 * Accepts the current step or one either side (clock drift). Returns the matched step, or null.
 * A step at or below lastStep is refused so an observed code cannot be replayed.
 */
export function verifyTotp(secret: Buffer, code: string, nowMs: number, lastStep: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(nowMs / 1000 / TOTP_PERIOD_S);
  let hit: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (safeEqual(totpAt(secret, step), code) && step > lastStep) hit = step;
  }
  return hit;
}

export function otpauthUri(secret: Buffer, account: string, issuer = "Ilmak"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&period=${TOTP_PERIOD_S}&digits=6`;
}
