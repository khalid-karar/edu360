import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { checkDecision, RUBRIC_KEYS, RUBRIC_MAX_EACH, rubricTotal, type Rubric } from "../../domain/vetting.js";
import { audit } from "../../services/audit.js";
import { notify } from "../../services/notifications.js";
import type { Ctx } from "../context.js";
import { HttpError, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";

const rubricScore = z.number().int().min(0).max(RUBRIC_MAX_EACH);
const Decision = z
  .object({
    decision: z.enum(["approved", "conditional", "rejected"]),
    rubric: z.object({ knowledge: rubricScore, communication: rubricScore, conduct: rubricScore, tech: rubricScore }).strict(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();

export const vettingRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  // Only vetting officers. Super admins configure the platform but do not approve teachers (separation of duties).
  const pre = guard(ctx, { roles: ["vetting_officer"] });
  const { db } = ctx;

  app.get("/admin/vetting/queue", { preHandler: pre }, async () => {
    const r = await db.query<{ user_id: string; display_name: string; status: string; submitted_at: Date; categories: number; pending_credentials: number }>(
      `SELECT t.user_id, u.display_name, t.status, t.submitted_at,
              (SELECT count(*)::int FROM teacher_categories tc WHERE tc.teacher_id = t.user_id) AS categories,
              (SELECT count(*)::int FROM credentials c WHERE c.teacher_id = t.user_id AND c.verdict IS NULL) AS pending_credentials
         FROM teacher_profiles t JOIN users u ON u.id = t.user_id
        WHERE t.status IN ('submitted','interview')
        ORDER BY t.submitted_at ASC`,
    );
    return {
      items: r.rows.map((x) => ({
        teacherId: x.user_id,
        displayName: x.display_name,
        status: x.status,
        submittedAt: x.submitted_at,
        categories: x.categories,
        pendingCredentials: x.pending_credentials,
      })),
    };
  });

  app.get("/admin/vetting/teachers/:id", { preHandler: pre }, async (req) => {
    const id = uuidParam((req.params as { id?: string }).id);
    const t = (
      await db.query<Record<string, unknown>>(
        `SELECT t.status, t.bio, t.languages, t.freelance_document_no, t.employer_noc_url, t.intro_video_url,
                t.code_of_conduct_version, t.adults_only, t.submitted_at,
                u.display_name, i.full_name, i.gender, i.date_of_birth
           FROM teacher_profiles t JOIN users u ON u.id = t.user_id
           LEFT JOIN identity_verifications i ON i.user_id = t.user_id
          WHERE t.user_id = $1`,
        [id],
      )
    ).rows[0];
    if (!t) throw new HttpError(404, "not_found");
    // National ID, IBAN and mobile are deliberately not shown to vetting.
    const cats = await db.query("SELECT tc.category_id, c.name_ar, tc.price_halalas, tc.approved FROM teacher_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.teacher_id = $1 ORDER BY c.id", [id]);
    const creds = await db.query("SELECT id, category_id, kind, file_url, verdict, reviewed_at FROM credentials WHERE teacher_id = $1 ORDER BY id", [id]);
    const reviews = await db.query("SELECT officer_id, decision, rubric, reason, created_at FROM vetting_reviews WHERE teacher_id = $1 ORDER BY created_at DESC", [id]);
    return { teacher: t, categories: cats.rows, credentials: creds.rows, reviews: reviews.rows };
  });

  app.post("/admin/vetting/credentials/:id/review", { preHandler: pre }, async (req) => {
    const officer = me(req);
    const id = uuidParam((req.params as { id?: string }).id);
    const { verdict } = parse(z.object({ verdict: z.enum(["accepted", "rejected"]) }).strict(), req.body);
    const c = (
      await db.query<{ teacher_id: string; status: string }>(
        "SELECT c.teacher_id, t.status FROM credentials c JOIN teacher_profiles t ON t.user_id = c.teacher_id WHERE c.id = $1",
        [id],
      )
    ).rows[0];
    if (!c) throw new HttpError(404, "not_found");
    if (c.status !== "submitted" && c.status !== "interview") throw new HttpError(409, "not_under_review");
    await db.tx(async (tx) => {
      await tx.query("UPDATE credentials SET verdict=$2, reviewed_by=$3, reviewed_at=$4 WHERE id=$1", [id, verdict, officer.id, ctx.now()]);
      await audit(tx, { actorId: officer.id, action: "vetting.credential_reviewed", targetType: "credential", targetId: id, detail: { verdict, teacherId: c.teacher_id } });
    });
    return { ok: true };
  });

  app.post("/admin/vetting/teachers/:id/interview", { preHandler: pre }, async (req) => {
    const officer = me(req);
    const id = uuidParam((req.params as { id?: string }).id);
    const r = await db.tx(async (tx) => {
      const u = await tx.query("UPDATE teacher_profiles SET status='interview' WHERE user_id=$1 AND status='submitted'", [id]);
      if (u.rowCount === 1) await audit(tx, { actorId: officer.id, action: "vetting.interview_started", targetType: "user", targetId: id });
      return u.rowCount;
    });
    if (r !== 1) throw new HttpError(409, "wrong_status");
    return { ok: true, status: "interview" };
  });

  app.post("/admin/vetting/teachers/:id/decision", { preHandler: pre }, async (req) => {
    const officer = me(req);
    const id = uuidParam((req.params as { id?: string }).id);
    const b = parse(Decision, req.body);
    const rubric = b.rubric as Rubric;
    const result = await db.tx(async (tx) => {
      // Lock the row so two officers cannot both decide the same application.
      const t = (await tx.query<{ status: string }>("SELECT status FROM teacher_profiles WHERE user_id = $1 FOR UPDATE", [id])).rows[0];
      if (!t) throw new HttpError(404, "not_found");
      if (t.status !== "interview") throw new HttpError(409, "wrong_status"); // a decision follows the interview
      const accepted = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM credentials WHERE teacher_id = $1 AND verdict = 'accepted'", [id])).rows[0]?.n ?? 0;
      const check = checkDecision(b.decision, rubric, b.reason, accepted);
      if (!check.ok) throw new HttpError(422, check.reason);

      await tx.query("INSERT INTO vetting_reviews (teacher_id, officer_id, rubric, decision, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [
        id, officer.id, JSON.stringify(rubric), b.decision, b.reason ?? null, ctx.now(),
      ]);
      if (b.decision === "rejected") {
        await tx.query("UPDATE teacher_profiles SET status='rejected' WHERE user_id=$1", [id]);
      } else {
        await tx.query(
          "UPDATE teacher_profiles SET status=$2, approved_at=$3, adults_only = (adults_only OR $4) WHERE user_id=$1",
          [id, b.decision, ctx.now(), b.decision === "conditional"],
        );
        // Only categories with accepted proof go live.
        await tx.query(
          `UPDATE teacher_categories tc SET approved = EXISTS (
             SELECT 1 FROM credentials c WHERE c.teacher_id = tc.teacher_id AND c.category_id = tc.category_id AND c.verdict = 'accepted')
           WHERE tc.teacher_id = $1`,
          [id],
        );
      }
      await notify(tx, { userId: id, kind: "vetting_decision", vars: { decision: b.decision, ...(b.reason ? { note: b.reason } : {}) }, link: "/portal/apply" }, ctx.now());
      await audit(tx, {
        actorId: officer.id,
        action: "vetting.decision",
        targetType: "user",
        targetId: id,
        reason: b.reason ?? null,
        detail: { decision: b.decision, total: rubricTotal(rubric), max: RUBRIC_KEYS.length * RUBRIC_MAX_EACH },
      });
      return { decision: b.decision, total: rubricTotal(rubric) };
    });
    return { ok: true, ...result };
  });
};
