import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { audit } from "../../services/audit.js";
import { notify } from "../../services/notifications.js";
import { decideAppeal } from "../../services/appeals.js";
import { issueStrike } from "../../services/trust.js";
import type { Ctx } from "../context.js";
import { HttpError, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";

const LIMIT = 50;

/** Safety officers only. Reading a conversation is itself written to the audit log. */
export const safetyRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const pre = guard(ctx, { roles: ["safety_officer"] });
  const idOf = (req: { params: unknown }) => uuidParam((req.params as { id?: string }).id);

  app.get("/admin/safety/queue", { preHandler: pre }, async () => {
    const reports = await db.query<{ id: string; category: string; status: string; assigned_to: string | null; created_at: Date; reported_user_id: string | null; reported_name: string | null }>(
      `SELECT r.id, r.category, r.status, r.assigned_to, r.created_at, r.reported_user_id, u.display_name AS reported_name
         FROM reports r LEFT JOIN users u ON u.id = r.reported_user_id
        WHERE r.status IN ('open','reviewing')
        ORDER BY (r.category = 'safety') DESC, r.created_at LIMIT ${LIMIT}`,
    );
    const flags = await db.query<{ id: string; category: string; severity: number; source: string; created_at: Date }>(
      `SELECT id, category, severity, source, created_at FROM flags WHERE status = 'open' ORDER BY severity DESC, created_at LIMIT ${LIMIT}`,
    );
    return {
      reports: reports.rows.map((r) => ({ id: r.id, category: r.category, status: r.status, assignedTo: r.assigned_to, createdAt: r.created_at, reportedUser: r.reported_user_id ? { id: r.reported_user_id, displayName: r.reported_name } : null })),
      flags: flags.rows.map((f) => ({ id: f.id, category: f.category, severity: f.severity, source: f.source, createdAt: f.created_at })),
    };
  });

  app.get("/admin/safety/reports/:id", { preHandler: pre }, async (req) => {
    const s = me(req);
    const id = idOf(req);
    const r = (
      await db.query<{ id: string; reporter_id: string; booking_id: string | null; reported_user_id: string | null; reason: string; category: string; status: string; assigned_to: string | null; created_at: Date; reporter_name: string }>(
        "SELECT r.*, u.display_name AS reporter_name FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.id = $1",
        [id],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, "not_found");
    const messages = r.booking_id
      ? await db.query<{ id: string; sender_id: string; body: string; blocked: boolean; block_reason: string | null; created_at: Date }>(
          "SELECT id, sender_id, body, blocked, block_reason, created_at FROM messages WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 50",
          [r.booking_id],
        )
      : { rows: [] };
    const strikes = r.reported_user_id ? await db.query<{ level: number; action: string; created_at: Date }>("SELECT level, action, created_at FROM strikes WHERE user_id = $1 ORDER BY created_at DESC", [r.reported_user_id]) : { rows: [] };
    await audit(db, { actorId: s.id, action: "safety.viewed_report", targetType: "report", targetId: id, detail: { messagesShown: messages.rows.length } });
    return {
      id: r.id,
      category: r.category,
      reason: r.reason,
      status: r.status,
      assignedTo: r.assigned_to,
      createdAt: r.created_at,
      reporter: { id: r.reporter_id, displayName: r.reporter_name },
      reportedUserId: r.reported_user_id,
      bookingId: r.booking_id,
      messages: messages.rows.reverse().map((m) => ({ id: m.id, senderId: m.sender_id, body: m.body, blocked: m.blocked, blockReason: m.block_reason, createdAt: m.created_at })),
      priorStrikes: strikes.rows.map((x) => ({ level: x.level, action: x.action, createdAt: x.created_at })),
    };
  });

  app.post("/admin/safety/reports/:id/claim", { preHandler: pre }, async (req) => {
    const s = me(req);
    const id = idOf(req);
    await db.tx(async (tx) => {
      const r = await tx.query("UPDATE reports SET status='reviewing', assigned_to=$2 WHERE id=$1 AND status='open' RETURNING id", [id, s.id]);
      if (!r.rowCount) throw new HttpError((await tx.query("SELECT 1 FROM reports WHERE id=$1", [id])).rowCount ? 409 : 404, "invalid_state");
      await audit(tx, { actorId: s.id, action: "safety.report_claimed", targetType: "report", targetId: id });
    });
    return { ok: true };
  });

  app.post("/admin/safety/reports/:id/resolve", { preHandler: pre }, async (req) => {
    const s = me(req);
    const id = idOf(req);
    const b = parse(z.object({ outcome: z.enum(["resolved", "dismissed"]), note: z.string().trim().min(10).max(1000) }).strict(), req.body);
    await db.tx(async (tx) => {
      const r = (await tx.query<{ status: string; assigned_to: string | null; reporter_id: string }>("SELECT status, assigned_to, reporter_id FROM reports WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!r) throw new HttpError(404, "not_found");
      if (r.status !== "reviewing") throw new HttpError(409, "invalid_state", { status: r.status });
      if (r.assigned_to !== s.id) throw new HttpError(403, "not_assigned_to_you");
      await tx.query("UPDATE reports SET status=$2, resolution_note=$3, resolved_at=$4 WHERE id=$1", [id, b.outcome, b.note, ctx.now()]);
      await notify(tx, { userId: r.reporter_id, kind: "report_update", vars: { decision: b.outcome === "resolved" ? "راجعنا بلاغك واتُّخذ إجراء مناسب" : "راجعنا بلاغك ولم نجد ما يستدعي إجراءً" }, link: "/portal/account" }, ctx.now());
      await audit(tx, { actorId: s.id, action: "safety.report_resolved", targetType: "report", targetId: id, reason: b.note, detail: { outcome: b.outcome } });
    });
    return { ok: true };
  });

  app.get("/admin/safety/flags/:id", { preHandler: pre }, async (req) => {
    const s = me(req);
    const id = idOf(req);
    const f = (await db.query<{ id: string; category: string; severity: number; source: string; status: string; target_type: string; target_id: string; created_at: Date }>("SELECT * FROM flags WHERE id = $1", [id])).rows[0];
    if (!f) throw new HttpError(404, "not_found");
    const m =
      f.target_type === "message"
        ? (
            await db.query<{ id: string; booking_id: string; sender_id: string; body: string; blocked: boolean; block_reason: string | null; created_at: Date; sender_role: string; learner_is_minor: boolean; inquiry_id: string | null }>(
              `SELECT m.id, m.booking_id, m.inquiry_id, m.sender_id, m.body, m.blocked, m.block_reason, m.created_at, su.role AS sender_role, COALESCE(lu.role = 'minor', false) AS learner_is_minor
                 FROM messages m JOIN users su ON su.id = m.sender_id LEFT JOIN bookings b ON b.id = m.booking_id LEFT JOIN users lu ON lu.id = b.learner_id
                WHERE m.id = $1`,
              [f.target_id],
            )
          ).rows[0]
        : undefined;
    await audit(db, { actorId: s.id, action: "safety.viewed_flag", targetType: "flag", targetId: id });
    return {
      id: f.id,
      category: f.category,
      severity: f.severity,
      source: f.source,
      status: f.status,
      createdAt: f.created_at,
      message: m ? { id: m.id, bookingId: m.booking_id, inquiryId: m.inquiry_id, senderId: m.sender_id, senderRole: m.sender_role, toChild: m.learner_is_minor, body: m.body, blocked: m.blocked, blockReason: m.block_reason, createdAt: m.created_at } : null,
    };
  });

  app.post("/admin/safety/flags/:id/review", { preHandler: pre }, async (req) => {
    const s = me(req);
    const id = idOf(req);
    const b = parse(z.object({ outcome: z.enum(["confirmed", "dismissed"]), note: z.string().trim().min(5).max(1000) }).strict(), req.body);
    await db.tx(async (tx) => {
      const r = await tx.query("UPDATE flags SET status=$2, reviewed_by=$3, reviewed_at=$4, note=$5 WHERE id=$1 AND status='open' RETURNING id", [id, b.outcome, s.id, ctx.now(), b.note]);
      if (!r.rowCount) throw new HttpError((await tx.query("SELECT 1 FROM flags WHERE id=$1", [id])).rowCount ? 409 : 404, "invalid_state");
      await audit(tx, { actorId: s.id, action: "safety.flag_reviewed", targetType: "flag", targetId: id, reason: b.note, detail: { outcome: b.outcome } });
    });
    return { ok: true };
  });

  app.post("/admin/safety/users/:id/strike", { preHandler: pre }, async (req) => {
    const s = me(req);
    const b = parse(z.object({ reason: z.string().trim().min(10).max(1000), zeroTolerance: z.boolean().default(false), reportId: z.uuid().optional() }).strict(), req.body);
    const r = await issueStrike({ db, payments: ctx.payments, now: ctx.now }, s.id, { userId: idOf(req), ...b });
    return r;
  });

  app.get("/admin/safety/users/:id/strikes", { preHandler: pre }, async (req) => {
    const id = idOf(req);
    const u = (await db.query<{ display_name: string; role: string; status: string; suspended_until: Date | null }>("SELECT display_name, role, status, suspended_until FROM users WHERE id = $1", [id])).rows[0];
    if (!u) throw new HttpError(404, "not_found");
    const s = await db.query<{ id: string; level: number; action: string; zero_tolerance: boolean; reason: string; created_at: Date }>("SELECT id, level, action, zero_tolerance, reason, created_at FROM strikes WHERE user_id = $1 ORDER BY created_at DESC", [id]);
    return { user: { id, displayName: u.display_name, role: u.role, status: u.status, suspendedUntil: u.suspended_until }, strikes: s.rows.map((x) => ({ id: x.id, level: x.level, action: x.action, zeroTolerance: x.zero_tolerance, reason: x.reason, createdAt: x.created_at })) };
  });

  // Appeals against strikes. The officer who issued the strike cannot decide it.
  app.get("/admin/safety/appeals", { preHandler: pre }, async (req) => {
    const { status } = parse(z.object({ status: z.enum(["open", "upheld", "reversed"]).default("open") }), req.query);
    const r = await db.query<{ id: string; status: string; created_at: Date; display_name: string; role: string; action: string; level: number }>(
      `SELECT a.id, a.status, a.created_at, u.display_name, u.role, s.action, s.level
         FROM appeals a JOIN users u ON u.id = a.user_id JOIN strikes s ON s.id = a.strike_id
        WHERE a.status = $1 ORDER BY a.created_at LIMIT ${LIMIT}`,
      [status],
    );
    return { items: r.rows.map((a) => ({ id: a.id, status: a.status, createdAt: a.created_at, user: { displayName: a.display_name, role: a.role }, strike: { action: a.action, level: a.level } })) };
  });

  app.get("/admin/safety/appeals/:id", { preHandler: pre }, async (req) => {
    const s = me(req);
    const id = idOf(req);
    const a = (
      await db.query<{ id: string; status: string; reason: string; decision_note: string | null; created_at: Date; user_id: string; display_name: string; role: string; user_status: string; strike_id: string; action: string; level: number; strike_reason: string; zero_tolerance: boolean; issued_by: string | null; strike_at: Date; report_id: string | null }>(
        `SELECT a.id, a.status, a.reason, a.decision_note, a.created_at, a.user_id, u.display_name, u.role, u.status AS user_status,
                s.id AS strike_id, s.action, s.level, s.reason AS strike_reason, s.zero_tolerance, s.issued_by, s.created_at AS strike_at, s.report_id
           FROM appeals a JOIN users u ON u.id = a.user_id JOIN strikes s ON s.id = a.strike_id WHERE a.id = $1`,
        [id],
      )
    ).rows[0];
    if (!a) throw new HttpError(404, "not_found");
    const history = await db.query<{ level: number; action: string; created_at: Date; voided_at: Date | null }>("SELECT level, action, created_at, voided_at FROM strikes WHERE user_id = $1 ORDER BY created_at DESC", [a.user_id]);
    await audit(db, { actorId: s.id, action: "safety.viewed_appeal", targetType: "appeal", targetId: id });
    return {
      id: a.id,
      status: a.status,
      reason: a.reason,
      decisionNote: a.decision_note,
      createdAt: a.created_at,
      user: { id: a.user_id, displayName: a.display_name, role: a.role, status: a.user_status },
      strike: { id: a.strike_id, action: a.action, level: a.level, reason: a.strike_reason, zeroTolerance: a.zero_tolerance, issuedAt: a.strike_at, reportId: a.report_id, issuedByMe: a.issued_by === s.id },
      history: history.rows.map((x) => ({ level: x.level, action: x.action, createdAt: x.created_at, voided: Boolean(x.voided_at) })),
    };
  });

  app.post("/admin/safety/appeals/:id/decide", { preHandler: pre }, async (req) => {
    const s = me(req);
    const b = parse(z.object({ outcome: z.enum(["upheld", "reversed"]), note: z.string().trim().min(10).max(1000) }).strict(), req.body);
    return decideAppeal({ db, now: ctx.now }, s.id, idOf(req), b.outcome, b.note);
  });
};
