import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { audit } from "../../services/audit.js";
import { actOnPayout, createPayoutRun, decideDispute, previewPayoutRun } from "../../services/finance.js";
import type { Ctx } from "../context.js";
import { HttpError, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";

/** Finance officers only. Only here can bank details be read, and every read is audited. */
export const financeRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const deps = { db, payments: ctx.payments, now: ctx.now };
  const pre = guard(ctx, { roles: ["finance_officer"] });
  const idOf = (req: { params: unknown }) => uuidParam((req.params as { id?: string }).id);

  app.get("/admin/finance/disputes", { preHandler: pre }, async (req) => {
    const { status } = parse(z.object({ status: z.enum(["open", "decided"]).default("open") }), req.query);
    const r = await db.query<{ id: string; booking_id: string; reason: string; created_at: Date; outcome: string | null; refund_halalas: number; captured_halalas: number; kind: string }>(
      `SELECT d.id, d.booking_id, d.reason, d.created_at, d.outcome, d.refund_halalas, p.captured_halalas, d.kind
         FROM disputes d JOIN payments p ON p.booking_id = d.booking_id
        WHERE (d.outcome IS NULL) = ($1 = 'open') ORDER BY d.created_at LIMIT 100`,
      [status],
    );
    return { items: r.rows.map((x) => ({ id: x.id, bookingId: x.booking_id, reason: x.reason, openedAt: x.created_at, outcome: x.outcome, refundHalalas: x.refund_halalas, capturedHalalas: x.captured_halalas, kind: x.kind })) };
  });

  app.get("/admin/finance/disputes/:id", { preHandler: pre }, async (req) => {
    const d = (
      await db.query<{ id: string; reason: string; outcome: string | null; note: string | null; created_at: Date; booking_id: string; status: string; starts_at: Date; price_halalas: number; teacher_name: string; payer_name: string; captured_halalas: number; commission_halalas: number; refunded_halalas: number; payout_id: string | null }>(
        `SELECT d.id, d.reason, d.outcome, d.note, d.created_at, b.id AS booking_id, b.status, b.starts_at, b.price_halalas,
                tu.display_name AS teacher_name, pu.display_name AS payer_name,
                p.captured_halalas, p.commission_halalas, p.refunded_halalas, p.payout_id
           FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN payments p ON p.booking_id = b.id
           JOIN users tu ON tu.id = b.teacher_id JOIN users pu ON pu.id = b.payer_id WHERE d.id = $1`,
        [idOf(req)],
      )
    ).rows[0];
    if (!d) throw new HttpError(404, "not_found");
    return {
      id: d.id,
      reason: d.reason,
      outcome: d.outcome,
      note: d.note,
      openedAt: d.created_at,
      booking: { id: d.booking_id, status: d.status, startsAt: d.starts_at, priceHalalas: d.price_halalas, teacher: d.teacher_name, payer: d.payer_name },
      payment: { capturedHalalas: d.captured_halalas, commissionHalalas: d.commission_halalas, refundedHalalas: d.refunded_halalas, paidOut: Boolean(d.payout_id) },
    };
  });

  const Decision = z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("full_refund"), note: z.string().trim().min(10).max(1000) }).strict(),
    z.object({ outcome: z.literal("partial_refund"), refundHalalas: z.number().int().positive(), note: z.string().trim().min(10).max(1000) }).strict(),
    z.object({ outcome: z.literal("release_to_teacher"), note: z.string().trim().min(10).max(1000) }).strict(),
  ]);
  app.post("/admin/finance/disputes/:id/decide", { preHandler: pre }, async (req) => {
    const s = me(req);
    const b = parse(Decision, req.body);
    const decision = b.outcome === "partial_refund" ? { outcome: b.outcome, refundHalalas: b.refundHalalas } : { outcome: b.outcome };
    return decideDispute(deps, s.id, idOf(req), decision, b.note);
  });

  app.get("/admin/finance/payout-runs/preview", { preHandler: pre }, async () => previewPayoutRun(deps));
  app.post("/admin/finance/payout-runs", { preHandler: pre }, async (req, reply) => {
    const r = await createPayoutRun(deps, me(req).id);
    reply.code(201);
    return r;
  });

  app.get("/admin/finance/payouts", { preHandler: pre }, async (req) => {
    const { status } = parse(z.object({ status: z.enum(["pending", "approved", "paid", "failed", "on_hold"]).optional() }), req.query);
    const r = await db.query<{ id: string; teacher_id: string; teacher_name: string; amount_halalas: number; status: string; needs_review: boolean; created_at: Date; paid_at: Date | null; created_by: string | null }>(
      `SELECT o.id, o.teacher_id, u.display_name AS teacher_name, o.amount_halalas, o.status, o.needs_review, o.created_at, o.paid_at, o.created_by
         FROM payouts o JOIN users u ON u.id = o.teacher_id WHERE ($1::text IS NULL OR o.status::text = $1) ORDER BY o.created_at DESC LIMIT 100`,
      [status ?? null],
    );
    return { items: r.rows.map((o) => ({ id: o.id, teacherId: o.teacher_id, teacherName: o.teacher_name, amountHalalas: o.amount_halalas, status: o.status, needsReview: o.needs_review, createdAt: o.created_at, paidAt: o.paid_at, createdBy: o.created_by })) };
  });

  // The only place a full IBAN leaves the system. Reading it is logged.
  app.get("/admin/finance/payouts/:id", { preHandler: pre }, async (req) => {
    const s = me(req);
    const id = idOf(req);
    const o = (
      await db.query<{ id: string; amount_halalas: number; status: string; needs_review: boolean; teacher_id: string; teacher_name: string; iban: string | null; holder: string | null; note: string | null; bank_reference: string | null }>(
        `SELECT o.id, o.amount_halalas, o.status, o.needs_review, o.note, o.bank_reference, o.teacher_id, u.display_name AS teacher_name, t.iban, t.iban_holder_name AS holder
           FROM payouts o JOIN users u ON u.id = o.teacher_id JOIN teacher_profiles t ON t.user_id = o.teacher_id WHERE o.id = $1`,
        [id],
      )
    ).rows[0];
    if (!o) throw new HttpError(404, "not_found");
    const pays = await db.query<{ booking_id: string; captured_halalas: number; refunded_halalas: number; commission_halalas: number; platform_credit_halalas: number }>("SELECT booking_id, captured_halalas, refunded_halalas, commission_halalas, platform_credit_halalas FROM payments WHERE payout_id = $1", [id]);
    await audit(db, { actorId: s.id, action: "finance.viewed_iban", targetType: "payout", targetId: id });
    return {
      id: o.id,
      amountHalalas: o.amount_halalas,
      status: o.status,
      needsReview: o.needs_review,
      note: o.note,
      bankReference: o.bank_reference,
      teacher: { id: o.teacher_id, displayName: o.teacher_name, iban: o.iban, holderName: o.holder },
      lines: pays.rows.map((p) => ({ bookingId: p.booking_id, capturedHalalas: p.captured_halalas, refundedHalalas: p.refunded_halalas, commissionHalalas: p.commission_halalas, platformCreditHalalas: p.platform_credit_halalas })),
    };
  });

  const act = (path: string, action: "approve" | "hold" | "mark_paid" | "fail", schema: z.ZodType<{ bankReference?: string; note?: string }>) =>
    app.post(`/admin/finance/payouts/:id/${path}`, { preHandler: pre }, async (req) => {
      const input = parse(schema, req.body ?? {});
      return { status: await actOnPayout(deps, me(req).id, idOf(req), action, input) };
    });
  act("approve", "approve", z.object({}).strict());
  act("hold", "hold", z.object({ note: z.string().trim().min(5).max(500) }).strict());
  act("mark-paid", "mark_paid", z.object({ bankReference: z.string().trim().min(3).max(60) }).strict());
  act("fail", "fail", z.object({ note: z.string().trim().min(5).max(500) }).strict());
};
