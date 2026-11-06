import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { attachAuthorizedPayment } from "../../services/bookings.js";
import type { Ctx } from "../context.js";
import { HttpError, parse } from "../errors.js";
import { guard, me } from "../guard.js";

/**
 * Registered only when PAYMENTS=mock. Plays the part of the hosted card form so the whole booking flow can
 * be clicked through in a browser without a payment provider. It can only authorize a hold on a booking
 * the caller is paying for, for exactly the booking's price, which is what the real card form does.
 */
export const devRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const mock = ctx.mockPayments;
  if (!mock) return;
  app.post("/dev/pay", { preHandler: guard(ctx, { roles: ["learner", "guardian"] }) }, async (req) => {
    const u = me(req);
    const { bookingId } = parse(z.object({ bookingId: z.uuid() }).strict(), req.body);
    const b = (await ctx.db.query<{ price_halalas: number; status: string }>("SELECT price_halalas, status FROM bookings WHERE id = $1 AND payer_id = $2", [bookingId, u.id])).rows[0];
    if (!b) throw new HttpError(404, "not_found");
    if (b.status !== "awaiting_payment") throw new HttpError(409, "not_payable");
    const pay = mock.authorize(b.price_halalas, { booking_id: bookingId });
    const r = await attachAuthorizedPayment({ db: ctx.db, payments: ctx.payments, now: ctx.now }, bookingId, pay.id);
    if (!r.ok) throw new HttpError(402, r.reason);
    return { ok: true, status: r.booking.status };
  });
};
