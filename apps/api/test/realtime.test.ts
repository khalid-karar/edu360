import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import WebSocket from "ws";
import { Hub, MAX_CONNECTIONS_PER_USER } from "../src/realtime/hub.js";
import { RedisBus } from "../src/realtime/redis-bus.js";
import { sessionStillValid } from "../src/services/sessions.js";
import { makeHarness, nextPhone } from "./helpers/harness.js";
import { makeMarket } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
let url: string;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
  await h.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = h.app.server.address();
  url = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/ws`;
});
afterAll(async () => {
  await h.app.close();
});

interface Client {
  ws: WebSocket;
  got: any[];
  next: (ms?: number) => Promise<any>;
  closed: Promise<number>;
}

/** Opens a socket. Rejects with the HTTP status when the server refuses the upgrade. */
function connect(headers: Record<string, string>, path = ""): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url + path, { headers });
    const got: any[] = [];
    const waiters: ((v: any) => void)[] = [];
    ws.on("message", (d) => {
      const v = JSON.parse(d.toString());
      const w = waiters.shift();
      if (w) w(v);
      else got.push(v);
    });
    const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
    const next = (ms = 2000) =>
      got.length
        ? Promise.resolve(got.shift())
        : new Promise<any>((res, rej) => {
            waiters.push(res);
            setTimeout(() => {
              const i = waiters.indexOf(res);
              if (i >= 0) waiters.splice(i, 1); // a timed-out wait must not swallow the next frame
              rej(new Error("timed out waiting for a frame"));
            }, ms);
          });
    ws.on("open", () => resolve({ ws, got, next, closed }));
    ws.on("unexpected-response", (_req, res) => reject(Object.assign(new Error("refused"), { status: res.statusCode })));
    ws.on("error", () => {});
  });
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const refusedWith = async (p: Promise<Client>) => (await p.then(() => ({ status: 101 }), (e) => e)).status as number;

/** A booking between a fresh teacher and learner, open for chat. */
async function booking() {
  const t = await m.teacher();
  const l = await m.verified("learner");
  await m.openWindow(t, 2, 6, 18);
  const b = await m.bookAndPay(l, t, m.at(2, 9));
  return { t, l, id: b.id, topic: `booking:${b.id}` };
}
const say = (token: string, id: string, body: string) => h.call("POST", `/api/bookings/${id}/messages`, { token, body: { body } });
const sub = async (c: Client, topic: string) => { c.ws.send(JSON.stringify({ type: "subscribe", topic })); return c.next(); };

describe("connecting", () => {
  it("refuses a connection with no session, a bad session, or a path that is not the socket", async () => {
    expect(await refusedWith(connect({}))).toBe(401);
    expect(await refusedWith(connect(bearer("a".repeat(43))))).toBe(401);
    expect(await refusedWith(connect({ cookie: `ilmak_session=${"a".repeat(43)}`, origin: "https://ilmak.test" }))).toBe(401);
    const l = await m.verified("learner");
    expect(await refusedWith(connect(bearer(l.token), "x"))).toBe(404);
  });

  it("accepts a cookie only from our own origin, since a web page can always send the cookie", async () => {
    const l = await m.verified("learner");
    const cookie = `ilmak_session=${l.token}`;
    expect(await refusedWith(connect({ cookie }))).toBe(403); // a browser always sends Origin; its absence is not a browser
    expect(await refusedWith(connect({ cookie, origin: "https://evil.example" }))).toBe(403);
    const ok = await connect({ cookie, origin: "https://ilmak.test" });
    ok.ws.close();
    const sameHost = await connect({ cookie, origin: new URL(url).origin.replace("ws:", "http:"), host: new URL(url).host });
    sameHost.ws.close();
  });

  it("refuses staff, suspended and banned accounts", async () => {
    const officer = await h.staff("vetting_officer");
    expect(await refusedWith(connect(bearer(officer.token)))).toBe(403);
    const l = await m.verified("learner");
    await h.db.query("UPDATE users SET status = 'suspended' WHERE id = $1", [l.id]);
    expect(await refusedWith(connect(bearer(l.token)))).toBe(403);
    await h.db.query("UPDATE users SET status = 'banned' WHERE id = $1", [l.id]);
    expect(await refusedWith(connect(bearer(l.token)))).toBe(403);
  });

  it("closes a user's oldest socket when they open more than the allowed number", async () => {
    const l = await m.verified("learner");
    const clients: Client[] = [];
    for (let i = 0; i < MAX_CONNECTIONS_PER_USER + 1; i++) clients.push(await connect(bearer(l.token)));
    expect(await clients[0]!.closed).toBe(4429);
    expect(clients[1]!.ws.readyState).toBe(WebSocket.OPEN);
    clients.forEach((c) => c.ws.close());
  });
});

describe("conversation signals", () => {
  it("tells the other person's socket, and the sender's other tabs, that a message arrived, without the message text", async () => {
    const { t, l, id, topic } = await booking();
    const tc = await connect(bearer(t.token));
    const lc = await connect(bearer(l.token));
    expect(await sub(tc, topic)).toEqual({ type: "subscribed", topic });
    expect(await sub(lc, topic)).toEqual({ type: "subscribed", topic });
    expect((await say(l.token, id, "السلام عليكم، متى نبدأ؟")).status).toBe(201);
    for (const c of [tc, lc]) {
      const ev = await c.next();
      expect(ev).toMatchObject({ type: "message", topic });
      expect(JSON.stringify(ev)).not.toContain("السلام");
    }
    // The signal says to fetch; the existing route returns the message.
    expect((await h.call("GET", `/api/bookings/${id}/messages`, { token: t.token })).body.items).toHaveLength(1);
    tc.ws.close();
    lc.ws.close();
  });

  it("works for questions before booking too", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const q = await h.call("POST", `/api/teachers/${t.id}/inquiry`, { token: l.token, body: { body: "هل تدرّس الأطفال؟" } });
    const topic = `inquiry:${q.body.inquiryId}`;
    const tc = await connect(bearer(t.token));
    expect((await sub(tc, topic)).type).toBe("subscribed");
    await h.call("POST", `/api/inquiries/${q.body.inquiryId}/messages`, { token: l.token, body: { body: "وكم سعر الساعة؟" } });
    expect(await tc.next()).toMatchObject({ type: "message", topic });
    // A follow-up through the "ask" route reaches an open thread as well.
    await h.call("POST", `/api/teachers/${t.id}/inquiry`, { token: l.token, body: { body: "شكراً" } });
    expect(await tc.next()).toMatchObject({ type: "message", topic });
    tc.ws.close();
  });

  it("keeps strangers out: they cannot subscribe and hear nothing", async () => {
    const { t, l, id, topic } = await booking();
    const stranger = await m.verified("learner");
    const otherTeacher = await m.teacher();
    for (const who of [stranger, otherTeacher]) {
      const c = await connect(bearer(who.token));
      expect(await sub(c, topic)).toEqual({ type: "error", topic, error: "not_found" });
      await say(l.token, id, "رسالة خاصة");
      await expect(c.next(300)).rejects.toThrow("timed out");
      c.ws.close();
    }
    void t;
  });

  it("does not signal a blocked message, since nobody receives it", async () => {
    const { t, l, id, topic } = await booking();
    const tc = await connect(bearer(t.token));
    await sub(tc, topic);
    expect((await say(l.token, id, "كلمني على 0555555555")).status).toBe(422);
    await expect(tc.next(300)).rejects.toThrow("timed out");
    tc.ws.close();
  });

  it("stops signalling after unsubscribe, and rejects malformed topics", async () => {
    const { t, l, id, topic } = await booking();
    const tc = await connect(bearer(t.token));
    await sub(tc, topic);
    tc.ws.send(JSON.stringify({ type: "unsubscribe", topic }));
    await new Promise((r) => setTimeout(r, 50));
    await say(l.token, id, "هل أنت هنا؟");
    await expect(tc.next(300)).rejects.toThrow("timed out");
    for (const bad of ["booking:1", "booking:../etc", "user:" + t.id, `booking:${id}' OR 1=1 --`]) expect((await sub(tc, bad)).error).toBe("not_found");
    tc.ws.close();
  });
});

