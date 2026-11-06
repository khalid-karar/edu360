import type { FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";

/** Fixed-window limiter per client IP, kept in memory (one API process). */
export function rateLimit(max: number, windowMs = 60_000, clock: () => number = Date.now) {
  const hits = new Map<string, { n: number; reset: number }>();
  return async (req: FastifyRequest) => {
    const now = clock();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const h = hits.get(req.ip);
    if (!h || h.reset < now) {
      hits.set(req.ip, { n: 1, reset: now + windowMs });
      return;
    }
    if (++h.n > max) throw new HttpError(429, "rate_limited");
  };
}
