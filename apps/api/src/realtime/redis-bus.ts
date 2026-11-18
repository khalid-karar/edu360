import type { Bus } from "./hub.js";

/** The slice of ioredis this needs, so tests can pass the real client without importing it here. */
export interface RedisPubSub {
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", cb: (channel: string, message: string) => void): unknown;
  on(event: "error", cb: (e: Error) => void): unknown;
  duplicate(override?: Record<string, unknown>): RedisPubSub & { disconnect(): void };
  disconnect(): void;
}

const CHANNEL = "ilmak:realtime";

/** Redis pub/sub between API processes. The subscriber needs its own connection because a subscribed connection can do nothing else. */
export class RedisBus implements Bus {
  private sub: (RedisPubSub & { disconnect(): void }) | undefined;
  constructor(private readonly redis: RedisPubSub) {}

  async publish(frame: string): Promise<void> {
    await this.redis.publish(CHANNEL, frame);
  }

  async subscribe(onFrame: (frame: string) => void): Promise<void> {
    // The main connection refuses commands while it is not connected (so rate limits fall back to memory at once). The subscriber is
    // the opposite: it may queue its subscribe while it connects and must resubscribe by itself after a reconnect.
    this.sub = this.redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null });
    this.sub.on("message", (_channel, message) => onFrame(message));
    let lastLogged = 0;
    this.sub.on("error", (e) => {
      if (Date.now() - lastLogged > 60_000) console.error("redis subscriber error (live chat reaches this process only until it reconnects):", e.message);
      lastLogged = Date.now();
    });
    const subscribed = this.sub.subscribe(CHANNEL);
    // If Redis is slow or down at boot, start anyway: chat then reaches only this process until the subscription lands.
    subscribed.catch(() => {});
    await Promise.race([subscribed, new Promise((r) => setTimeout(r, 3000).unref())]);
  }

  async close(): Promise<void> {
    this.sub?.disconnect();
  }
}
