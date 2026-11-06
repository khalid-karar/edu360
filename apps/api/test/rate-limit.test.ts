import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FallbackRateStore, MemoryRateStore, RedisRateStore, type RateStore } from "../src/http/rate-store.js";

describe("memory store", () => {
  it("counts per key and starts a new window after it ends", async () => {
    let t = 0;
    const s = new MemoryRateStore(() => t);
    expect(await s.hit("a", 1000)).toBe(1);
    expect(await s.hit("a", 1000)).toBe(2);
    expect(await s.hit("b", 1000)).toBe(1);
    t = 1500;
    expect(await s.hit("a", 1000)).toBe(1);
  });
});

describe("fallback store", () => {
  it("uses the fallback while the primary fails, and reports the error", async () => {
    const errors: unknown[] = [];
    const broken: RateStore = { hit: async () => { throw new Error("down"); } };
    const s = new FallbackRateStore(broken, new MemoryRateStore(), (e) => errors.push(e));
    expect(await s.hit("k", 1000)).toBe(1);
    expect(await s.hit("k", 1000)).toBe(2);
    expect(errors).toHaveLength(2);
  });
});

// Runs against a real redis-server when one is installed; skipped otherwise.
const hasRedis = spawnSync("redis-server", ["--version"]).status === 0;

describe.skipIf(!hasRedis)("redis store (real redis-server)", () => {
  const port = 6391;
  let server: ChildProcess;
  let a: Redis;
  let b: Redis;

  beforeAll(async () => {
    server = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    a = new Redis({ port, lazyConnect: true, maxRetriesPerRequest: 1 });
    b = new Redis({ port, lazyConnect: true, maxRetriesPerRequest: 1 });
    for (let i = 0; i < 50; i++) {
      try {
        await a.connect();
        await b.connect();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
        a.disconnect();
        b.disconnect();
        a = new Redis({ port, lazyConnect: true, maxRetriesPerRequest: 1 });
        b = new Redis({ port, lazyConnect: true, maxRetriesPerRequest: 1 });
      }
    }
    throw new Error("redis-server did not start");
  });
  afterAll(() => {
    a?.disconnect();
    b?.disconnect();
    server?.kill();
  });

  it("shares one count between two API processes", async () => {
    const p1 = new RedisRateStore(a, "t1:");
    const p2 = new RedisRateStore(b, "t1:");
    expect(await p1.hit("ip", 5000)).toBe(1);
    expect(await p2.hit("ip", 5000)).toBe(2);
    expect(await p1.hit("ip", 5000)).toBe(3);
  });

  it("expires the window", async () => {
    const s = new RedisRateStore(a, "t2:");
    expect(await s.hit("ip", 200)).toBe(1);
    expect(await s.hit("ip", 200)).toBe(2);
    await new Promise((r) => setTimeout(r, 350));
    expect(await s.hit("ip", 200)).toBe(1);
  });

  it("always leaves an expiry on the key", async () => {
    const s = new RedisRateStore(a, "t3:");
    await s.hit("ip", 60_000);
    const ttl = await a.pttl("t3:ip");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });
});
