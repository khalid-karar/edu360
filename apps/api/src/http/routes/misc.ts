import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { confirmAuthorization } from "../../payments/provider.js";
import type { Ctx } from "../context.js";
import { HttpError } from "../errors.js";

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const miscRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  app.get("/api/health", async () => {
    await ctx.db.query("SELECT 1");
    return { ok: true, providers: ctx.config.providers, time: ctx.now().toISOString() };
  });

  // Coming-soon waitlist. Plain form posts (the site) and JSON both work. The honeypot field fools simple bots.
  app.post("/api/waitlist", async (req, reply) => {
    const body = obj(req.body);
    const isForm = (req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded");
    const done = () => {
      if (!isForm) return reply.code(201).send({ ok: true });
      return reply.code(303).header("location", "/thanks").send();
    };
    if (body["bot-field"]) return done();
    const name = str(body["name"]);
    const contact = str(body["contact"]);
    if (!name || !contact) throw new HttpError(400, "missing_fields");
    await mkdir(dirname(ctx.config.waitlistFile), { recursive: true });
    await appendFile(ctx.config.waitlistFile, JSON.stringify({ at: ctx.now().toISOString(), name, contact, role: str(body["role"], 30) }) + "\n");
    return done();
  });

  // Test double for the payment provider. Only exists while PROVIDERS=mock.
  const pay = ctx.mockPayments;
  if (pay) {
    app.post("/api/mock-pay/authorize", async (req, reply) => {
      const b = obj(req.body);
      const bookingId = str(b["bookingId"], 64);
      if (typeof b["amount"] !== "number" || !bookingId) throw new HttpError(400, "bad_input");
      return reply.code(201).send(pay.authorize(b["amount"], { booking_id: bookingId }));
    });
    app.post("/api/mock-pay/confirm", async (req) => {
      const b = obj(req.body);
      const id = str(b["paymentId"], 64);
      const bookingId = str(b["bookingId"], 64);
      if (!id || !bookingId || typeof b["amount"] !== "number") throw new HttpError(400, "bad_input");
      return confirmAuthorization(pay, id, { bookingId, amount: b["amount"] });
    });
    for (const op of ["capture", "void", "refund"] as const) {
      app.post(`/api/mock-pay/${op}`, async (req) => {
        const b = obj(req.body);
        const id = str(b["paymentId"], 64);
        if (!id) throw new HttpError(400, "bad_input");
        const amount = typeof b["amount"] === "number" ? b["amount"] : undefined;
        return op === "void" ? pay.void(id) : pay[op](id, amount);
      });
    }
  }
};
