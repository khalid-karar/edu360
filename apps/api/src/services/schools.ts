import type { Db } from "../db/db.js";
import { newSchoolCode, MIN_FAMILIES_FOR_STATS, SCHOOL_CODE_RE } from "../domain/schools.js";
import { HttpError, isUniqueViolation } from "../http/errors.js";
import { audit } from "./audit.js";

export interface SchoolApplication {
  name: string;
  city: string;
  contactName: string;
  contactMobile: string;
  licenseNo?: string | undefined;
  studentEstimate?: number | undefined;
}

export async function applyForSchool(db: Db, now: Date, a: SchoolApplication): Promise<{ id: string }> {
  try {
    const r = await db.query<{ id: string }>(
      `INSERT INTO schools (name, city, contact_name, contact_mobile, license_no, student_estimate, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [a.name, a.city, a.contactName, a.contactMobile, a.licenseNo ?? null, a.studentEstimate ?? null, now],
    );
    return { id: r.rows[0]!.id };
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "school_already_applied");
    throw e;
  }
}

interface SchoolRow {
  id: string;
  name: string;
  city: string;
  contact_name: string;
  contact_mobile: string;
  license_no: string | null;
  student_estimate: number | null;
  status: string;
  invite_code: string | null;
  reject_reason: string | null;
  created_at: Date;
  decided_at: Date | null;
  families: number;
}

export async function listSchools(db: Db, status?: string) {
  const r = await db.query<SchoolRow>(
    `SELECT s.*, (SELECT count(*)::int FROM users u WHERE u.school_id = s.id) AS families
       FROM schools s WHERE ($1::text IS NULL OR s.status = $1) ORDER BY (s.status = 'pending') DESC, s.created_at DESC LIMIT 200`,
    [status ?? null],
  );
  return r.rows.map((s) => ({
    id: s.id,
    name: s.name,
    city: s.city,
    contactName: s.contact_name,
    contactMobile: s.contact_mobile,
    licenseNo: s.license_no,
    studentEstimate: s.student_estimate,
    status: s.status,
    inviteCode: s.invite_code,
    rejectReason: s.reject_reason,
    createdAt: s.created_at,
    decidedAt: s.decided_at,
    families: s.families,
  }));
}

/**
 * Approves (creates the school's login on its contact mobile and an invite code) or rejects with a reason. Done once:
 * a decided application cannot be decided again.
 */
export async function decideSchool(db: Db, now: Date, officerId: string, schoolId: string, decision: "approve" | "reject", reason?: string) {
  return db.tx(async (tx) => {
    const s = (await tx.query<SchoolRow>("SELECT * FROM schools WHERE id = $1 FOR UPDATE", [schoolId])).rows[0];
    if (!s) throw new HttpError(404, "not_found");
    if (s.status !== "pending") throw new HttpError(409, "already_decided");
    if (decision === "reject") {
      if (!reason?.trim()) throw new HttpError(422, "reason_required");
      await tx.query("UPDATE schools SET status = 'rejected', reject_reason = $2, decided_by = $3, decided_at = $4 WHERE id = $1", [schoolId, reason.trim(), officerId, now]);
      await audit(tx, { actorId: officerId, action: "school.rejected", targetType: "school", targetId: schoolId, reason: reason.trim() });
      return { status: "rejected" as const, mobile: s.contact_mobile, name: s.name };
    }
    // The login is the contact's own mobile. If that number already belongs to someone, a second account cannot be made for it.
    if ((await tx.query("SELECT 1 FROM users WHERE mobile = $1", [s.contact_mobile])).rowCount) throw new HttpError(409, "mobile_in_use");
    const owner = (await tx.query<{ id: string }>("INSERT INTO users (role, status, mobile, display_name) VALUES ('school','active',$1,$2) RETURNING id", [s.contact_mobile, s.name])).rows[0]!;
    let code = "";
    for (let i = 0; i < 5; i++) {
      code = newSchoolCode();
      if (!(await tx.query("SELECT 1 FROM schools WHERE invite_code = $1", [code])).rowCount) break;
      if (i === 4) throw new HttpError(500, "code_generation_failed");
    }
    await tx.query("UPDATE schools SET status = 'approved', invite_code = $2, owner_id = $3, decided_by = $4, decided_at = $5 WHERE id = $1", [schoolId, code, owner.id, officerId, now]);
    await audit(tx, { actorId: officerId, action: "school.approved", targetType: "school", targetId: schoolId, detail: { ownerId: owner.id } });
    return { status: "approved" as const, mobile: s.contact_mobile, name: s.name, code };
  });
}

/** The approved school behind a code typed at sign-up. */
export async function schoolIdForCode(db: Db, code: string): Promise<string> {
  const c = code.trim().toUpperCase();
  const r = SCHOOL_CODE_RE.test(c) ? await db.query<{ id: string }>("SELECT id FROM schools WHERE invite_code = $1 AND status = 'approved'", [c]) : null;
  if (!r?.rows[0]) throw new HttpError(422, "invalid_school_code");
  return r.rows[0].id;
}

const MONTHS = 6;

/** What a school may see about the families it brought. Counts only, and the lesson figures only once the group is big enough. */
export async function schoolOverview(db: Db, now: Date, ownerId: string) {
  const s = (await db.query<{ id: string; name: string; invite_code: string }>("SELECT id, name, invite_code FROM schools WHERE owner_id = $1 AND status = 'approved'", [ownerId])).rows[0];
  if (!s) throw new HttpError(404, "not_found");
  const families = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE school_id = $1", [s.id])).rows[0]!.n;
  const base = { school: { name: s.name, inviteCode: s.invite_code }, families, minFamilies: MIN_FAMILIES_FOR_STATS };
  if (families < MIN_FAMILIES_FOR_STATS) return { ...base, stats: null };

  const since = new Date(now.getTime() - 30 * 86_400_000);
  const totals = (await db.query<{ completed: number; hours: string; active: number }>(
    `SELECT count(*) FILTER (WHERE b.status = 'completed')::int AS completed,
            COALESCE(sum(b.duration_min) FILTER (WHERE b.status = 'completed'), 0)::float / 60 AS hours,
            count(DISTINCT b.payer_id) FILTER (WHERE b.created_at > $2)::int AS active
       FROM bookings b JOIN users u ON u.id = b.payer_id WHERE u.school_id = $1`,
    [s.id, since],
  )).rows[0]!;
  // A subject taken by fewer than the minimum number of families is folded into "other", so no single household stands out.
  const cats = (await db.query<{ name_ar: string; lessons: number; fams: number }>(
    `SELECT c.name_ar, count(*)::int AS lessons, count(DISTINCT b.payer_id)::int AS fams
       FROM bookings b JOIN users u ON u.id = b.payer_id JOIN categories c ON c.id = b.category_id
      WHERE u.school_id = $1 AND b.status = 'completed' GROUP BY c.name_ar ORDER BY lessons DESC`,
    [s.id],
  )).rows;
  const shown = cats.filter((c) => c.fams >= MIN_FAMILIES_FOR_STATS).map((c) => ({ category: c.name_ar, lessons: c.lessons }));
  const other = cats.filter((c) => c.fams < MIN_FAMILIES_FOR_STATS).reduce((a, c) => a + c.lessons, 0);
  if (other > 0) shown.push({ category: "مواد أخرى", lessons: other });

  const monthly = (await db.query<{ m: string; signups: number }>(
    `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS m, count(*)::int AS signups
       FROM users WHERE school_id = $1 AND created_at > $2 GROUP BY 1 ORDER BY 1`,
    [s.id, new Date(now.getTime() - MONTHS * 31 * 86_400_000)],
  )).rows;
  return { ...base, stats: { completedLessons: totals.completed, hours: Math.round(Number(totals.hours) * 10) / 10, activeFamilies30d: totals.active >= MIN_FAMILIES_FOR_STATS ? totals.active : null, byCategory: shown, signupsByMonth: monthly.map((r) => ({ month: r.m, signups: r.signups })) } };
}
