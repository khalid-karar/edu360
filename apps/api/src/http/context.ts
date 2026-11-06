import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import type { MockPaymentProvider } from "../payments/mock.js";
import type { PaymentProvider } from "../payments/provider.js";
import type { NafathProvider } from "../providers/nafath.js";
import type { SmsProvider } from "../providers/sms.js";

/** Everything a route may touch. Tests pass fakes and a controllable clock. */
export interface Ctx {
  db: Db;
  config: Config;
  sms: SmsProvider;
  nafath: NafathProvider;
  /** Moyasar in production, the in-memory fake in tests. */
  payments: PaymentProvider;
  now: () => Date;
  limits: { global: number; auth: number };
  /** Present only when PAYMENTS=mock: lets the dev-only /mock-pay endpoints play the card form. */
  mockPayments?: MockPaymentProvider;
}
