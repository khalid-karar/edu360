import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import { authenticateToken, type AuthUser } from "../http/guard.js";
import type { Ctx } from "../http/context.js";
import { HttpError } from "../http/errors.js";
import { MemoryRateStore } from "../http/rate-store.js";
import { SESSION_COOKIE, TOKEN_RE, originAllowed, readCookie } from "../http/session-cookie.js";
import { sessionStillValid } from "../services/sessions.js";
import type { Conn, Hub } from "./hub.js";

export const WS_PATH = "/api/ws";
const MAX_FRAME_BYTES = 1024;
const HEARTBEAT_MS = 30_000;
const FRAMES_PER_WINDOW = 40;
const FRAME_WINDOW_MS = 10_000;
const DEFAULT_CONNECT_ATTEMPTS_PER_MINUTE = 30;

const TOPIC_RE = /^(booking|inquiry):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Only the two people in a conversation may listen to it: the teacher and whoever pays. */
async function mayListen(ctx: Ctx, userId: string, topic: string): Promise<boolean> {
  const m = TOPIC_RE.exec(topic);
  if (!m) return false;
  const table = m[1] === "booking" ? "bookings" : "inquiries";
  const r = await ctx.db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND (teacher_id = $2 OR payer_id = $2)`, [m[2], userId]);
  return (r.rowCount ?? 0) > 0;
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * Who is on the other end of an upgrade request. A browser sends the session cookie automatically, so for cookies the Origin must be ours
 * (otherwise any website could open a socket as the signed-in user). A bearer token cannot be attached by a web page, so it needs no such check.
 */
async function authenticate(ctx: Ctx, req: IncomingMessage): Promise<AuthUser> {
  const bearer = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization ?? "")?.[1];
  let token = bearer;
  if (!token) {
    const c = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!c || !TOKEN_RE.test(c)) throw new HttpError(401, "unauthenticated");
    const origin = req.headers.origin;
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
    if (!origin || !originAllowed(origin, host, ctx.config.allowedOrigins)) throw new HttpError(403, "bad_origin");
    token = c;
  }
  return authenticateToken(ctx, token, { roles: ["learner", "guardian", "teacher"] });
}

/** Adds the WebSocket endpoint to the API's HTTP server. Nothing else in the API changes: this only listens for "upgrade" requests on one path. */
export function attachRealtime(app: FastifyInstance, ctx: Ctx, hub: Hub): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const attempts = ctx.rateStore ?? new MemoryRateStore();

  app.server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    void (async () => {
      if (new URL(req.url ?? "/", "http://x").pathname !== WS_PATH) return refuse(socket, 404, "Not Found");
      const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0]!.trim();
      if ((await attempts.hit(`ws:${ip}`, 60_000)) > (ctx.limits.ws ?? DEFAULT_CONNECT_ATTEMPTS_PER_MINUTE)) return refuse(socket, 429, "Too Many Requests");
      let user: AuthUser;
      try {
        user = await authenticate(ctx, req);
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        return refuse(socket, status, status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Error");
      }
      wss.handleUpgrade(req, socket, head, (ws) => serve(ws, user));
    })().catch(() => refuse(socket, 500, "Error"));
  });

  function serve(ws: WebSocket, user: AuthUser): void {
    const conn = hub.add(ws, user.id, user.sessionId);
    let frames = 0;
    let windowStart = Date.now();
    const send = (o: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));

    ws.on("pong", () => { conn.alive = true; });
    ws.on("close", () => hub.remove(conn));
    ws.on("error", () => ws.terminate());
    ws.on("message", (data, isBinary) => {
      if (isBinary) return ws.close(1003, "text only");
      if (Date.now() - windowStart > FRAME_WINDOW_MS) { windowStart = Date.now(); frames = 0; }
      if (++frames > FRAMES_PER_WINDOW) return ws.close(1008, "too many messages");
      let m: { type?: unknown; topic?: unknown };
      try {
        m = JSON.parse(data.toString());
      } catch {
        return ws.close(1008, "bad frame");
      }
      if (m.type === "ping") return send({ type: "pong" });
      if (typeof m.topic !== "string" || (m.type !== "subscribe" && m.type !== "unsubscribe")) return ws.close(1008, "bad frame");
      const topic = m.topic;
      if (m.type === "unsubscribe") return void hub.leave(conn, topic);
      void subscribe(conn, topic, send);
    });
  }

  async function subscribe(conn: Conn, topic: string, send: (o: object) => unknown): Promise<void> {
    try {
      // Checked now, so a person removed from a conversation cannot join it; every later signal reaches only joined sockets.
      if (!(await mayListen(ctx, conn.userId, topic))) return void send({ type: "error", topic, error: "not_found" });
      if (!hub.join(conn, topic)) return void send({ type: "error", topic, error: "too_many_topics" });
      send({ type: "subscribed", topic });
    } catch {
      send({ type: "error", topic, error: "server_error" });
    }
  }

  // Ping everyone, drop sockets that stopped answering, and close the ones whose session ended or whose account was suspended.
  let tick = 0;
  const beat = setInterval(() => {
    tick++;
    for (const c of hub.connections) {
      if (!c.alive) { c.socket.terminate(); continue; }
      c.alive = false;
      c.socket.ping();
      if (tick % 2 === 0) {
        sessionStillValid(ctx.db, c.sessionId, ctx.now()).then((ok) => { if (!ok) c.socket.close(4401, "session ended"); }, () => {});
      }
    }
  }, HEARTBEAT_MS);
  beat.unref();
  app.addHook("onClose", async () => {
    clearInterval(beat);
    await hub.close();
    wss.close();
  });
}
