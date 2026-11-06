/**
 * Counters behind the rate limiter. Memory is fine for one process; Redis makes the limit hold across several
 * API processes and across restarts. Both count hits in a fixed window per key.
 */
export interface RateStore {
  /** Records one hit and returns how many hits the key has in the current window (including this one). */
  hit(key: string, windowMs: number): Promise<number>;
}

export class MemoryRateStore implements RateStore {
  private readonly hits = new Map<string, { n: number; reset: number }>();
  constructor(private readonly clock: () => number = Date.now) {}

  async hit(key: string, windowMs: number): Promise<number> {
    const now = this.clock();
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { n: 1, reset: now + windowMs });
      return 1;
    }
    return ++h.n;
  }
}

/** The one Redis call this code needs; ioredis satisfies it, and tests can pass a fake. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

// One atomic step: count, and start the window on the first hit. Without the script a crash between
// INCR and PEXPIRE would leave a counter that never expires and locks the address out for good.
const HIT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;

export class RedisRateStore implements RateStore {
  constructor(private readonly redis: RedisLike, private readonly prefix = "rl:") {}

  async hit(key: string, windowMs: number): Promise<number> {
    const n = await this.redis.eval(HIT, 1, this.prefix + key, windowMs);
    if (typeof n !== "number") throw new Error("unexpected redis reply");
    return n;
  }
}

/**
 * Uses the primary store and drops to the fallback while the primary is failing, so a Redis outage
 * degrades to per-process limits instead of taking the API down or switching limits off.
 */
export class FallbackRateStore implements RateStore {
  constructor(
    private readonly primary: RateStore,
    private readonly fallback: RateStore,
    private readonly onError: (e: unknown) => void = () => {},
  ) {}

  async hit(key: string, windowMs: number): Promise<number> {
    try {
      return await this.primary.hit(key, windowMs);
    } catch (e) {
      this.onError(e);
      return this.fallback.hit(key, windowMs);
    }
  }
}
