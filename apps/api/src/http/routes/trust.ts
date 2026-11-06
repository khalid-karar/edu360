import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { filterMessage } from "../../domain/chat-filter.js";
import { openDispute } from "../../services/finance.js";
import { audit } from "../../services/audit.js";
import type { Ctx } from "../context.js";
import { HttpError, isUniqueViolation, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";
import { APPEAL_WINDOW_DAYS, fileAppeal } from "../../services/appeals.js";

const REVIEW_WINDOW_DAYS = 30;
const MAX_REPORTS_PER_DAY = 5;
const DAY = 86_400_000;

const NewReport = z
  .object({
    bookingId: z.uuid(),
    category: z.enum(["conduct", "safety", "no_show", "payment", "other"]),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

/** What every user can do about trust: report the other party, dispute a charge, review a lesson, see their own record. */
export const trustRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const participant = guard(ctx, { roles: ["learner", "guardian", "teacher"] });
  const payer = guard(ctx, { roles: ["learner", "guardian"] });
  const idOf = (req: { params: unknown }) => uuidParam((req.params as { id?: string }).id);

  app.post("/reports", { preHandler: participant }, async (req, reply) => {
    const u = me(req);
    const b = parse(NewReport, req.body);
    const now = ctx.now();
    const id = await db.tx(async (tx) => {
      const bk = (await tx.query<{ teacher_id: string; payer_id: string; status: string }>("SELECT teacher_id, payer_id, status FROM bookings WHERE id = $1", [b.bookingId])).rows[0];
      if (!bk || (bk.teacher_id !== u.id && bk.payer_id !== u.id) || bk.status === "awaiting_payment") throw new HttpError(404, "not_found");
      const against = u.id === bk.teacher_id ? bk.payer_id : bk.teacher_id;
      const recent = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM reports WHERE reporter_id = $1 AND created_at > $2", [u.id, new Date(now.getTime() - DAY)]);
      if ((recent.rows[0]?.n ?? 0) >= MAX_REPORTS_PER_DAY) throw new HttpError(429, "too_many_reports");
      const open = await tx.query("SELECT 1 FROM reports WHERE reporter_id = $1 AND booking_id = $2 AND status IN ('open','reviewing')", [u.id, b.bookingId]);
      if (open.rowCount) throw new HttpError(409, "report_exists");
      const r = await tx.query<{ id: string }>(
        "INSERT INTO reports (reporter_id, booking_id, reported_user_id, reason, category, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [u.id, b.bookingId, against, b.reason, b.category, now],
      );
      await audit(tx, { actorId: u.id, action: "report.filed", targetType: "report", targetId: r.rows[0]!.id, detail: { bookingId: b.bookingId, category: b.category } });
      return r.rows[0]!.id;
    });
    reply.code(201);
    return { id };
  });

  // Reporters see the status only, never what the other party or staff said.
  app.get("/reports/mine", { preHandler: participant }, async (req) => {
    const u = me(req);
    const r = await db.query<{ id: string; booking_id: string; category: string; status: string; created_at: Date }>(
      "SELECT id, booking_id, category, status, created_at FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 50",
      [u.id],
    );
    return { items: r.rows.map((x) => ({ id: x.id, bookingId: x.booking_id, category: x.category, status: x.status, createdAt: x.created_at })) };
  });

  app.post("/bookings/:id/dispute", { preHandler: payer }, async (req, reply) => {
    const u = me(req);
    const { reason } = parse(z.object({ reason: z.string().trim().min(10).max(1000) }).strict(), req.body);
    const id = await openDispute({ db, payments: ctx.payments, now: ctx.now }, u.id, idOf(req), reason);
    reply.code(201);
    return { id, status: "open" };
  });

  app.get("/bookings/:id/dispute", { preHandler: participant }, async (req) => {
    const u = me(req);
    const r = await db.query<{ outcome: string | null; refund_halalas: number; created_at: Date; decided_at: Date | null }>(
      `SELECT d.outcome, d.refund_halalas, d.created_at, d.decided_at FROM disputes d JOIN bookings b ON b.id = d.booking_id
        WHERE d.booking_id = $1 AND (b.payer_id = $2 OR b.teacher_id = $2)`,
      [idOf(req), u.id],
    );
    const x = r.rows[0];
    if (!x) throw new HttpError(404, "not_found");
    return { status: x.outcome ? "decided" : "open", outcome: x.outcome, refundHalalas: x.refund_halalas, openedAt: x.created_at, decidedAt: x.decided_at };
  });

  app.post("/bookings/:id/review", { preHandler: payer }, async (req, reply) => {
    const u = me(req);
    const b = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(1).max(500).optional() }).strict(), req.body);
    if (b.comment) {
      // The same rules as chat: a review is not a way to hand out a phone number.
      const v = filterMessage(b.comment);
      if (v.blocked) throw new HttpError(422, "comment_blocked", { reasons: v.reasons });
    }
    const now = ctx.now();
    const id = idOf(req);
    try {
      await db.tx(async (tx) => {
        const bk = (await tx.query<{ payer_id: string; status: string; starts_at: Date; duration_min: number }>("SELECT payer_id, status, starts_at, duration_min FROM bookings WHERE id = $1 FOR UPDATE", [id])).rows[0];
        if (!bk || bk.payer_id !== u.id) throw new HttpError(404, "not_found");
        if (bk.status !== "completed") throw new HttpError(409, "not_reviewable");
        if (now.getTime() > bk.starts_at.getTime() + REVIEW_WINDOW_DAYS * DAY) throw new HttpError(409, "review_window_closed");
        await tx.query("INSERT INTO reviews (booking_id, rating, comment, created_at) VALUES ($1,$2,$3,$4)", [id, b.rating, b.comment ?? null, now]);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, "already_reviewed");
      throw e;
    }
    reply.code(201);
    return { ok: true };
  });

  // Anyone can see their own record, including while suspended or banned. The appeal state is part of it.
  app.get("/account/strikes", { preHandler: guard(ctx, { roles: ["learner", "guardian", "teacher"], anyStatus: true, allowBanned: true }) }, async (req) => {
    const u = me(req);
    const now = ctx.now();
    const s = await db.query<{ id: string; level: number; action: string; reason: string; created_at: Date; voided_at: Date | null; appeal_status: string | null }>(
      `SELECT s.id, s.level, s.action, s.reason, s.created_at, s.voided_at, a.status AS appeal_status
         FROM strikes s LEFT JOIN appeals a ON a.strike_id = s.id WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
      [u.id],
    );
    const st = (await db.query<{ status: string; suspended_until: Date | null }>("SELECT status, suspended_until FROM users WHERE id = $1", [u.id])).rows[0]!;
    return {
      status: st.status,
      suspendedUntil: st.suspended_until,
      strikes: s.rows.map((x) => ({
        id: x.id,
        level: x.level,
        action: x.action,
        reason: x.reason,
        createdAt: x.created_at,
        voided: Boolean(x.voided_at),
        appealStatus: x.appeal_status,
        canAppeal: !x.voided_at && !x.appeal_status && now.getTime() <= x.created_at.getTime() + APPEAL_WINDOW_DAYS * 86_400_000,
      })),
    };
  });

  app.post("/appeals", { preHandler: guard(ctx, { roles: ["learner", "guardian", "teacher"], anyStatus: true, allowBanned: true }) }, async (req, reply) => {
    const u = me(req);
    const b = parse(z.object({ strikeId: z.uuid(), reason: z.string().trim().min(20).max(2000) }).strict(), req.body);
    const id = await fileAppeal(db, ctx.now(), u.id, b.strikeId, b.reason);
    reply.code(201);
    return { id };
  });

  app.get("/teacher/earnings", { preHandler: guard(ctx, { roles: ["teacher"], anyStatus: true }) }, async (req) => {
    const u = me(req);
    const now = ctx.now();
    const sums = (
      await db.query<{ held: string; available: string; in_payout: string }>(
        `SELECT
           COALESCE(sum(CASE WHEN p.payout_id IS NULL AND p.payout_eligible_at >  $2 THEN p.captured_halalas - p.refunded_halalas - p.commission_halalas END),0) AS held,
           COALESCE(sum(CASE WHEN p.payout_id IS NULL AND p.payout_eligible_at <= $2 THEN p.captured_halalas - p.refunded_halalas - p.commission_halalas END),0) AS available,
           COALESCE(sum(CASE WHEN o.status IN ('pending','approved','on_hold') THEN p.captured_halalas - p.refunded_halalas - p.commission_halalas END),0) AS in_payout
         FROM payments p JOIN bookings b ON b.id = p.booking_id LEFT JOIN payouts o ON o.id = p.payout_id
        WHERE b.teacher_id = $1 AND p.status IN ('captured','partially_refunded')`,
        [u.id, now],
      )
    ).rows[0]!;
    const paid = (await db.query<{ s: string }>("SELECT COALESCE(sum(amount_halalas),0) AS s FROM payouts WHERE teacher_id = $1 AND status = 'paid'", [u.id])).rows[0]!.s;
    const payouts = await db.query<{ id: string; amount_halalas: number; status: string; created_at: Date; paid_at: Date | null; bank_reference: string | null }>(
      "SELECT id, amount_halalas, status, created_at, paid_at, bank_reference FROM payouts WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT 20",
      [u.id],
    );
    const frozen = (await db.query<{ payouts_frozen: boolean }>("SELECT payouts_frozen FROM teacher_profiles WHERE user_id = $1", [u.id])).rows[0]?.payouts_frozen ?? false;
    return {
      currency: "SAR",
      heldInDisputeWindowHalalas: Number(sums.held),
      availableForNextRunHalalas: Number(sums.available),
      inPayoutHalalas: Number(sums.in_payout),
      paidHalalas: Number(paid),
      payoutsFrozen: frozen,
      payouts: payouts.rows.map((o) => ({ id: o.id, amountHalalas: o.amount_halalas, status: o.status, createdAt: o.created_at, paidAt: o.paid_at, bankReference: o.bank_reference })),
    };
  });
};
