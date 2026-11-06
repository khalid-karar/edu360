import { Redis } from "ioredis";
import { loadConfig } from "../config.js";
import { pgDb } from "../db/db.js";
import { migrate } from "../db/migrate.js";
import { MockPaymentProvider } from "../payments/mock.js";
import { MoyasarProvider } from "../payments/moyasar.js";
import { MockNafathProvider } from "../providers/nafath.js";
import { MockSmsProvider } from "../providers/sms.js";
import { expireStale } from "../services/bookings.js";
import { liftExpiredSuspensions } from "../services/trust.js";
import { deliverSms, sendReminders } from "../services/notifications.js";
import { processDeletions } from "../services/dataRights.js";
import { LiveKitVideo, MockVideo } from "../video/provider.js";
import { LocalDiskStorage } from "../storage/storage.js";
import { buildApp } from "./app.js";
import { FallbackRateStore, MemoryRateStore, RedisRateStore } from "./rate-store.js";

const config = loadConfig();
const db = pgDb(config.databaseUrl);

const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);

// Shared rate-limit counters. If Redis is down the limiter drops to per-process memory rather than failing requests.
const redis = config.redisUrl
  ? new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000 })
  : undefined;
let lastRedisError = 0;
redis?.on("error", (e) => {
  if (Date.now() - lastRedisError > 60_000) console.error("redis error (rate limits fall back to memory):", e.message);
  lastRedisError = Date.now();
});
const rateStore = redis ? new FallbackRateStore(new RedisRateStore(redis), new MemoryRateStore()) : undefined;

const mockPayments = config.payments === "mock" ? new MockPaymentProvider() : undefined;
const ctx = {
  db,
  storage: new LocalDiskStorage(config.uploadDir),
  config,
  sms: new MockSmsProvider(),
  nafath: new MockNafathProvider(),
  video: config.video?.kind === "livekit" ? new LiveKitVideo(config.video.url, config.video.apiKey, config.video.apiSecret) : new MockVideo(),
  payments: mockPayments ?? new MoyasarProvider(config.moyasarSecretKey!),
  now: () => new Date(),
  limits: { global: 120, auth: 10 },
  rateStore,
  ...(mockPayments ? { mockPayments } : {}),
};
const app = buildApp(ctx);

// Unpaid holds and unanswered requests must release their slot and any card hold.
const sweep = setInterval(() => {
  expireStale(ctx).then(
    (r) => r.cancelled + r.declined > 0 && console.log(`expired: ${r.cancelled} unpaid, ${r.declined} unanswered`),
    (e) => console.error("expiry sweep failed", e),
  );
  liftExpiredSuspensions(ctx.db, ctx.now()).catch((e) => console.error("suspension sweep failed", e));
  processDeletions(ctx.db, ctx.now(), ctx.storage).then((r) => r.erased > 0 && console.log(`erased ${r.erased} accounts`), (e) => console.error("erasure sweep failed", e));
  sendReminders(ctx.db, ctx.now()).then(() => deliverSms(ctx.db, ctx.sms, ctx.now())).catch((e) => console.error("notification sweep failed", e));
}, 60_000);
sweep.unref();

const shutdown = async () => {
  clearInterval(sweep);
  await app.close();
  await db.end();
  redis?.disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`ilmak api listening on 127.0.0.1:${config.port} providers=${config.providers} payments=${config.payments}`);
