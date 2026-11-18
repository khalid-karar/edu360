import { COOKIE_SESSION } from "./api";

/**
 * One WebSocket per page, shared by everything that wants live updates. The server only says "something new arrived in conversation X";
 * the listener then fetches through the normal API. If the socket cannot be had (older browser, another origin, a proxy that blocks it,
 * a dropped connection) listeners are told it is down so they can fall back to polling, and it reconnects with backoff.
 */
type Listener = () => void;
type StatusListener = (up: boolean) => void;

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;
const SIGNED_OUT = 4401;

class Realtime {
  private ws: WebSocket | null = null;
  private up = false;
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly topics = new Map<string, Set<Listener>>();
  private readonly status = new Set<StatusListener>();

  /** Calls `onSignal` whenever the conversation has news, and once each time the socket (re)connects so nothing is missed meanwhile. */
  subscribe(topic: string, onSignal: Listener): () => void {
    let set = this.topics.get(topic);
    if (!set) this.topics.set(topic, (set = new Set()));
    set.add(onSignal);
    if (this.up) this.send({ type: "subscribe", topic });
    this.ensure();
    return () => {
      set.delete(onSignal);
      if (set.size === 0) {
        this.topics.delete(topic);
        if (this.up) this.send({ type: "unsubscribe", topic });
      }
      if (this.topics.size === 0) this.close();
    };
  }

  onStatus(cb: StatusListener): () => void {
    this.status.add(cb);
    cb(this.up);
    return () => void this.status.delete(cb);
  }

  private setUp(v: boolean) {
    if (this.up === v) return;
    this.up = v;
    this.status.forEach((cb) => cb(v));
  }

  private send(o: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  private ensure() {
    if (!COOKIE_SESSION || typeof WebSocket === "undefined" || this.ws || this.timer) return;
    this.stopped = false;
    this.open();
  }

  private open() {
    const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/ws`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return this.retry();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.setUp(true);
      for (const [topic, set] of this.topics) {
        this.send({ type: "subscribe", topic });
        set.forEach((cb) => cb()); // catch up on anything that arrived while disconnected
      }
      this.ping = setInterval(() => this.send({ type: "ping" }), PING_MS);
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as { type?: string; topic?: string };
        if (m.type === "message" && m.topic) this.topics.get(m.topic)?.forEach((cb) => cb());
      } catch {
        /* ignore anything that is not ours */
      }
    };
    ws.onclose = (e) => {
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      this.ws = null;
      this.setUp(false);
      if (e.code === SIGNED_OUT) this.stopped = true; // signed out: reconnecting would only be refused
      if (!this.stopped && this.topics.size > 0) this.retry();
    };
    ws.onerror = () => ws.close();
  }

  private retry() {
    // Exponential backoff with jitter, so a restarted server is not hit by every browser at the same second.
    const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.tries++) * (0.5 + Math.random() / 2);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.topics.size > 0 && !this.stopped) this.open();
    }, wait);
  }

  private close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close(1000);
  }
}

export const realtime = new Realtime();

/** "/bookings/<id>" -> "booking:<id>", "/inquiries/<id>" -> "inquiry:<id>"; anything else has no live channel. */
export function topicFor(root: string): string | null {
  const m = /^\/(bookings|inquiries)\/([0-9a-f-]{36})$/.exec(root);
  return m ? `${m[1] === "bookings" ? "booking" : "inquiry"}:${m[2]}` : null;
}
