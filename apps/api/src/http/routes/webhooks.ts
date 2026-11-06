import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { WebhookRejected, parseWebhook } from "../../payments/webhook.js";
import { ProviderError } from "../../payments/provider.js";
import { attachAuthorizedPayment } from "../../services/bookings.js";
import type { Ctx } from "../context.js";
import { HttpError } from "../errors.js";

/**
 * Moyasar webhook. The shared token only filters noise: nothing in the body is trusted. We read the
 * payment from Moyasar and act on that. Answers 200 for anything well-formed so Moyasar stops retrying,
 * including events for payments we do not know.
 */
export const webhookRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const deps = { db, payments: ctx.payments, now: ctx.now };

  app.post("/webhooks/moyasar", async (req) => {
    const secret = ctx.config.webhookSecret;
    if (!secret) throw new HttpError(503, "webhook_not_configured");
    let ev;
    try {
      ev = parseWebhook(req.body, secret);
    } catch (e) {
      if (e instanceof WebhookRejected) throw new HttpError(e.message === "bad secret token" ? 401 : 400, "rejected");
      throw e;
    }
    await db.query(
      "INSERT INTO webhook_events (id, type, payment_id, received_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
      [ev.id, ev.type, ev.paymentId, ctx.now()],
    );

    let p;
    try {
      p = await ctx.payments.getPayment(ev.paymentId);
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return { ok: true };
      throw e; // 5xx makes Moyasar retry, which is what we want when we cannot reach it
    }

    if (ev.type === "payment_authorized") {
      const bookingId = z.uuid().safeParse(p.metadata["booking_id"]);
      if (bookingId.success) await attachAuthorizedPayment(deps, bookingId.data, p.id);
      return { ok: true };
    }

    // Everything else only brings our payment record in line with what Moyasar says. It never moves a booking.
    const row = (await db.query<{ id: string; status: string }>("SELECT id, status FROM payments WHERE psp_reference = $1", [p.id])).rows[0];
    if (row && p.status === "captured" && row.status === "authorized") {
      await db.query("UPDATE payments SET status='captured', captured_halalas=$2, captured_at=COALESCE(captured_at,$3) WHERE id=$1", [row.id, p.capturedAmount ?? p.amount, ctx.now()]);
    } else if (row && p.status === "voided" && row.status === "authorized") {
      await db.query("UPDATE payments SET status='voided', voided_at=COALESCE(voided_at,$2) WHERE id=$1", [row.id, ctx.now()]);
    } else if (row && p.status === "refunded" && row.status === "captured") {
      await db.query("UPDATE payments SET status='refunded', refunded_halalas=$2 WHERE id=$1", [row.id, p.refundedAmount ?? p.capturedAmount ?? p.amount]);
    }
    return { ok: true };
  });
};
