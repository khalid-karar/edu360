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
  /** Intro and sample videos. Held in memory while saving, so keep this modest until object storage streams. */
  UPLOAD_VIDEO_MAX_BYTES: z.coerce.number().int().positive().max(200_000_000).default(50_000_000),
  /** S3-compatible object storage (Oracle Object Storage in Riyadh). With S3_BUCKET set, uploads go there instead of UPLOAD_DIR. */
  S3_BUCKET: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("me-riyadh-1"),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  /** ClamAV daemon. With CLAMD_HOST set, every upload is scanned and refused if the scanner is down. */
  CLAMD_HOST: z.string().min(1).optional(),
  CLAMD_PORT: z.coerce.number().int().positive().default(3310),
  /** Bearer token for GET /api/metrics. Unset: the endpoint does not exist. Also keep it off the public proxy. */
  METRICS_TOKEN: z.string().min(16).optional(),
  /** Mark the session cookie Secure. Only the plain-http local sandbox turns this off. */
  COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  /** Extra origins allowed to send cookie-authenticated changes and open sockets, comma separated. Same-host requests are always allowed. */
  ALLOWED_ORIGINS: z.string().default(""),
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
  uploadVideoMaxBytes: number;
  redisUrl?: string;
  metricsToken?: string;
  s3?: { bucket: string; endpoint: string; region: string; accessKeyId: string; secretAccessKey: string };
  clamd?: { host: string; port: number };
  cookieSecure: boolean;
  allowedOrigins: string[];
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
  if (e.S3_BUCKET && (!e.S3_ENDPOINT || !e.S3_ACCESS_KEY || !e.S3_SECRET_KEY)) {
    throw new Error("S3_BUCKET needs S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY");
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
    uploadVideoMaxBytes: e.UPLOAD_VIDEO_MAX_BYTES,
    ...(e.REDIS_URL ? { redisUrl: e.REDIS_URL } : {}),
    ...(e.METRICS_TOKEN ? { metricsToken: e.METRICS_TOKEN } : {}),
    ...(e.S3_BUCKET ? { s3: { bucket: e.S3_BUCKET, endpoint: e.S3_ENDPOINT!, region: e.S3_REGION, accessKeyId: e.S3_ACCESS_KEY!, secretAccessKey: e.S3_SECRET_KEY! } } : {}),
    ...(e.CLAMD_HOST ? { clamd: { host: e.CLAMD_HOST, port: e.CLAMD_PORT } } : {}),
    cookieSecure: e.COOKIE_SECURE === "true",
    allowedOrigins: e.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    echoOtp: e.PROVIDERS === "mock",
  };
}
