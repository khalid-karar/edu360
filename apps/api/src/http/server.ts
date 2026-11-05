import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { MockPaymentProvider } from "../payments/mock.js";
import { confirmAuthorization, ProviderError } from "../payments/provider.js";
import { MockSmsProvider, OtpService } from "../providers/sms.js";
import { MockNafathProvider } from "../providers/nafath.js";

const PORT = Number(process.env["PORT"] ?? 3000);
const MODE = process.env["PROVIDERS"] ?? "mock";
const DATA = process.env["WAITLIST_FILE"] ?? "./data/waitlist.jsonl";

// Real providers are not wired yet. Refuse to start rather than silently run mocks by mistake.
if (MODE !== "mock") throw new Error(`PROVIDERS=${MODE} is not implemented yet; use PROVIDERS=mock`);

const payments = new MockPaymentProvider();
const sms = new MockSmsProvider();
const otp = new OtpService(sms);
const nafath = new MockNafathProvider();

const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string, max = 30): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  return ++h.n > max;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 16_384) throw new HttpError(413, "too_large");
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if ((req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    const v: unknown = JSON.parse(raw || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, "bad_json");
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null);

const server = createServer(async (req, res) => {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0]!.trim();
  try {
    if (limited(ip)) throw new HttpError(429, "rate_limited");
    const url = new URL(req.url ?? "/", "http://x");
    const route = `${req.method} ${url.pathname}`;
    const body = req.method === "POST" ? await readJson(req) : {};

    switch (route) {
      case "GET /api/health":
        return send(res, 200, { ok: true, providers: MODE, time: new Date().toISOString() });

      case "POST /api/waitlist": {
        const name = str(body["name"]);
        const contact = str(body["contact"]);
        const role = str(body["role"], 30);
        const isForm = (req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded");
        const done = () => {
          if (!isForm) return send(res, 201, { ok: true });
          res.writeHead(303, { location: "/thanks" });
          res.end();
        };
        if (body["bot-field"]) return done(); // honeypot: pretend success, store nothing
        if (!name || !contact) throw new HttpError(400, "missing_fields");
        await mkdir(dirname(DATA), { recursive: true });
        await appendFile(DATA, JSON.stringify({ at: new Date().toISOString(), name, contact, role }) + "\n");
        return done();
      }

      case "POST /api/auth/otp/request": {
        const phone = str(body["phone"], 20);
        if (!phone) throw new HttpError(400, "missing_phone");
        const code = await otp.request(phone).catch(() => {
          throw new HttpError(400, "invalid_phone");
        });
        return send(res, 200, { ok: true, mock_code: code }); // mock mode only: real SMS never echoes the code
      }
      case "POST /api/auth/otp/verify": {
        const phone = str(body["phone"], 20);
        const code = str(body["code"], 6);
        if (!phone || !code) throw new HttpError(400, "missing_fields");
        return otp.verify(phone, code) ? send(res, 200, { ok: true }) : send(res, 401, { ok: false });
      }

      case "POST /api/nafath/start": {
        const id = str(body["nationalId"], 10);
        if (!id) throw new HttpError(400, "missing_id");
        const r = await nafath.start(id).catch(() => {
          throw new HttpError(400, "invalid_national_id");
        });
        return send(res, 200, r);
      }
      case "GET /api/nafath/status": {
        const id = url.searchParams.get("requestId") ?? "";
        return send(res, 200, { status: await nafath.status(id) });
      }

      case "POST /api/mock-pay/authorize": {
        const amount = body["amount"];
        const bookingId = str(body["bookingId"], 64);
        if (typeof amount !== "number" || !bookingId) throw new HttpError(400, "bad_input");
        const p = payments.authorize(amount, { booking_id: bookingId });
        return send(res, 201, p);
      }
      case "POST /api/mock-pay/confirm": {
        const id = str(body["paymentId"], 64);
        const bookingId = str(body["bookingId"], 64);
        const amount = body["amount"];
        if (!id || !bookingId || typeof amount !== "number") throw new HttpError(400, "bad_input");
        return send(res, 200, await confirmAuthorization(payments, id, { bookingId, amount }));
      }
      case "POST /api/mock-pay/capture":
      case "POST /api/mock-pay/void":
      case "POST /api/mock-pay/refund": {
        const id = str(body["paymentId"], 64);
        if (!id) throw new HttpError(400, "bad_input");
        const amount = typeof body["amount"] === "number" ? body["amount"] : undefined;
        const op = url.pathname.split("/").pop() as "capture" | "void" | "refund";
        return send(res, 200, op === "void" ? await payments.void(id) : await payments[op](id, amount));
      }
    }
    throw new HttpError(404, "not_found");
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message });
    if (e instanceof ProviderError) return send(res, e.status, { ok: false, error: e.message });
    console.error(e);
    return send(res, 500, { ok: false, error: "server_error" });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`ilmak api listening on 127.0.0.1:${PORT} providers=${MODE}`));
