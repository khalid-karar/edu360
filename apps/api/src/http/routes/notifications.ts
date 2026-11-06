import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Ctx } from "../context.js";
import { parse } from "../errors.js";
import { guard, me } from "../guard.js";

/** Your own notifications only. Suspended users can still read them: that is where the reason is explained. */
export const notificationRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const pre = guard(ctx, { roles: ["learner", "guardian", "teacher", "vetting_officer", "safety_officer", "finance_officer", "super_admin"], allowPending: true, anyStatus: true, allowBanned: true });

  app.get("/notifications", { preHandler: pre }, async (req) => {
    const u = me(req);
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), unread: z.coerce.boolean().optional() }), req.query);
    const r = await db.query<{ id: string; kind: string; title: string; body: string; link: string | null; read_at: Date | null; created_at: Date }>(
      `SELECT id, kind, title, body, link, read_at, created_at FROM notifications
        WHERE user_id = $1 AND (NOT $2::boolean OR read_at IS NULL) ORDER BY created_at DESC LIMIT $3`,
      [u.id, q.unread ?? false, q.limit],
    );
    const unread = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [u.id]);
    return {
      unread: unread.rows[0]?.n ?? 0,
      items: r.rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read: Boolean(n.read_at), createdAt: n.created_at })),
    };
  });

  app.get("/notifications/unread-count", { preHandler: pre }, async (req) => {
    const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [me(req).id]);
    return { unread: r.rows[0]?.n ?? 0 };
  });

  app.post("/notifications/read", { preHandler: pre }, async (req) => {
    const u = me(req);
    const b = parse(z.object({ ids: z.array(z.uuid()).max(100).optional() }).strict(), req.body ?? {});
    const r = await db.query(
      `UPDATE notifications SET read_at = $3 WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
      [u.id, b.ids ?? null, ctx.now()],
    );
    return { marked: r.rowCount };
  });
};
