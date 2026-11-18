import { readUploadByKey } from "../../services/uploads.js";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { checkDecision, RUBRIC_KEYS, RUBRIC_MAX_EACH, rubricTotal, type Rubric } from "../../domain/vetting.js";
import { audit } from "../../services/audit.js";
import { notify } from "../../services/notifications.js";
import type { Ctx } from "../context.js";
import { HttpError, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";
import { foundingCount, lockPolicy } from "../../services/settings.js";

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
    // Approved teachers who added a subject and uploaded proof for it.
    const extra = await db.query<{ user_id: string; display_name: string; category_id: number; name_ar: string; pending: number; accepted: number }>(
      `SELECT t.user_id, u.display_name, tc.category_id, c.name_ar,
              (SELECT count(*)::int FROM credentials k WHERE k.teacher_id = tc.teacher_id AND k.category_id = tc.category_id AND k.verdict IS NULL) AS pending,
              (SELECT count(*)::int FROM credentials k WHERE k.teacher_id = tc.teacher_id AND k.category_id = tc.category_id AND k.verdict = 'accepted') AS accepted
         FROM teacher_categories tc JOIN teacher_profiles t ON t.user_id = tc.teacher_id JOIN users u ON u.id = t.user_id JOIN categories c ON c.id = tc.category_id
        WHERE tc.approved = false AND t.status IN ('approved','conditional')
          AND EXISTS (SELECT 1 FROM credentials k WHERE k.teacher_id = tc.teacher_id AND k.category_id = tc.category_id)
        ORDER BY u.display_name, c.id`,
    );
    return {
      extra: extra.rows.map((x) => ({ teacherId: x.user_id, displayName: x.display_name, categoryId: x.category_id, categoryName: x.name_ar, pendingCredentials: x.pending, acceptedCredentials: x.accepted })),
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
        `SELECT t.status, t.bio, t.languages, t.freelance_document_no, (t.employer_noc_url IS NOT NULL) AS has_employer_noc, (t.intro_video_url IS NOT NULL) AS has_intro_video,
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

  // Officers open a credential scan only through here; every view is written to the audit log.
  app.get("/admin/vetting/credentials/:id/file", { preHandler: pre }, async (req, reply) => {
    const officer = me(req);
    const id = uuidParam((req.params as { id?: string }).id);
    const c = (await db.query<{ teacher_id: string; file_url: string }>("SELECT teacher_id, file_url FROM credentials WHERE id = $1", [id])).rows[0];
    if (!c) throw new HttpError(404, "not_found");
    const up = (await db.query<{ content_type: string }>("SELECT content_type FROM uploads WHERE key = $1", [c.file_url])).rows[0];
    const f = up ? await readUploadByKey(ctx, c.file_url, up.content_type) : null;
    if (!f) throw new HttpError(404, "not_found");
    await audit(db, { actorId: officer.id, action: "credential.file_viewed", targetType: "credential", targetId: id, detail: { teacherId: c.teacher_id } });
    return reply.header("content-type", f.contentType).header("content-disposition", 'attachment; filename="credential"').send(f.data);
  });

  // The intro video and the employer's no-objection letter, opened the same way: only here, and every view is audited.
  const profileFile = (path: "intro-video" | "employer-noc", column: "intro_video_url" | "employer_noc_url", action: string) =>
    app.get(`/admin/vetting/teachers/:id/${path}`, { preHandler: pre }, async (req, reply) => {
      const officer = me(req);
      const id = uuidParam((req.params as { id?: string }).id);
      const row = (await db.query<{ key: string | null }>(`SELECT ${column} AS key FROM teacher_profiles WHERE user_id = $1`, [id])).rows[0];
      if (!row?.key) throw new HttpError(404, "not_found");
      const up = (await db.query<{ content_type: string }>("SELECT content_type FROM uploads WHERE key = $1", [row.key])).rows[0];
      const f = up ? await readUploadByKey(ctx, row.key, up.content_type) : null;
      if (!f) throw new HttpError(404, "not_found");
      await audit(db, { actorId: officer.id, action, targetType: "user", targetId: id, detail: {} });
      return reply.header("content-type", f.contentType).header("content-disposition", 'attachment; filename="file"').send(f.data);
    });
  profileFile("intro-video", "intro_video_url", "teacher.intro_video_viewed");
  profileFile("employer-noc", "employer_noc_url", "teacher.employer_noc_viewed");

  app.post("/admin/vetting/credentials/:id/review", { preHandler: pre }, async (req) => {
    const officer = me(req);
    const id = uuidParam((req.params as { id?: string }).id);
    const { verdict } = parse(z.object({ verdict: z.enum(["accepted", "rejected"]) }).strict(), req.body);
    const c = (
      await db.query<{ teacher_id: string; status: string; cat_approved: boolean | null }>(
        `SELECT c.teacher_id, t.status, tc.approved AS cat_approved FROM credentials c JOIN teacher_profiles t ON t.user_id = c.teacher_id
           LEFT JOIN teacher_categories tc ON tc.teacher_id = c.teacher_id AND tc.category_id = c.category_id WHERE c.id = $1`,
        [id],
      )
    ).rows[0];
    if (!c) throw new HttpError(404, "not_found");
    // Proof is reviewed during an application, or for a subject an approved teacher added and that is not live yet.
    const underReview = c.status === "submitted" || c.status === "interview" || ((c.status === "approved" || c.status === "conditional") && c.cat_approved === false);
    if (!underReview) throw new HttpError(409, "not_under_review");
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
        // The first N teachers ever approved are "founding" teachers (N is a setting). Decided once, on first approval.
        const policy = await lockPolicy(tx);
        const taken = await foundingCount(tx);
        await tx.query(
          "UPDATE teacher_profiles SET status=$2, founding = CASE WHEN approved_at IS NULL THEN $5 ELSE founding END, approved_at=$3, adults_only = (adults_only OR $4) WHERE user_id=$1",
          [id, b.decision, ctx.now(), b.decision === "conditional", taken < policy.founderLimit],
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

  // Decide one added subject of an approved teacher. Approval needs accepted proof for that subject.
  app.post("/admin/vetting/teachers/:id/categories/:categoryId/decision", { preHandler: pre }, async (req) => {
    const officer = me(req);
    const id = uuidParam((req.params as { id?: string }).id);
    const categoryId = parse(z.coerce.number().int().positive(), (req.params as { categoryId?: string }).categoryId);
    const b = parse(z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(300).optional() }).strict(), req.body);
    if (b.decision === "reject" && !b.reason) throw new HttpError(422, "reason_required");
    await db.tx(async (tx) => {
      const row = (await tx.query<{ approved: boolean; status: string; name_ar: string }>(
        `SELECT tc.approved, t.status, c.name_ar FROM teacher_categories tc JOIN teacher_profiles t ON t.user_id = tc.teacher_id JOIN categories c ON c.id = tc.category_id
          WHERE tc.teacher_id = $1 AND tc.category_id = $2 FOR UPDATE OF tc`,
        [id, categoryId],
      )).rows[0];
      if (!row) throw new HttpError(404, "not_found");
      if (row.approved || (row.status !== "approved" && row.status !== "conditional")) throw new HttpError(409, "wrong_status");
      if (b.decision === "approve") {
        const ok = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM credentials WHERE teacher_id = $1 AND category_id = $2 AND verdict = 'accepted'", [id, categoryId])).rows[0]!.n;
        if (!ok) throw new HttpError(422, "no_accepted_proof");
        await tx.query("UPDATE teacher_categories SET approved = true WHERE teacher_id = $1 AND category_id = $2", [id, categoryId]);
      } else {
        await tx.query("DELETE FROM credentials WHERE teacher_id = $1 AND category_id = $2", [id, categoryId]);
        await tx.query("DELETE FROM teacher_categories WHERE teacher_id = $1 AND category_id = $2", [id, categoryId]);
      }
      await notify(tx, { userId: id, kind: "extra_category_decided", vars: { who: row.name_ar, decision: b.decision === "approve" ? "approved" : "rejected", ...(b.reason ? { note: b.reason } : {}) }, link: "/portal/apply" }, ctx.now());
      await audit(tx, { actorId: officer.id, action: "vetting.category_decision", targetType: "user", targetId: id, reason: b.reason ?? null, detail: { categoryId, decision: b.decision } });
    });
    return { ok: true };
  });
};
