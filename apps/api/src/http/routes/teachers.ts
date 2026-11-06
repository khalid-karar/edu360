import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Db } from "../../db/db.js";
import { openSlots, type Span } from "../../domain/availability.js";
import { MAX_BOOKING_HORIZON_DAYS } from "../../domain/booking.js";
import type { Ctx } from "../context.js";
import { HttpError, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";

const LANGS = ["ar", "en", "ur", "hi", "fr", "tl", "other"] as const;
const Search = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  language: z.enum(LANGS).optional(),
  gender: z.enum(["female", "male"]).optional(),
  maxPriceHalalas: z.coerce.number().int().positive().optional(),
  /** Searching on behalf of one of your children: hides adults-only teachers and categories closed to minors. */
  childId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

interface TeacherRow {
  user_id: string;
  display_name: string;
  gender: string | null;
  languages: string[];
  bio: string | null;
  completed_sessions: number;
  reliability_score: string;
  adults_only: boolean;
}

interface Child {
  gender: string | null;
}

async function childOf(db: Db, guardianId: string, childId: string): Promise<Child> {
  const r = await db.query<Child>("SELECT gender FROM users WHERE id = $1 AND guardian_id = $2 AND role = 'minor'", [childId, guardianId]);
  if (!r.rows[0]) throw new HttpError(403, "not_your_child");
  return r.rows[0];
}

/** Details for a page of teachers, in the order given. Never includes contact, identity or payout data. */
async function describe(ctx: Ctx, ids: string[], opts: { full: boolean; guardianId?: string; child?: Child }) {
  if (!ids.length) return [];
  const { db } = ctx;
  const now = ctx.now();
  const horizon = new Date(now.getTime() + (MAX_BOOKING_HORIZON_DAYS + 1) * 86_400_000);

  const teachers = await db.query<TeacherRow>(
    `SELECT t.user_id, u.display_name, i.gender, t.languages, t.bio, t.completed_sessions, t.reliability_score, t.adults_only
       FROM teacher_profiles t JOIN users u ON u.id = t.user_id
       LEFT JOIN identity_verifications i ON i.user_id = t.user_id
      WHERE t.user_id = ANY($1::uuid[])`,
    [ids],
  );
  const cats = await db.query<{ teacher_id: string; category_id: number; name_ar: string; price_halalas: number; allows_minors: boolean }>(
    `SELECT tc.teacher_id, tc.category_id, c.name_ar, tc.price_halalas, c.allows_minors
       FROM teacher_categories tc JOIN categories c ON c.id = tc.category_id
      WHERE tc.teacher_id = ANY($1::uuid[]) AND tc.approved AND c.active ORDER BY c.id`,
    [ids],
  );
  const wins = await db.query<{ teacher_id: string; starts_at: Date; ends_at: Date }>(
    "SELECT teacher_id, starts_at, ends_at FROM availability WHERE teacher_id = ANY($1::uuid[]) AND ends_at > $2 AND starts_at < $3",
    [ids, now, horizon],
  );
  const busy = await db.query<{ teacher_id: string; starts_at: Date; duration_min: number }>(
    `SELECT teacher_id, starts_at, duration_min FROM bookings
      WHERE teacher_id = ANY($1::uuid[]) AND starts_at < $3 AND starts_at + duration_min * interval '1 minute' > $2
        AND ((status = 'awaiting_payment' AND expires_at > $2) OR status IN ('requested','confirmed'))`,
    [ids, now, horizon],
  );
  const approvals = opts.guardianId
    ? await db.query<{ teacher_id: string; cross_gender_ok: boolean }>(
        "SELECT teacher_id, cross_gender_ok FROM guardian_teacher_approvals WHERE guardian_id = $1 AND teacher_id = ANY($2::uuid[])",
        [opts.guardianId, ids],
      )
    : { rows: [] as { teacher_id: string; cross_gender_ok: boolean }[] };

  const byId = new Map(teachers.rows.map((t) => [t.user_id, t]));
  return ids.flatMap((id) => {
    const t = byId.get(id);
    if (!t) return [];
    const winSpans: Span[] = wins.rows.filter((w) => w.teacher_id === id).map((w) => ({ start: w.starts_at, end: w.ends_at }));
    const busySpans: Span[] = busy.rows
      .filter((b) => b.teacher_id === id)
      .map((b) => ({ start: b.starts_at, end: new Date(b.starts_at.getTime() + b.duration_min * 60_000) }));
    const next = openSlots(winSpans, busySpans, now, 1)[0];
    const approval = approvals.rows.find((a) => a.teacher_id === id);
    return [
      {
        teacherId: id,
        displayName: t.display_name,
        gender: t.gender,
        languages: t.languages,
        ...(opts.full ? { bio: t.bio } : { bioPreview: t.bio?.slice(0, 160) ?? null }),
        completedSessions: t.completed_sessions,
        reliability: Math.round(Number(t.reliability_score) * 100) / 100,
        adultsOnly: t.adults_only,
        categories: cats.rows
          .filter((c) => c.teacher_id === id && (!opts.child || c.allows_minors))
          .map((c) => ({ categoryId: c.category_id, nameAr: c.name_ar, priceHalalas: c.price_halalas })),
        nextSlotAt: next ?? null,
        ...(opts.child
          ? {
              forChild: {
                sameGender: t.gender === opts.child.gender,
                approved: Boolean(approval),
                crossGenderApproved: approval?.cross_gender_ok ?? false,
              },
            }
          : {}),
      },
    ];
  });
}

const LIVE = `t.status IN ('approved','conditional') AND u.status = 'active'`;

export const teacherDirectoryRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  // Signed-in learners and guardians only: the directory is not open to scraping.
  const pre = guard(ctx, { roles: ["learner", "guardian"] });

  app.get("/teachers", { preHandler: pre }, async (req) => {
    const u = me(req);
    const q = parse(Search, req.query);
    if (q.childId && u.role !== "guardian") throw new HttpError(403, "forbidden");
    const child = q.childId ? await childOf(db, u.id, q.childId) : undefined;

    const found = await db.query<{ user_id: string }>(
      `SELECT t.user_id FROM teacher_profiles t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN identity_verifications i ON i.user_id = t.user_id
        WHERE ${LIVE}
          AND EXISTS (SELECT 1 FROM teacher_categories tc JOIN categories c ON c.id = tc.category_id AND c.active
                       WHERE tc.teacher_id = t.user_id AND tc.approved
                         AND ($1::int IS NULL OR tc.category_id = $1)
                         AND ($4::int IS NULL OR tc.price_halalas <= $4)
                         AND (NOT $5::boolean OR c.allows_minors))
          AND ($2::text IS NULL OR $2 = ANY(t.languages))
          AND ($3::text IS NULL OR i.gender = $3)
          AND (NOT $5::boolean OR NOT t.adults_only)
        ORDER BY t.completed_sessions DESC, t.reliability_score DESC, t.user_id
        LIMIT $6 OFFSET $7`,
      [q.categoryId ?? null, q.language ?? null, q.gender ?? null, q.maxPriceHalalas ?? null, Boolean(child), q.limit, q.offset],
    );
    const items = await describe(ctx, found.rows.map((r) => r.user_id), { full: false, ...(child ? { child, guardianId: u.id } : {}) });
    return { items, nextOffset: found.rows.length === q.limit ? q.offset + q.limit : null };
  });

  async function liveTeacher(id: string) {
    const r = await db.query(`SELECT 1 FROM teacher_profiles t JOIN users u ON u.id = t.user_id WHERE t.user_id = $1 AND ${LIVE}`, [id]);
    if (!r.rowCount) throw new HttpError(404, "not_found");
  }

  app.get("/teachers/:id", { preHandler: pre }, async (req) => {
    const u = me(req);
    const id = uuidParam((req.params as { id?: string }).id);
    const { childId } = parse(z.object({ childId: z.uuid().optional() }), req.query);
    if (childId && u.role !== "guardian") throw new HttpError(403, "forbidden");
    await liveTeacher(id);
    const child = childId ? await childOf(db, u.id, childId) : undefined;
    const [t] = await describe(ctx, [id], { full: true, ...(child ? { child, guardianId: u.id } : {}) });
    return t;
  });

  app.get("/teachers/:id/slots", { preHandler: pre }, async (req) => {
    const id = uuidParam((req.params as { id?: string }).id);
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
    await liveTeacher(id);
    const now = ctx.now();
    const horizon = new Date(now.getTime() + (MAX_BOOKING_HORIZON_DAYS + 1) * 86_400_000);
    const wins = await db.query<{ starts_at: Date; ends_at: Date }>(
      "SELECT starts_at, ends_at FROM availability WHERE teacher_id = $1 AND ends_at > $2 AND starts_at < $3",
      [id, now, horizon],
    );
    const busy = await db.query<{ starts_at: Date; duration_min: number }>(
      `SELECT starts_at, duration_min FROM bookings
        WHERE teacher_id = $1 AND starts_at < $3 AND starts_at + duration_min * interval '1 minute' > $2
          AND ((status = 'awaiting_payment' AND expires_at > $2) OR status IN ('requested','confirmed'))`,
      [id, now, horizon],
    );
    const slots = openSlots(
      wins.rows.map((w) => ({ start: w.starts_at, end: w.ends_at })),
      busy.rows.map((b) => ({ start: b.starts_at, end: new Date(b.starts_at.getTime() + b.duration_min * 60_000) })),
      now,
      limit,
    );
    return { slots };
  });
};
