import { loadConfig } from "../config.js";
import { pgDb } from "../db/db.js";
import { migrate } from "../db/migrate.js";
import { MockPaymentProvider } from "../payments/mock.js";
import { MockNafathProvider } from "../providers/nafath.js";
import { MockSmsProvider } from "../providers/sms.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const db = pgDb(config.databaseUrl);

const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);

const app = buildApp({
  db,
  config,
  sms: new MockSmsProvider(),
  nafath: new MockNafathProvider(),
  now: () => new Date(),
  limits: { global: 120, auth: 10 },
  mockPayments: new MockPaymentProvider(),
});

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`ilmak api listening on 127.0.0.1:${config.port} providers=${config.providers}`);
