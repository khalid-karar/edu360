import type { Metrics } from "./metrics.js";
import type { Scanner } from "../scan/scanner.js";
import type { ObjectStorage } from "../storage/storage.js";
import type { RateStore } from "./rate-store.js";
import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import type { MockPaymentProvider } from "../payments/mock.js";
import type { PaymentProvider } from "../payments/provider.js";
import type { NafathProvider } from "../providers/nafath.js";
import type { Hub } from "../realtime/hub.js";
import type { VideoProvider } from "../video/provider.js";
import type { SmsProvider } from "../providers/sms.js";

/** Everything a route may touch. Tests pass fakes and a controllable clock. */
export interface Ctx {
  db: Db;
  storage: ObjectStorage;
  /** Request counters for /api/metrics. Absent: nothing is recorded. */
  metrics?: Metrics | undefined;
  /** Extra things /api/ready must find working besides the database (Redis, say). Each throws when it is not. */
  checks?: Record<string, () => Promise<void>> | undefined;
  /** Antivirus check on uploads. Absent: files are stored after the type and size checks only. */
  scanner?: Scanner | undefined;
  config: Config;
  sms: SmsProvider;
  nafath: NafathProvider;
  /** Moyasar in production, the in-memory fake in tests. */
  payments: PaymentProvider;
  video: VideoProvider;
  now: () => Date;
  limits: { global: number; auth: number; /** WebSocket connection attempts per address per minute. */ ws?: number };
  /** Shared rate-limit counters (Redis in production). Absent: each limiter counts in its own memory. */
  rateStore?: RateStore | undefined;
  /** Live-update sockets. Absent: chat still works, by polling. */
  hub?: Hub | undefined;
  /** Present only when PAYMENTS=mock: lets the dev-only /mock-pay endpoints play the card form. */
  mockPayments?: MockPaymentProvider;
}
