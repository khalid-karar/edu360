import type { ObjectStorage } from "../storage/storage.js";
import type { RateStore } from "./rate-store.js";
import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import type { MockPaymentProvider } from "../payments/mock.js";
import type { PaymentProvider } from "../payments/provider.js";
import type { NafathProvider } from "../providers/nafath.js";
import type { VideoProvider } from "../video/provider.js";
import type { SmsProvider } from "../providers/sms.js";

/** Everything a route may touch. Tests pass fakes and a controllable clock. */
export interface Ctx {
  db: Db;
  storage: ObjectStorage;
  config: Config;
  sms: SmsProvider;
  nafath: NafathProvider;
  /** Moyasar in production, the in-memory fake in tests. */
  payments: PaymentProvider;
  video: VideoProvider;
  now: () => Date;
  limits: { global: number; auth: number };
  /** Shared rate-limit counters (Redis in production). Absent: each limiter counts in its own memory. */
  rateStore?: RateStore | undefined;
  /** Present only when PAYMENTS=mock: lets the dev-only /mock-pay endpoints play the card form. */
  mockPayments?: MockPaymentProvider;
}
