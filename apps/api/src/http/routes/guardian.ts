import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { audit } from "../../services/audit.js";
import type { Ctx } from "../context.js";
import { HttpError, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";

const MAX_CHILDREN = 6;
const MIN_CHILD_AGE = 4;
const MAX_CHILD_AGE = 17;

const Child = z
  .object({
    displayName: z.string().trim().min(2).max(40),
    birthYear: z.number().int(),
    gender: z.enum(["female", "male"]),
  })
  .strict();
const Approval = z.object({ teacherId: z.uuid(), allowCrossGender: z.boolean().default(false) }).strict();

interface ChildRow {
  id: string;
  display_name: string;
  birth_year: number;
  gender: string;
}
const childView = (c: ChildRow, year: number) => ({ id: c.id, displayName: c.display_name, birthYear: c.birth_year, age: year - c.birth_year, gender: c.gender });

export const guardianRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const pre = guard(ctx, { roles: ["guardian"] }); // a guardian is Nafath-verified before they can do any of this

  app.post("/guardian/children", { preHandler: pre }, async (req, reply) => {
    const g = me(req);
    const b = parse(Child, req.body);
    const year = ctx.now().getUTCFullYear();
    const age = year - b.birthYear;
    if (age < MIN_CHILD_AGE || age > MAX_CHILD_AGE) throw new HttpError(422, "age_out_of_range", { min: MIN_CHILD_AGE, max: MAX_CHILD_AGE });
    const child = await db.tx(async (tx) => {
      const n = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE guardian_id = $1", [g.id]);
      if ((n.rows[0]?.n ?? 0) >= MAX_CHILDREN) throw new HttpError(409, "too_many_children");
      // No mobile and no login: the child is only ever reached through the guardian.
      const r = await tx.query<ChildRow>(
        `INSERT INTO users (role, status, display_name, guardian_id, birth_year, gender, created_at)
         VALUES ('minor','active',$1,$2,$3,$4,$5) RETURNING id, display_name, birth_year, gender`,
        [b.displayName, g.id, b.birthYear, b.gender, ctx.now()],
      );
      await audit(tx, { actorId: g.id, action: "guardian.child_added", targetType: "user", targetId: r.rows[0]!.id });
      return r.rows[0]!;
    });
    reply.code(201);
    return childView(child, year);
  });

  app.get("/guardian/children", { preHandler: pre }, async (req) => {
    const g = me(req);
    const r = await db.query<ChildRow>("SELECT id, display_name, birth_year, gender FROM users WHERE guardian_id = $1 ORDER BY created_at", [g.id]);
    const year = ctx.now().getUTCFullYear();
    return { items: r.rows.map((c) => childView(c, year)) };
  });

  // The guardian's explicit consent to a teacher for all their children. Needed before any child booking or chat.
  app.post("/guardian/approvals", { preHandler: pre }, async (req) => {
    const g = me(req);
    const b = parse(Approval, req.body);
    const t = (
      await db.query<{ status: string; adults_only: boolean }>(
        `SELECT t.status, t.adults_only FROM teacher_profiles t JOIN users u ON u.id = t.user_id
          WHERE t.user_id = $1 AND u.status = 'active'`,
        [b.teacherId],
      )
    ).rows[0];
    if (!t || t.status !== "approved") throw new HttpError(422, "teacher_unavailable");
    if (t.adults_only) throw new HttpError(422, "adults_only_teacher");
    await db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO guardian_teacher_approvals (guardian_id, teacher_id, approved_at, cross_gender_ok) VALUES ($1,$2,$3,$4)
         ON CONFLICT (guardian_id, teacher_id) DO UPDATE SET cross_gender_ok = EXCLUDED.cross_gender_ok`,
        [g.id, b.teacherId, ctx.now(), b.allowCrossGender],
      );
      await audit(tx, { actorId: g.id, action: "guardian.teacher_approved", targetType: "user", targetId: b.teacherId, detail: { crossGender: b.allowCrossGender } });
    });
    return { ok: true };
  });

  app.get("/guardian/approvals", { preHandler: pre }, async (req) => {
    const g = me(req);
    const r = await db.query<{ teacher_id: string; display_name: string; cross_gender_ok: boolean; approved_at: Date }>(
      `SELECT a.teacher_id, u.display_name, a.cross_gender_ok, a.approved_at FROM guardian_teacher_approvals a
         JOIN users u ON u.id = a.teacher_id WHERE a.guardian_id = $1 ORDER BY a.approved_at DESC`,
      [g.id],
    );
    return { items: r.rows.map((x) => ({ teacherId: x.teacher_id, displayName: x.display_name, allowCrossGender: x.cross_gender_ok, approvedAt: x.approved_at })) };
  });

  // Withdrawing consent closes the chat at once and blocks new bookings with that teacher.
  app.delete("/guardian/approvals/:teacherId", { preHandler: pre }, async (req) => {
    const g = me(req);
    const teacherId = uuidParam((req.params as { teacherId?: string }).teacherId);
    const removed = await db.tx(async (tx) => {
      const r = await tx.query("DELETE FROM guardian_teacher_approvals WHERE guardian_id = $1 AND teacher_id = $2", [g.id, teacherId]);
      if (r.rowCount) await audit(tx, { actorId: g.id, action: "guardian.teacher_approval_withdrawn", targetType: "user", targetId: teacherId });
      return r.rowCount;
    });
    if (!removed) throw new HttpError(404, "not_found");
    return { ok: true };
  });
};