describe("keeping sockets safe", () => {
  it("rate-limits connection attempts per address", async () => {
    const saved = h.ctx.limits.ws;
    h.ctx.limits.ws = 3;
    const l = await m.verified("learner");
    const results: number[] = [];
    for (let i = 0; i < 6; i++) results.push(await refusedWith(connect(bearer(l.token))));
    h.ctx.limits.ws = saved;
    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it("closes the socket when its owner signs out", async () => {
    const l = await m.verified("learner");
    const c = await connect(bearer(l.token));
    expect((await h.call("POST", "/api/auth/logout", { token: l.token })).status).toBe(200);
    expect(await c.closed).toBe(4401);
  });

  it("knows when a session has ended or its account was suspended, for the periodic re-check", async () => {
    const l = await m.verified("learner");
    const sid = (await h.db.query<{ id: string }>("SELECT id FROM auth_sessions WHERE user_id = $1", [l.id])).rows[0]!.id;
    expect(await sessionStillValid(h.db, sid, h.clock.now())).toBe(true);
    await h.db.query("UPDATE users SET status = 'suspended' WHERE id = $1", [l.id]);
    expect(await sessionStillValid(h.db, sid, h.clock.now())).toBe(false);
    await h.db.query("UPDATE users SET status = 'active' WHERE id = $1", [l.id]);
    expect(await sessionStillValid(h.db, sid, new Date(h.clock.now().getTime() + 365 * 86_400_000))).toBe(false); // expired
    await h.db.query("UPDATE auth_sessions SET revoked_at = now() WHERE id = $1", [sid]);
    expect(await sessionStillValid(h.db, sid, h.clock.now())).toBe(false);
  });

  it("drops a connection that sends garbage, binary data or too much", async () => {
    const l = await m.verified("learner");
    const a = await connect(bearer(l.token));
    a.ws.send("not json");
    expect(await a.closed).toBe(1008);
    const b = await connect(bearer(l.token));
    b.ws.send(Buffer.from([1, 2, 3]));
    expect(await b.closed).toBe(1003);
    const c = await connect(bearer(l.token));
    c.ws.send("x".repeat(5000));
    expect(await c.closed).toBe(1009);
    const d = await connect(bearer(l.token));
    d.ws.send(JSON.stringify({ type: "subscribe" }));
    expect(await d.closed).toBe(1008);
  });

  it("answers pings and drops a socket that floods frames", async () => {
    const l = await m.verified("learner");
    const c = await connect(bearer(l.token));
    c.ws.send(JSON.stringify({ type: "ping" }));
    expect(await c.next()).toEqual({ type: "pong" });
    for (let i = 0; i < 60; i++) c.ws.send(JSON.stringify({ type: "ping" }));
    expect(await c.closed).toBe(1008);
  });

  it("limits how many conversations one socket can follow", async () => {
    const l = await m.verified("learner");
    const c = await connect(bearer(l.token));
    // Own valid conversations are needed to pass the participant check, so use real inquiries.
    const topics: string[] = [];
    for (let i = 0; i < 21; i++) {
      const t = await m.teacher();
      const q = await h.call("POST", `/api/teachers/${t.id}/inquiry`, { token: l.token, body: { body: "سؤال " + i } });
      if (q.status === 201) topics.push(`inquiry:${q.body.inquiryId}`);
      h.clock.advance(11 * 60 * 60_000); // stay under the daily new-thread limit
    }
    expect(topics).toHaveLength(21);
    const replies: string[] = [];
    for (const t of topics) replies.push((await sub(c, t)).type === "subscribed" ? "ok" : "refused");
    expect(replies.filter((r) => r === "ok")).toHaveLength(20);
    expect(replies[20]).toBe("refused");
    c.ws.close();
  });
});

// Two API processes, one Redis: a message posted through one reaches a socket held by the other.
const hasRedis = spawnSync("redis-server", ["--version"]).status === 0;
describe.skipIf(!hasRedis)("across API processes (real redis-server)", () => {
  const port = 6392;
  let server: ChildProcess;
  let r1: Redis;
  let r2: Redis;
  beforeAll(async () => {
    server = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      r1 = new Redis({ port, lazyConnect: true, maxRetriesPerRequest: 1 });
      r2 = new Redis({ port, lazyConnect: true, maxRetriesPerRequest: 1 });
      try {
        await r1.connect();
        await r2.connect();
        return;
      } catch {
        r1.disconnect();
        r2.disconnect();
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("redis-server did not start");
  });
  afterAll(() => {
    r1?.disconnect();
    r2?.disconnect();
    server?.kill();
  });

  it("delivers a signal published by one hub to a socket on the other, once", async () => {
    const hubA = new Hub(new RedisBus(r1 as never));
    const hubB = new Hub(new RedisBus(r2 as never));
    await hubA.start();
    await hubB.start();
    const sent: string[] = [];
    const fake = { OPEN: 1, readyState: 1, send: (f: string) => sent.push(f), close: () => {} } as never;
    const conn = hubB.add(fake, "u1", "s1");
    hubB.join(conn, "booking:x");
    const local = { OPEN: 1, readyState: 1, send: (f: string) => sent.push("A:" + f), close: () => {} } as never;
    hubA.join(hubA.add(local, "u2", "s2"), "booking:x");
    await hubA.publish("booking:x", new Date("2026-11-06T09:00:00Z"));
    await new Promise((r) => setTimeout(r, 200));
    expect(sent.filter((s) => !s.startsWith("A:"))).toHaveLength(1); // reached the other process
    expect(sent.filter((s) => s.startsWith("A:"))).toHaveLength(1); // delivered locally once, not echoed back by the bus
    await hubA.close();
    await hubB.close();
  });
});
