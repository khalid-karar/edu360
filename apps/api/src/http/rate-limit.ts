import type { FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";
import { MemoryRateStore, type RateStore } from "./rate-store.js";

export interface RateLimitOpts {
  /** Separates this limiter's counters from the others in a shared store. */
  name: string;
  windowMs?: number;
  /** Shared counters (Redis). Defaults to a private in-memory store, which only holds for one process. */
  store?: RateStore | undefined;
}

/** Fixed-window limiter per client IP. */
export function rateLimit(max: number, opts: RateLimitOpts) {
  const store = opts.store ?? new MemoryRateStore();
  const windowMs = opts.windowMs ?? 60_000;
  return async (req: FastifyRequest) => {
    if ((await store.hit(`${opts.name}:${req.ip}`, windowMs)) > max) throw new HttpError(429, "rate_limited");
  };
}
