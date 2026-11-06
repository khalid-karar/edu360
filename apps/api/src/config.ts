import { randomBytes } from "node:crypto";
import { z } from "zod";

const hexKey = z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (openssl rand -hex 32)");

const Env = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  /** SMS and Nafath. Only "mock" exists until their contracts are signed. */
  PROVIDERS: z.string().default("mock"),
  /** Card payments. "moyasar" needs both Moyasar values below; check it against their sandbox first. */
  PAYMENTS: z.enum(["mock", "moyasar"]).default("mock"),
  MOYASAR_SECRET_KEY: z.string().min(1).optional(),
  /** Shared secret Moyasar puts in webhook payloads. Without it the webhook endpoint answers 503. */
  MOYASAR_WEBHOOK_SECRET: z.string().min(8).optional(),
  WAITLIST_FILE: z.string().default("./data/waitlist.jsonl"),
  /** Keyed hash for national IDs. Must stay stable forever: changing it breaks "one account per ID". */
  ID_HASH_KEY: hexKey,
  /** Encrypts staff TOTP secrets at rest. */
  MFA_ENC_KEY: hexKey,
  /** Keys one-time code hashes. May change freely (codes live 5 minutes). */
  OTP_KEY: hexKey.optional(),
  SESSION_HOURS: z.coerce.number().positive().default(24 * 30),
  STAFF_SESSION_HOURS: z.coerce.number().positive().default(8),
  /** Video rooms. "livekit" needs the three LiveKit values below. */
  VIDEO: z.enum(["mock", "livekit"]).default("mock"),
  LIVEKIT_URL: z.string().min(1).optional(),
  LIVEKIT_API_KEY: z.string().min(1).optional(),
  LIVEKIT_API_SECRET: z.string().min(16).optional(),
  /** Where uploaded files are kept on disk (test server / single machine). */
  UPLOAD_DIR: z.string().default("./data/storage"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(20_000_000).default(5_000_000),
  /** Shared rate-limit counters. Without it each API process counts on its own, which is fine for one process only. */
  REDIS_URL: z.string().min(1).optional(),
  /** Allowed prefix for uploaded file keys; real storage issues keys under it. */
  UPLOADS_PREFIX: z.string().default("uploads/"),
});

export interface Config {
  port: number;
  databaseUrl: string;
  providers: "mock";
  payments: "mock" | "moyasar";
  moyasarSecretKey?: string;
  webhookSecret?: string;
  waitlistFile: string;
  idHashKey: Buffer;
  mfaEncKey: Buffer;
  otpKey: Buffer;
  sessionHours: number;
  staffSessionHours: number;
  uploadsPrefix: string;
  uploadDir: string;
  uploadMaxBytes: number;
  redisUrl?: string;
  video?: { kind: "mock" } | { kind: "livekit"; url: string; apiKey: string; apiSecret: string };
  /** Mock mode only: return the one-time code in the response. Real SMS never echoes it. */
  echoOtp: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(env);
  // Real providers are not wired yet. Refuse to start rather than silently run mocks by mistake.
  if (e.PROVIDERS !== "mock") throw new Error(`PROVIDERS=${e.PROVIDERS} is not implemented yet; use PROVIDERS=mock`);
  if (e.PAYMENTS === "moyasar" && (!e.MOYASAR_SECRET_KEY || !e.MOYASAR_WEBHOOK_SECRET)) {
    throw new Error("PAYMENTS=moyasar needs MOYASAR_SECRET_KEY and MOYASAR_WEBHOOK_SECRET");
  }
  if (e.VIDEO === "livekit" && (!e.LIVEKIT_URL || !e.LIVEKIT_API_KEY || !e.LIVEKIT_API_SECRET)) {
    throw new Error("VIDEO=livekit needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET");
  }
  return {
    port: e.PORT,
    video: e.VIDEO === "livekit" ? { kind: "livekit", url: e.LIVEKIT_URL!, apiKey: e.LIVEKIT_API_KEY!, apiSecret: e.LIVEKIT_API_SECRET! } : { kind: "mock" },
    payments: e.PAYMENTS,
    ...(e.MOYASAR_SECRET_KEY ? { moyasarSecretKey: e.MOYASAR_SECRET_KEY } : {}),
    ...(e.MOYASAR_WEBHOOK_SECRET ? { webhookSecret: e.MOYASAR_WEBHOOK_SECRET } : {}),
    databaseUrl: e.DATABASE_URL,
    providers: "mock",
    waitlistFile: e.WAITLIST_FILE,
    idHashKey: Buffer.from(e.ID_HASH_KEY, "hex"),
    mfaEncKey: Buffer.from(e.MFA_ENC_KEY, "hex"),
    otpKey: e.OTP_KEY ? Buffer.from(e.OTP_KEY, "hex") : randomBytes(32),
    sessionHours: e.SESSION_HOURS,
    staffSessionHours: e.STAFF_SESSION_HOURS,
    uploadsPrefix: e.UPLOADS_PREFIX,
    uploadDir: e.UPLOAD_DIR,
    uploadMaxBytes: e.UPLOAD_MAX_BYTES,
    ...(e.REDIS_URL ? { redisUrl: e.REDIS_URL } : {}),
    echoOtp: e.PROVIDERS === "mock",
  };
}
