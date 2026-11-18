import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

/**
 * Who is listening to what. A topic is a conversation ("booking:<id>" or "inquiry:<id>"). The hub only carries a
 * "something new arrived here" signal: the content itself is fetched through the normal REST routes, so every access
 * rule and the contact-details filter stay in one place and the socket never carries message text.
 */
export interface Conn {
  readonly socket: WebSocket;
  readonly userId: string;
  readonly sessionId: string;
  readonly topics: Set<string>;
  alive: boolean;
}

/** Carries signals between API processes. Without one, signals stay inside this process, which is right for a single server. */
export interface Bus {
  publish(frame: string): Promise<void>;
  subscribe(onFrame: (frame: string) => void): Promise<void>;
  close(): Promise<void>;
}

export const MAX_CONNECTIONS_PER_USER = 6;
export const MAX_TOPICS_PER_CONNECTION = 20;

export class Hub {
  private readonly conns = new Set<Conn>();
  private readonly byTopic = new Map<string, Set<Conn>>();
  /** Tags our own frames on the bus so a process does not deliver them twice. */
  private readonly origin = randomUUID();

  constructor(private readonly bus?: Bus) {}

  async start(): Promise<void> {
    await this.bus?.subscribe((frame) => {
      try {
        const f = JSON.parse(frame) as { origin?: string; topic?: string; at?: string };
        if (f.origin !== this.origin && typeof f.topic === "string" && typeof f.at === "string") this.deliver(f.topic, f.at);
      } catch {
        /* a malformed frame from the bus is dropped */
      }
    });
  }

  async close(): Promise<void> {
    for (const c of this.conns) c.socket.close(1001, "server stopping");
    await this.bus?.close();
  }

  /** Registers a socket. The oldest of a user's sockets is closed if they open more than the cap (a new tab wins over a forgotten one). */
  add(socket: WebSocket, userId: string, sessionId: string): Conn {
    const mine = [...this.conns].filter((c) => c.userId === userId);
    while (mine.length >= MAX_CONNECTIONS_PER_USER) mine.shift()!.socket.close(4429, "too many connections");
    const c: Conn = { socket, userId, sessionId, topics: new Set(), alive: true };
    this.conns.add(c);
    return c;
  }

  remove(c: Conn): void {
    this.conns.delete(c);
    for (const t of c.topics) this.leave(c, t);
  }

  join(c: Conn, topic: string): boolean {
    if (c.topics.has(topic)) return true;
    if (c.topics.size >= MAX_TOPICS_PER_CONNECTION) return false;
    c.topics.add(topic);
    let set = this.byTopic.get(topic);
    if (!set) this.byTopic.set(topic, (set = new Set()));
    set.add(c);
    return true;
  }

  leave(c: Conn, topic: string): void {
    c.topics.delete(topic);
    const set = this.byTopic.get(topic);
    set?.delete(c);
    if (set?.size === 0) this.byTopic.delete(topic);
  }

  /** A new message exists in this conversation. Delivered here at once, and to other processes through the bus when there is one. */
  async publish(topic: string, now: Date): Promise<void> {
    const at = now.toISOString();
    this.deliver(topic, at);
    await this.bus?.publish(JSON.stringify({ origin: this.origin, topic, at })).catch(() => {
      /* the bus being down only costs other processes this signal: their clients still poll */
    });
  }

  private deliver(topic: string, at: string): void {
    const frame = JSON.stringify({ type: "message", topic, at });
    for (const c of this.byTopic.get(topic) ?? []) if (c.socket.readyState === c.socket.OPEN) c.socket.send(frame);
  }

  /** Closes every socket of a session (sign-out) with the "signed out" code. */
  dropSession(sessionId: string): void {
    for (const c of this.conns) if (c.sessionId === sessionId) c.socket.close(4401, "signed out");
  }

  get connections(): ReadonlySet<Conn> {
    return this.conns;
  }
}
