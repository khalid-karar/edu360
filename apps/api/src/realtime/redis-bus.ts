import type { Bus } from "./hub.js";

/** The slice of ioredis this needs, so tests can pass the real client without importing it here. */
export interface RedisPubSub {
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", cb: (channel: string, message: string) => void): unknown;
  duplicate(): RedisPubSub & { disconnect(): void };
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
    this.sub = this.redis.duplicate();
    this.sub.on("message", (_channel, message) => onFrame(message));
    await this.sub.subscribe(CHANNEL);
  }

  async close(): Promise<void> {
    this.sub?.disconnect();
  }
}
