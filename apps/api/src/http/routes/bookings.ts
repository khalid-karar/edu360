import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Db } from "../../db/db.js";
import {
  acceptBooking,
  attachAuthorizedPayment,
  cancelBooking,
  completeBooking,
  createBooking,
  declineBooking,
  reportNoShow,
} from "../../services/bookings.js";
import { listMessages, postMessage } from "../../services/chat.js";
import { claimGuarantee, guaranteeStatus } from "../../services/guarantee.js";
import type { Ctx } from "../context.js";
import { HttpError, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";

const NewBooking = z
  .object({
    teacherId: z.uuid(),
    categoryId: z.number().int().positive(),
    startsAt: z.iso.datetime({ offset: true }),
    learnerId: z.uuid().optional(),
  })
  .strict();
const STATUSES = ["awaiting_payment", "requested", "confirmed", "declined", "cancelled", "completed", "no_show_teacher", "no_show_learner"] as const;

interface ViewRow {
  id: string;
  status: string;
  starts_at: Date;
  duration_min: number;
  price_halalas: number;
  expires_at: Date | null;
  cancelled_by: string | null;
  teacher_id: string;
  teacher_name: string;
  payer_id: string;
  learner_id: string;
  learner_name: string;
  learner_role: string;
  category_id: number;
  category_name: string;
  pay_status: string | null;
  captured_halalas: number | null;
  commission_halalas: number | null;
  refunded_halalas: number | null;
  platform_credit_halalas: number | null;
}

const SELECT = `
  SELECT b.id, b.status, b.starts_at, b.duration_min, b.price_halalas, b.expires_at, b.cancelled_by,
         b.teacher_id, tu.display_name AS teacher_name, b.payer_id,
         b.learner_id, lu.display_name AS learner_name, lu.role AS learner_role,
         b.category_id, c.name_ar AS category_name,
         p.status AS pay_status, p.captured_halalas, p.commission_halalas, p.refunded_halalas, p.platform_credit_halalas
    FROM bookings b
    JOIN users tu ON tu.id = b.teacher_id
    JOIN users lu ON lu.id = b.learner_id
    JOIN categories c ON c.id = b.category_id
    LEFT JOIN payments p ON p.booking_id = b.id`;

/** What each side may see. The learner never sees the commission; nobody sees the other side's contact details. */
function view(r: ViewRow, viewerId: string) {
  const asTeacher = r.teacher_id === viewerId;
  return {
    id: r.id,
    status: r.status,
    viewerRole: asTeacher ? "teacher" : "payer",
    startsAt: r.starts_at,
    durationMin: r.duration_min,
    priceHalalas: r.price_halalas,
    expiresAt: r.expires_at,
    cancelledBy: r.cancelled_by,
    teacher: { id: r.teacher_id, displayName: r.teacher_name },
    learner: { id: r.learner_id, displayName: r.learner_name, isChild: r.learner_role === "minor" },
    category: { id: r.category_id, nameAr: r.category_name },
    payment: r.pay_status
      ? {
          status: r.pay_status,
          capturedHalalas: r.captured_halalas ?? 0,
          refundedHalalas: r.refunded_halalas ?? 0,
          ...(asTeacher ? { commissionHalalas: r.commission_halalas ?? 0, platformCreditHalalas: r.platform_credit_halalas ?? 0, netHalalas: (r.captured_halalas ?? 0) - (r.refunded_halalas ?? 0) - (r.commission_halalas ?? 0) + (r.platform_credit_halalas ?? 0) } : {}),
        }
      : null,
  };
}

async function one(db: Db, id: string, viewerId: string) {
  const r = await db.query<ViewRow>(`${SELECT} WHERE b.id = $1 AND (b.teacher_id = $2 OR b.payer_id = $2)`, [id, viewerId]);
  if (!r.rows[0]) throw new HttpError(404, "not_found");
  return view(r.rows[0], viewerId);
}

export const bookingRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const deps = { db, payments: ctx.payments, now: ctx.now };
  const bookers = guard(ctx, { roles: ["learner", "guardian"] });
  const teacher = guard(ctx, { roles: ["teacher"] });
  const participant = guard(ctx, { roles: ["learner", "guardian", "teacher"] });
  const idOf = (req: { params: unknown }) => uuidParam((req.params as { id?: string }).id);

  app.post("/bookings", { preHandler: bookers }, async (req, reply) => {
    const u = me(req);
    const b = parse(NewBooking, req.body);
    if (b.learnerId && u.role !== "guardian") throw new HttpError(403, "forbidden");
    const booking = await createBooking(deps, u, { teacherId: b.teacherId, categoryId: b.categoryId, startsAt: new Date(b.startsAt), learnerId: b.learnerId });
    reply.code(201);
    // The client now collects the card hold for exactly this amount, tagging the payment with booking_id.
    return { bookingId: booking.id, status: booking.status, amountHalalas: booking.price_halalas, currency: "SAR", payBy: booking.expires_at };
  });

  // The client says "I paid, here is the payment id". We do not take its word: the provider is asked.
  app.post("/bookings/:id/payment", { preHandler: bookers }, async (req) => {
    const u = me(req);
    const id = idOf(req);
    const { paymentId } = parse(z.object({ paymentId: z.string().min(1).max(100) }).strict(), req.body);
    const owns = await db.query("SELECT 1 FROM bookings WHERE id = $1 AND payer_id = $2", [id, u.id]);
    if (!owns.rowCount) throw new HttpError(404, "not_found");
    const r = await attachAuthorizedPayment(deps, id, paymentId);
    if (!r.ok) throw new HttpError(r.reason === "payment_not_found" ? 404 : 402, r.reason);
    return one(db, id, u.id);
  });

  app.get("/bookings", { preHandler: participant }, async (req) => {
    const u = me(req);
    const q = parse(z.object({ status: z.enum(STATUSES).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
    const r = await db.query<ViewRow>(
      `${SELECT} WHERE (b.teacher_id = $1 OR b.payer_id = $1)
          AND ($2::text IS NULL OR b.status::text = $2)
          -- a teacher never sees a booking the learner has not paid for
          AND NOT (b.teacher_id = $1 AND b.status = 'awaiting_payment')
        ORDER BY b.starts_at DESC LIMIT $3`,
      [u.id, q.status ?? null, q.limit],
    );
    return { items: r.rows.map((x) => view(x, u.id)) };
  });

  app.get("/bookings/:id", { preHandler: participant }, async (req) => {
    const u = me(req);
    const b = await one(db, idOf(req), u.id);
    if (b.viewerRole === "teacher" && b.status === "awaiting_payment") throw new HttpError(404, "not_found");
    return b;
  });

  app.post("/bookings/:id/accept", { preHandler: teacher }, async (req) => {
    const u = me(req);
    await acceptBooking(deps, u.id, idOf(req));
    return one(db, idOf(req), u.id);
  });
  app.post("/bookings/:id/decline", { preHandler: teacher }, async (req) => {
    const u = me(req);
    await declineBooking(deps, u.id, idOf(req));
    return one(db, idOf(req), u.id);
  });
  app.post("/bookings/:id/complete", { preHandler: teacher }, async (req) => {
    const u = me(req);
    await completeBooking(deps, u.id, idOf(req));
    return one(db, idOf(req), u.id);
  });
  app.post("/bookings/:id/cancel", { preHandler: participant }, async (req) => {
    const u = me(req);
    await cancelBooking(deps, u, idOf(req));
    return one(db, idOf(req), u.id);
  });
  app.post("/bookings/:id/no-show", { preHandler: participant }, async (req) => {
    const u = me(req);
    const { absent } = parse(z.object({ absent: z.enum(["learner", "teacher"]) }).strict(), req.body);
    await reportNoShow(deps, u, idOf(req), absent);
    return one(db, idOf(req), u.id);
  });

  // Chat is per booking: only its teacher and its payer (the guardian, for a child) are in it.
  app.post("/bookings/:id/messages", { preHandler: [participant] }, async (req, reply) => {
    const u = me(req);
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(1000) }).strict(), req.body);
    const m = await postMessage(db, ctx.now(), u.id, idOf(req), body);
    reply.code(201);
    return m;
  });
  app.get("/bookings/:id/messages", { preHandler: participant }, async (req) => {
    const u = me(req);
    const { after } = parse(z.object({ after: z.iso.datetime({ offset: true }).optional() }), req.query);
    return { items: await listMessages(db, u.id, idOf(req), after ? new Date(after) : undefined) };
  });

  // First-lesson guarantee: see whether it applies, and claim it. The refund is full and immediate.
  app.get("/bookings/:id/guarantee", { preHandler: participant }, async (req) => {
    return guaranteeStatus(db, ctx.now(), me(req).id, idOf(req));
  });
  app.post("/bookings/:id/guarantee", { preHandler: bookers }, async (req) => {
    const u = me(req);
    const { why } = parse(z.object({ why: z.enum(["not_a_good_fit", "teacher_unprepared", "teaching_style", "technical", "other"]) }).strict(), req.body);
    const r = await claimGuarantee({ db, payments: ctx.payments, now: ctx.now }, u.id, idOf(req), why);
    return { ...r, booking: await one(db, idOf(req), u.id) };
  });
};
