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
import { buildApp } from "./app.js";

const config = loadConfig();
const db = pgDb(config.databaseUrl);

const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);

const mockPayments = config.payments === "mock" ? new MockPaymentProvider() : undefined;
const ctx = {
  db,
  config,
  sms: new MockSmsProvider(),
  nafath: new MockNafathProvider(),
  payments: mockPayments ?? new MoyasarProvider(config.moyasarSecretKey!),
  now: () => new Date(),
  limits: { global: 120, auth: 10 },
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
  processDeletions(ctx.db, ctx.now()).then((r) => r.erased > 0 && console.log(`erased ${r.erased} accounts`), (e) => console.error("erasure sweep failed", e));
  sendReminders(ctx.db, ctx.now()).then(() => deliverSms(ctx.db, ctx.sms, ctx.now())).catch((e) => console.error("notification sweep failed", e));
}, 60_000);
sweep.unref();

const shutdown = async () => {
  clearInterval(sweep);
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`ilmak api listening on 127.0.0.1:${config.port} providers=${config.providers} payments=${config.payments}`);
