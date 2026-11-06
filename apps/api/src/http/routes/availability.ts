import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  MAX_FUTURE_WINDOWS,
  MAX_WINDOW_AHEAD_DAYS,
  MAX_WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
  isAligned,
} from "../../domain/availability.js";
import type { Ctx } from "../context.js";
import { HttpError, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";

const Window = z
  .object({ startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }) })
  .strict();

export const availabilityRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const pre = guard(ctx, { roles: ["teacher"] });

  async function requireLive(userId: string) {
    const r = await db.query<{ status: string }>("SELECT status FROM teacher_profiles WHERE user_id = $1", [userId]);
    const s = r.rows[0]?.status;
    if (s !== "approved" && s !== "conditional") throw new HttpError(409, "not_approved");
  }

  app.get("/teacher/availability", { preHandler: pre }, async (req) => {
    const u = me(req);
    const r = await db.query<{ id: string; starts_at: Date; ends_at: Date }>(
      "SELECT id, starts_at, ends_at FROM availability WHERE teacher_id = $1 AND ends_at > $2 ORDER BY starts_at",
      [u.id, ctx.now()],
    );
    return { items: r.rows.map((w) => ({ id: w.id, startsAt: w.starts_at, endsAt: w.ends_at })) };
  });

  app.post("/teacher/availability", { preHandler: pre }, async (req, reply) => {
    const u = me(req);
    const b = parse(Window, req.body);
    await requireLive(u.id);
    const start = new Date(b.startsAt);
    const end = new Date(b.endsAt);
    const now = ctx.now();
    const minutes = (end.getTime() - start.getTime()) / 60_000;
    if (!isAligned(start) || !isAligned(end)) throw new HttpError(422, "misaligned_window");
    if (minutes < MIN_WINDOW_MINUTES || minutes > MAX_WINDOW_MINUTES) throw new HttpError(422, "bad_window_length", { minMinutes: MIN_WINDOW_MINUTES, maxMinutes: MAX_WINDOW_MINUTES });
    if (start <= now) throw new HttpError(422, "in_past");
    if (start.getTime() > now.getTime() + MAX_WINDOW_AHEAD_DAYS * 86_400_000) throw new HttpError(422, "too_far");

    const id = await db.tx(async (tx) => {
      // Same lock the booking code takes, so a window cannot change under a booking being made.
      await tx.query("SELECT 1 FROM teacher_profiles WHERE user_id = $1 FOR UPDATE", [u.id]);
      const n = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM availability WHERE teacher_id = $1 AND ends_at > $2", [u.id, now]);
      if ((n.rows[0]?.n ?? 0) >= MAX_FUTURE_WINDOWS) throw new HttpError(409, "too_many_windows");
      const clash = await tx.query("SELECT 1 FROM availability WHERE teacher_id = $1 AND starts_at < $3 AND ends_at > $2", [u.id, start, end]);
      if (clash.rowCount) throw new HttpError(409, "window_overlaps");
      const r = await tx.query<{ id: string }>("INSERT INTO availability (teacher_id, starts_at, ends_at) VALUES ($1,$2,$3) RETURNING id", [u.id, start, end]);
      return r.rows[0]!.id;
    });
    reply.code(201);
    return { id };
  });

  app.delete("/teacher/availability/:id", { preHandler: pre }, async (req) => {
    const u = me(req);
    const id = uuidParam((req.params as { id?: string }).id);
    await db.tx(async (tx) => {
      await tx.query("SELECT 1 FROM teacher_profiles WHERE user_id = $1 FOR UPDATE", [u.id]);
      const w = (await tx.query<{ starts_at: Date; ends_at: Date }>("SELECT starts_at, ends_at FROM availability WHERE id = $1 AND teacher_id = $2", [id, u.id])).rows[0];
      if (!w) throw new HttpError(404, "not_found");
      // A window with a live booking inside it cannot be pulled out from under the learner.
      const live = await tx.query(
        `SELECT 1 FROM bookings WHERE teacher_id = $1 AND starts_at < $3 AND starts_at + duration_min * interval '1 minute' > $2
            AND ((status = 'awaiting_payment' AND expires_at > $4) OR status IN ('requested','confirmed'))`,
        [u.id, w.starts_at, w.ends_at, ctx.now()],
      );
      if (live.rowCount) throw new HttpError(409, "window_has_bookings");
      await tx.query("DELETE FROM availability WHERE id = $1", [id]);
    });
    return { ok: true };
  });
};
