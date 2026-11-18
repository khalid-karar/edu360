import type { Db } from "../db/db.js";
import { HttpError, isUniqueViolation } from "../http/errors.js";
import { audit } from "./audit.js";
import { notify } from "./notifications.js";

export const MAX_PENDING_REQUESTS = 3;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export async function requestCategory(db: Db, now: Date, teacherId: string, name: string, note?: string): Promise<{ id: string }> {
  const n = clean(name);
  const exists = await db.query("SELECT 1 FROM categories WHERE active AND (lower(name_ar) = lower($1) OR lower(name_en) = lower($1))", [n]);
  if (exists.rowCount) throw new HttpError(409, "category_exists");
  const pending = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM category_requests WHERE teacher_id = $1 AND status = 'pending'", [teacherId]);
  if ((pending.rows[0]?.n ?? 0) >= MAX_PENDING_REQUESTS) throw new HttpError(422, "too_many_pending_requests");
  try {
    const r = await db.query<{ id: string }>("INSERT INTO category_requests (teacher_id, name, note, created_at) VALUES ($1,$2,$3,$4) RETURNING id", [teacherId, n, note ? clean(note) || null : null, now]);
    return { id: r.rows[0]!.id };
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "already_requested");
    throw e;
  }
}

export async function myRequests(db: Db, teacherId: string) {
  const r = await db.query<{ id: string; name: string; status: string; reject_reason: string | null; created_at: Date }>(
    "SELECT id, name, status, reject_reason, created_at FROM category_requests WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT 20",
    [teacherId],
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, status: x.status, rejectReason: x.reject_reason, createdAt: x.created_at }));
}

export async function listRequests(db: Db, status: string) {
  const r = await db.query<{ id: string; name: string; note: string | null; status: string; teacher_name: string; reject_reason: string | null; created_at: Date; slug: string | null }>(
    `SELECT q.id, q.name, q.note, q.status, u.display_name AS teacher_name, q.reject_reason, q.created_at, c.slug
       FROM category_requests q JOIN users u ON u.id = q.teacher_id LEFT JOIN categories c ON c.id = q.category_id
      WHERE q.status = $1 ORDER BY q.created_at DESC LIMIT 100`,
    [status],
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, note: x.note, status: x.status, teacherName: x.teacher_name, rejectReason: x.reject_reason, createdAt: x.created_at, slug: x.slug }));
}

export interface NewCategory { slug: string; nameAr: string; nameEn: string; minPriceHalalas: number; maxPriceHalalas: number; allowsMinors: boolean }

/** Approve creates the category in the same transaction as the decision; a decided request cannot be decided again. */
export async function decideRequest(db: Db, now: Date, adminId: string, id: string, d: { decision: "approve"; category: NewCategory } | { decision: "reject"; reason: string }) {
  return db.tx(async (tx) => {
    const q = (await tx.query<{ id: string; teacher_id: string; name: string; status: string }>("SELECT id, teacher_id, name, status FROM category_requests WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!q) throw new HttpError(404, "not_found");
    if (q.status !== "pending") throw new HttpError(409, "already_decided");
    if (d.decision === "reject") {
      await tx.query("UPDATE category_requests SET status = 'rejected', reject_reason = $2, decided_by = $3, decided_at = $4 WHERE id = $1", [id, d.reason, adminId, now]);
      await audit(tx, { actorId: adminId, action: "category_request.rejected", targetType: "category_request", targetId: id, reason: d.reason, at: now });
      await notify(tx, { userId: q.teacher_id, kind: "category_request_decided", vars: { who: q.name, decision: "rejected", note: d.reason }, link: "/portal/apply" }, now);
      return { status: "rejected" as const };
    }
    if (d.category.minPriceHalalas > d.category.maxPriceHalalas) throw new HttpError(422, "bad_price_band");
    let categoryId: number;
    try {
      // A savepoint-free insert: the unique slug failure aborts this transaction, which is the intended outcome (nothing is changed).
      const c = await tx.query<{ id: number }>(
        "INSERT INTO categories (slug, name_ar, name_en, min_price_halalas, max_price_halalas, allows_minors) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [d.category.slug, d.category.nameAr, d.category.nameEn, d.category.minPriceHalalas, d.category.maxPriceHalalas, d.category.allowsMinors],
      );
      categoryId = c.rows[0]!.id;
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, "slug_taken");
      throw e;
    }
    await tx.query("UPDATE category_requests SET status = 'approved', category_id = $2, decided_by = $3, decided_at = $4 WHERE id = $1", [id, categoryId, adminId, now]);
    await audit(tx, { actorId: adminId, action: "category_request.approved", targetType: "category_request", targetId: id, detail: { categoryId, slug: d.category.slug }, at: now });
    await notify(tx, { userId: q.teacher_id, kind: "category_request_decided", vars: { who: d.category.nameAr, decision: "approved" }, link: "/portal/apply" }, now);
    return { status: "approved" as const, categoryId };
  });
}
