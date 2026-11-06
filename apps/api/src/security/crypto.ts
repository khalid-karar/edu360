import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

export const hmacHex = (key: Buffer, msg: string) => createHmac("sha256", key).update(msg).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** 256 bits of randomness, URL-safe. */
export const newToken = () => randomBytes(32).toString("base64url");

/** AES-256-GCM. Output is iv.tag.ciphertext, each base64url. */
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(key: Buffer, blob: string): string {
  const [iv, tag, ct] = blob.split(".").map((p) => Buffer.from(p ?? "", "base64url"));
  if (!iv || !tag || !ct) throw new Error("bad_ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
