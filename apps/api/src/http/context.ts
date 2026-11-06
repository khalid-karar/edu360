import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import type { MockPaymentProvider } from "../payments/mock.js";
import type { NafathProvider } from "../providers/nafath.js";
import type { SmsProvider } from "../providers/sms.js";

/** Everything a route may touch. Tests pass fakes and a controllable clock. */
export interface Ctx {
  db: Db;
  config: Config;
  sms: SmsProvider;
  nafath: NafathProvider;
  now: () => Date;
  limits: { global: number; auth: number };
  /** Present only when PROVIDERS=mock. */
  mockPayments?: MockPaymentProvider;
}
