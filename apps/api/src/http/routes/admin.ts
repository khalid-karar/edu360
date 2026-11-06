import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { audit } from "../../services/audit.js";
import type { Ctx } from "../context.js";
import { HttpError, isUniqueViolation, parse } from "../errors.js";
import { guard, me } from "../guard.js";

const Band = { minPriceHalalas: z.number().int().positive(), maxPriceHalalas: z.number().int().positive() };
const CreateCategory = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
    nameAr: z.string().trim().min(2).max(60),
    nameEn: z.string().trim().min(2).max(60),
    ...Band,
    allowsMinors: z.boolean().default(true),
  })
  .strict();
const PatchCategory = z
  .object({
    nameAr: z.string().trim().min(2).max(60),
    nameEn: z.string().trim().min(2).max(60),
    ...Band,
    allowsMinors: z.boolean(),
    active: z.boolean(),
  })
  .partial()
  .strict();

interface CategoryRow {
  id: number;
  slug: string;
  name_ar: string;
  name_en: string;
  min_price_halalas: number;
  max_price_halalas: number;
  allows_minors: boolean;
  active: boolean;
}
const view = (c: CategoryRow) => ({
  id: c.id,
  slug: c.slug,
  nameAr: c.name_ar,
  nameEn: c.name_en,
  minPriceHalalas: c.min_price_halalas,
  maxPriceHalalas: c.max_price_halalas,
  allowsMinors: c.allows_minors,
  active: c.active,
});

export const adminRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const superAdmin = guard(ctx, { roles: ["super_admin"] });

  // Public: the whitelist of what can be taught. There is no free-text category.
  app.get("/categories", async () => {
    const r = await db.query<CategoryRow>("SELECT * FROM categories WHERE active ORDER BY id");
    return { items: r.rows.map(view) };
  });

  app.post("/admin/categories", { preHandler: superAdmin }, async (req, reply) => {
    const admin = me(req);
    const b = parse(CreateCategory, req.body);
    if (b.minPriceHalalas > b.maxPriceHalalas) throw new HttpError(422, "bad_price_band");
    try {
      const row = await db.tx(async (tx) => {
        const r = await tx.query<CategoryRow>(
          `INSERT INTO categories (slug, name_ar, name_en, min_price_halalas, max_price_halalas, allows_minors)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [b.slug, b.nameAr, b.nameEn, b.minPriceHalalas, b.maxPriceHalalas, b.allowsMinors],
        );
        await audit(tx, { actorId: admin.id, action: "category.created", targetType: "category", targetId: String(r.rows[0]!.id), detail: { slug: b.slug } });
        return r.rows[0]!;
      });
      reply.code(201);
      return view(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, "slug_taken");
      throw e;
    }
  });

  app.patch("/admin/categories/:id", { preHandler: superAdmin }, async (req) => {
    const admin = me(req);
    const id = parse(z.coerce.number().int().positive(), (req.params as { id?: string }).id);
    const b = parse(PatchCategory, req.body);
    if (Object.keys(b).length === 0) throw new HttpError(400, "nothing_to_change");
    return db.tx(async (tx) => {
      const cur = (await tx.query<CategoryRow>("SELECT * FROM categories WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!cur) throw new HttpError(404, "not_found");
      const next = {
        name_ar: b.nameAr ?? cur.name_ar,
        name_en: b.nameEn ?? cur.name_en,
        min_price_halalas: b.minPriceHalalas ?? cur.min_price_halalas,
        max_price_halalas: b.maxPriceHalalas ?? cur.max_price_halalas,
        allows_minors: b.allowsMinors ?? cur.allows_minors,
        active: b.active ?? cur.active,
      };
      if (next.min_price_halalas > next.max_price_halalas) throw new HttpError(422, "bad_price_band");
      const r = await tx.query<CategoryRow>(
        `UPDATE categories SET name_ar=$2, name_en=$3, min_price_halalas=$4, max_price_halalas=$5, allows_minors=$6, active=$7
          WHERE id=$1 RETURNING *`,
        [id, next.name_ar, next.name_en, next.min_price_halalas, next.max_price_halalas, next.allows_minors, next.active],
      );
      // Changing a price band never rewrites prices teachers already set; it only governs new ones.
      await audit(tx, { actorId: admin.id, action: "category.updated", targetType: "category", targetId: String(id), detail: { before: view(cur), after: view(r.rows[0]!) } });
      return view(r.rows[0]!);
    });
  });

  app.get("/admin/audit-log", { preHandler: superAdmin }, async (req) => {
    const q = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: z.coerce.number().int().positive().optional() }),
      req.query,
    );
    const r = await db.query<{ id: string; actor_id: string | null; action: string; target_type: string; target_id: string; reason: string | null; detail: unknown; created_at: Date }>(
      `SELECT id::text AS id, actor_id, action, target_type, target_id, reason, detail, created_at
         FROM audit_log WHERE ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $1`,
      [q.limit, q.before ?? null],
    );
    return {
      items: r.rows.map((x) => ({ id: Number(x.id), actorId: x.actor_id, action: x.action, targetType: x.target_type, targetId: x.target_id, reason: x.reason, detail: x.detail, at: x.created_at })),
    };
  });
};
