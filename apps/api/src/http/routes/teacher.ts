import { ALLOWED_TYPES } from "../../domain/uploads.js";
import { readUploadById, saveUpload } from "../../services/uploads.js";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Db } from "../../db/db.js";
import { isValidSaudiIban, maskIban, normalizeIban } from "../../domain/iban.js";
import { namesMatch } from "../../domain/names.js";
import { CONDUCT_VERSION, canReapply } from "../../domain/vetting.js";
import { audit } from "../../services/audit.js";
import type { Ctx } from "../context.js";
import { HttpError, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";

const MAX_CATEGORIES = 3;
const MAX_CREDENTIALS_PER_CATEGORY = 10;
const CREDENTIAL_KINDS = ["degree", "ijazah", "certificate", "portfolio", "sample_video"] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Status = "draft" | "submitted" | "interview" | "approved" | "conditional" | "rejected" | "suspended";
/** Teachers can change their application only while it is not under review or live. */
const editable = (s: Status) => s === "draft" || s === "rejected";

interface ProfileRow {
  status: Status;
  freelance_document_no: string | null;
  employer_noc_url: string | null;
  bio: string | null;
  intro_video_url: string | null;
  languages: string[];
  iban: string | null;
  iban_holder_name: string | null;
  code_of_conduct_version: string | null;
  code_of_conduct_signed_at: Date | null;
  adults_only: boolean;
  submitted_at: Date | null;
}

async function profileOf(db: Db, userId: string): Promise<ProfileRow> {
  const r = await db.query<ProfileRow>("SELECT * FROM teacher_profiles WHERE user_id = $1", [userId]);
  if (!r.rows[0]) throw new HttpError(404, "no_teacher_profile");
  return r.rows[0];
}

/** What is still missing before the application can be submitted. */
async function missingFor(db: Db, userId: string, p: ProfileRow): Promise<string[]> {
  const missing: string[] = [];
  const ident = await db.query("SELECT 1 FROM identity_verifications WHERE user_id = $1", [userId]);
  if (!ident.rowCount) missing.push("identity");
  if (!p.freelance_document_no) missing.push("freelance_document");
  if (!p.bio) missing.push("bio");
  if (!p.languages.length) missing.push("languages");
  if (!p.intro_video_url) missing.push("intro_video");
  const cats = await db.query<{ category_id: number; creds: number }>(
    `SELECT tc.category_id,
            (SELECT count(*)::int FROM credentials c WHERE c.teacher_id = tc.teacher_id AND c.category_id = tc.category_id) AS creds
       FROM teacher_categories tc WHERE tc.teacher_id = $1`,
    [userId],
  );
  if (!cats.rowCount) missing.push("categories");
  else if (cats.rows.some((c) => c.creds === 0)) missing.push("credentials");
  if (p.code_of_conduct_version !== CONDUCT_VERSION) missing.push("code_of_conduct");
  if (!p.iban) missing.push("iban");
  return missing;
}

export const teacherRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const pre = guard(ctx, { roles: ["teacher"] }); // active only: identity must be verified first
  const { db } = ctx;
  const uploadKey = (userId: string) =>
    z
      .string()
      .max(250)
      .regex(new RegExp(`^${escapeRe(ctx.config.uploadsPrefix)}${escapeRe(userId)}/[A-Za-z0-9._/-]{1,150}$`), "invalid upload key")
      .refine((k) => !k.includes(".."), "invalid upload key");

  const lockOr = (p: ProfileRow) => {
    if (!editable(p.status)) throw new HttpError(409, "profile_locked");
  };

  app.get("/teacher/me", { preHandler: pre }, async (req) => {
    const u = me(req);
    const p = await profileOf(db, u.id);
    const cats = await db.query<{ category_id: number; slug: string; name_ar: string; price_halalas: number; approved: boolean }>(
      `SELECT tc.category_id, c.slug, c.name_ar, tc.price_halalas, tc.approved
         FROM teacher_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.teacher_id = $1 ORDER BY c.id`,
      [u.id],
    );
    const creds = await db.query<{ id: string; category_id: number; kind: string; verdict: string | null }>(
      "SELECT id, category_id, kind, verdict FROM credentials WHERE teacher_id = $1 ORDER BY id",
      [u.id],
    );
    const last = await db.query<{ decision: string; reason: string | null; created_at: Date }>(
      "SELECT decision, reason, created_at FROM vetting_reviews WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT 1",
      [u.id],
    );
    return {
      status: p.status,
      conductVersion: CONDUCT_VERSION,
      profile: {
        bio: p.bio,
        languages: p.languages,
        freelanceDocumentNo: p.freelance_document_no,
        hasEmployerNoc: Boolean(p.employer_noc_url),
        hasIntroVideo: Boolean(p.intro_video_url),
        iban: p.iban ? maskIban(p.iban) : null,
        ibanHolderName: p.iban_holder_name,
        conductSigned: p.code_of_conduct_version === CONDUCT_VERSION,
        adultsOnly: p.adults_only,
      },
      categories: cats.rows.map((c) => ({ categoryId: c.category_id, slug: c.slug, nameAr: c.name_ar, priceHalalas: c.price_halalas, approved: c.approved })),
      credentials: creds.rows.map((c) => ({ id: c.id, categoryId: c.category_id, kind: c.kind, verdict: c.verdict })),
      lastDecision: last.rows[0] ? { decision: last.rows[0].decision, reason: last.rows[0].reason, at: last.rows[0].created_at } : null,
      missing: editable(p.status) ? await missingFor(db, u.id, p) : [],
    };
  });

  app.put("/teacher/profile", { preHandler: pre }, async (req) => {
    const u = me(req);
    const body = parse(
      z
        .object({
          bio: z.string().trim().min(40).max(1000),
          languages: z.array(z.enum(["ar", "en", "ur", "hi", "fr", "tl", "other"])).min(1).max(5),
          freelanceDocumentNo: z.string().trim().regex(/^[A-Za-z0-9-]{4,30}$/),
          employerNocKey: uploadKey(u.id).optional(),
          introVideoKey: uploadKey(u.id),
        })
        .strict(),
      req.body,
    );
    const p = await profileOf(db, u.id);
    lockOr(p);
    await db.query(
      `UPDATE teacher_profiles SET bio=$2, languages=$3, freelance_document_no=$4, employer_noc_url=$5, intro_video_url=$6
        WHERE user_id=$1`,
      [u.id, body.bio, body.languages, body.freelanceDocumentNo, body.employerNocKey ?? null, body.introVideoKey],
    );
    return { ok: true };
  });

  app.put("/teacher/categories", { preHandler: pre }, async (req) => {
    const u = me(req);
    const body = parse(
      z
        .object({
          categories: z
            .array(z.object({ categoryId: z.number().int().positive(), priceHalalas: z.number().int().positive() }).strict())
            .min(1)
            .max(MAX_CATEGORIES),
        })
        .strict(),
      req.body,
    );
    if (new Set(body.categories.map((c) => c.categoryId)).size !== body.categories.length) throw new HttpError(400, "duplicate_category");
    const p = await profileOf(db, u.id);
    lockOr(p);
    const ids = body.categories.map((c) => c.categoryId);
    const found = await db.query<{ id: number; min_price_halalas: number; max_price_halalas: number }>(
      "SELECT id, min_price_halalas, max_price_halalas FROM categories WHERE active AND id = ANY($1::int[])",
      [ids],
    );
    const bands = new Map(found.rows.map((c) => [c.id, c]));
    for (const c of body.categories) {
      const band = bands.get(c.categoryId);
      if (!band) throw new HttpError(422, "unknown_category", { categoryId: c.categoryId });
      if (c.priceHalalas < band.min_price_halalas || c.priceHalalas > band.max_price_halalas) {
        throw new HttpError(422, "price_out_of_band", { categoryId: c.categoryId, min: band.min_price_halalas, max: band.max_price_halalas });
      }
    }
    await db.tx(async (tx) => {
      // Proof for a category you drop goes with it. Everything restarts review: approval is never carried over.
      await tx.query("DELETE FROM credentials WHERE teacher_id = $1 AND NOT (category_id = ANY($2::int[]))", [u.id, ids]);
      await tx.query("DELETE FROM teacher_categories WHERE teacher_id = $1 AND NOT (category_id = ANY($2::int[]))", [u.id, ids]);
      for (const c of body.categories) {
        await tx.query(
          `INSERT INTO teacher_categories (teacher_id, category_id, price_halalas) VALUES ($1,$2,$3)
           ON CONFLICT (teacher_id, category_id) DO UPDATE SET price_halalas = EXCLUDED.price_halalas, approved = false`,
          [u.id, c.categoryId, c.priceHalalas],
        );
      }
    });
    return { ok: true };
  });

  // Raw file bodies. The guard runs as onRequest, before the body is read, so an anonymous caller cannot make the server buffer megabytes.
  app.addContentTypeParser([...ALLOWED_TYPES], { parseAs: "buffer", bodyLimit: ctx.config.uploadMaxBytes }, (_req, body, done) => done(null, body));

  app.post("/teacher/uploads", { onRequest: pre, bodyLimit: ctx.config.uploadMaxBytes }, async (req, reply) => {
    const u = me(req);
    const saved = await saveUpload(ctx, u.id, req.body, req.headers["content-type"] ?? "");
    reply.code(201);
    return saved;
  });

  app.get("/teacher/uploads/:id", { preHandler: pre }, async (req, reply) => {
    const u = me(req);
    const f = await readUploadById(ctx, uuidParam((req.params as { id?: string }).id), u.id);
    if (!f) throw new HttpError(404, "not_found");
    return reply.header("content-type", f.contentType).header("content-disposition", 'attachment; filename="document"').send(f.data);
  });

  app.post("/teacher/credentials", { preHandler: pre }, async (req, reply) => {
    const u = me(req);
    const b = parse(
      z.object({ categoryId: z.number().int().positive(), kind: z.enum(CREDENTIAL_KINDS), fileKey: uploadKey(u.id) }).strict(),
      req.body,
    );
    const p = await profileOf(db, u.id);
    lockOr(p);
    const mine = await db.query("SELECT 1 FROM teacher_categories WHERE teacher_id = $1 AND category_id = $2", [u.id, b.categoryId]);
    if (!mine.rowCount) throw new HttpError(422, "category_not_selected");
    const n = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM credentials WHERE teacher_id = $1 AND category_id = $2", [u.id, b.categoryId]);
    if ((n.rows[0]?.n ?? 0) >= MAX_CREDENTIALS_PER_CATEGORY) throw new HttpError(422, "too_many_credentials");
    // The file must be one this teacher uploaded through the endpoint above, not just a well-formed name.
    const owned = await db.query("SELECT 1 FROM uploads WHERE key = $1 AND owner_id = $2", [b.fileKey, u.id]);
    if (!owned.rowCount) throw new HttpError(422, "unknown_upload");
    const r = await db.query<{ id: string }>(
      "INSERT INTO credentials (teacher_id, category_id, kind, file_url) VALUES ($1,$2,$3,$4) RETURNING id",
      [u.id, b.categoryId, b.kind, b.fileKey],
    );
    reply.code(201);
    return { id: r.rows[0]!.id };
  });

  app.post("/teacher/code-of-conduct/sign", { preHandler: pre }, async (req) => {
    const u = me(req);
    const { version } = parse(z.object({ version: z.string() }).strict(), req.body);
    if (version !== CONDUCT_VERSION) throw new HttpError(409, "version_outdated", { current: CONDUCT_VERSION });
    const p = await profileOf(db, u.id);
    lockOr(p);
    await db.tx(async (tx) => {
      await tx.query("UPDATE teacher_profiles SET code_of_conduct_version=$2, code_of_conduct_signed_at=$3 WHERE user_id=$1", [u.id, version, ctx.now()]);
      await audit(tx, { actorId: u.id, action: "teacher.code_signed", targetType: "user", targetId: u.id, detail: { version, ip: req.ip } });
    });
    return { ok: true };
  });

  app.put("/teacher/payout", { preHandler: pre }, async (req) => {
    const u = me(req);
    const b = parse(z.object({ iban: z.string().max(40), holderName: z.string().trim().min(5).max(120) }).strict(), req.body);
    const p = await profileOf(db, u.id);
    if (p.status === "submitted" || p.status === "interview" || p.status === "suspended") throw new HttpError(409, "profile_locked");
    const iban = normalizeIban(b.iban);
    if (!isValidSaudiIban(iban)) throw new HttpError(422, "invalid_iban");
    const ident = await db.query<{ full_name: string }>("SELECT full_name FROM identity_verifications WHERE user_id = $1", [u.id]);
    if (!ident.rows[0]) throw new HttpError(409, "identity_required");
    // The account must be in the teacher's own name. This is what blocks mule accounts.
    if (!namesMatch(b.holderName, ident.rows[0].full_name)) throw new HttpError(422, "iban_name_mismatch");
    await db.tx(async (tx) => {
      await tx.query("UPDATE teacher_profiles SET iban=$2, iban_holder_name=$3 WHERE user_id=$1", [u.id, iban, b.holderName]);
      await audit(tx, { actorId: u.id, action: "teacher.iban_set", targetType: "user", targetId: u.id, detail: { iban: maskIban(iban) } });
    });
    return { ok: true, iban: maskIban(iban) };
  });

  app.post("/teacher/submit", { preHandler: pre }, async (req) => {
    const u = me(req);
    const p = await profileOf(db, u.id);
    if (!editable(p.status)) throw new HttpError(409, "not_submittable");
    if (p.status === "rejected") {
      const last = await db.query<{ created_at: Date }>(
        "SELECT created_at FROM vetting_reviews WHERE teacher_id = $1 AND decision = 'rejected' ORDER BY created_at DESC LIMIT 1",
        [u.id],
      );
      if (!canReapply(last.rows[0]?.created_at ?? null, ctx.now())) throw new HttpError(409, "reapply_too_soon");
    }
    const missing = await missingFor(db, u.id, p);
    if (missing.length) throw new HttpError(409, "incomplete", { missing });
    await db.tx(async (tx) => {
      await tx.query("UPDATE teacher_profiles SET status='submitted', submitted_at=$2 WHERE user_id=$1", [u.id, ctx.now()]);
      await audit(tx, { actorId: u.id, action: "teacher.submitted", targetType: "user", targetId: u.id });
    });
    return { ok: true, status: "submitted" };
  });
};
