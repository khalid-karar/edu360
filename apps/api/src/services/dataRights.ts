import type { Db } from "../db/db.js";
import { HttpError } from "../http/errors.js";
import { audit } from "./audit.js";
import { notify, riyadhWhen } from "./notifications.js";

/** Time to change one's mind. Also stops a hijacked session from erasing an account in one click. */
export const DELETION_COOLING_DAYS = 14;
/** Exports include contact and bank details, so they are rate-limited. */
export const EXPORT_MAX_PER_DAY = 3;
const DAY = 86_400_000;
const DELETED_NAME = "حساب محذوف";

export type DeletionBlock = "upcoming_bookings" | "open_dispute" | "unsettled_money" | "open_safety_case";

/** Things that must finish before personal data can be erased: someone is still owed a lesson, money or a decision. */
export async function deletionBlockers(db: Db, userId: string): Promise<DeletionBlock[]> {
  const ids = (await db.query<{ id: string }>("SELECT id FROM users WHERE id = $1 OR guardian_id = $1", [userId])).rows.map((r) => r.id);
  const any = async (sql: string) => Boolean((await db.query(sql, [ids])).rowCount);
  const out: DeletionBlock[] = [];
  if (await any("SELECT 1 FROM bookings WHERE status IN ('awaiting_payment','requested','confirmed') AND (learner_id = ANY($1::uuid[]) OR payer_id = ANY($1::uuid[]) OR teacher_id = ANY($1::uuid[])) LIMIT 1")) out.push("upcoming_bookings");
  if (await any("SELECT 1 FROM disputes d JOIN bookings b ON b.id = d.booking_id WHERE d.outcome IS NULL AND (b.payer_id = ANY($1::uuid[]) OR b.teacher_id = ANY($1::uuid[])) LIMIT 1")) out.push("open_dispute");
  // A teacher is owed money until it is paid out; a payer's card hold must be captured or released.
  if (
    await any(
      `SELECT 1 FROM payments p JOIN bookings b ON b.id = p.booking_id
        WHERE (b.teacher_id = ANY($1::uuid[]) AND p.payout_id IS NULL AND (p.status IN ('captured','partially_refunded') OR p.platform_credit_halalas > 0))
           OR (b.payer_id = ANY($1::uuid[]) AND p.status = 'authorized')
        UNION ALL
        SELECT 1 FROM payouts WHERE teacher_id = ANY($1::uuid[]) AND status IN ('pending','approved','on_hold')
        LIMIT 1`,
    )
  )
    out.push("unsettled_money");
  if (await any("SELECT 1 FROM reports WHERE status IN ('open','reviewing') AND (reported_user_id = ANY($1::uuid[]) OR reporter_id = ANY($1::uuid[])) LIMIT 1")) out.push("open_safety_case");
  return out;
}

export async function exportAccount(db: Db, userId: string, now: Date) {
  const since = new Date(now.getTime() - DAY);
  const n = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE actor_id = $1 AND action = 'account.exported' AND created_at > $2", [userId, since])).rows[0]?.n ?? 0;
  if (n >= EXPORT_MAX_PER_DAY) throw new HttpError(429, "export_limit");

  const q = async (sql: string, p: unknown[] = [userId]) => (await db.query<Record<string, unknown>>(sql, p)).rows;
  const user = (await q("SELECT id, role, status, mobile, email, display_name, locale, gender, birth_year, created_at FROM users WHERE id = $1"))[0];
  if (!user) throw new HttpError(404, "not_found");
  const children = await q("SELECT id, display_name, birth_year, gender, created_at FROM users WHERE guardian_id = $1 ORDER BY created_at");
  const all = [userId, ...children.map((c) => c.id as string)];
  const qa = (sql: string) => q(sql, [all]);

  const data = {
    exportedAt: now.toISOString(),
    notes: [
      "هذه نسخة من بياناتك الشخصية التي نحتفظ بها.",
      "لا تتضمن أرقام جوالات أو حسابات الأطراف الأخرى، ولا هوية من أبلغ عنك أو ما كتبه فريق السلامة في قضاياك.",
      "رقم الهوية الوطنية لا نخزّنه، بل بصمة مشفّرة منه لمنع تكرار الحسابات.",
    ],
    account: user,
    children,
    identity: (await q("SELECT provider, full_name, gender, date_of_birth, face_match_score, verified_at FROM identity_verifications WHERE user_id = $1"))[0] ?? null,
    teacherProfile: (await q("SELECT status, freelance_document_no, bio, intro_video_url, languages, adults_only, iban, iban_holder_name, reliability_score, completed_sessions, approved_at, code_of_conduct_version, code_of_conduct_signed_at, submitted_at FROM teacher_profiles WHERE user_id = $1"))[0] ?? null,
    teacherCategories: await q("SELECT c.slug, c.name_ar, tc.price_halalas, tc.approved FROM teacher_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.teacher_id = $1"),
    credentials: await q("SELECT c.kind, c.file_url, c.verdict, c.reviewed_at, cat.slug AS category FROM credentials c JOIN categories cat ON cat.id = c.category_id WHERE c.teacher_id = $1"),
    availability: await q("SELECT starts_at, ends_at FROM availability WHERE teacher_id = $1 ORDER BY starts_at"),
    guardianApprovals: await q("SELECT t.display_name AS teacher, a.approved_at, a.cross_gender_ok FROM guardian_teacher_approvals a JOIN users t ON t.id = a.teacher_id WHERE a.guardian_id = $1"),
    bookings: await qa(
      `SELECT b.id, b.status, b.starts_at, b.duration_min, b.price_halalas, b.created_at, b.cancelled_by,
              tu.display_name AS teacher, lu.display_name AS learner, pu.display_name AS payer, c.slug AS category
         FROM bookings b JOIN users tu ON tu.id = b.teacher_id JOIN users lu ON lu.id = b.learner_id JOIN users pu ON pu.id = b.payer_id JOIN categories c ON c.id = b.category_id
        WHERE b.teacher_id = ANY($1::uuid[]) OR b.learner_id = ANY($1::uuid[]) OR b.payer_id = ANY($1::uuid[]) ORDER BY b.starts_at`,
    ),
    payments: await qa(
      `SELECT p.booking_id, p.status, p.amount_halalas, p.captured_halalas, p.refunded_halalas, p.commission_halalas, p.platform_credit_halalas, p.captured_at
         FROM payments p JOIN bookings b ON b.id = p.booking_id
        WHERE b.teacher_id = ANY($1::uuid[]) OR b.payer_id = ANY($1::uuid[]) ORDER BY p.created_at`,
    ),
    payouts: await q("SELECT id, amount_halalas, status, created_at, paid_at, bank_reference FROM payouts WHERE teacher_id = $1 ORDER BY created_at"),
    messages: await qa(
      `SELECT m.booking_id, m.inquiry_id, m.body, m.blocked, m.created_at, su.display_name AS sender
         FROM messages m JOIN users su ON su.id = m.sender_id
         LEFT JOIN bookings b ON b.id = m.booking_id LEFT JOIN inquiries i ON i.id = m.inquiry_id
        WHERE b.teacher_id = ANY($1::uuid[]) OR b.learner_id = ANY($1::uuid[]) OR b.payer_id = ANY($1::uuid[])
           OR i.teacher_id = ANY($1::uuid[]) OR i.payer_id = ANY($1::uuid[]) ORDER BY m.created_at`,
    ),
    reviews: await qa("SELECT r.booking_id, r.rating, r.comment, r.created_at FROM reviews r JOIN bookings b ON b.id = r.booking_id WHERE b.payer_id = ANY($1::uuid[]) OR b.teacher_id = ANY($1::uuid[])"),
    reportsFiled: await q("SELECT booking_id, category, reason, status, created_at FROM reports WHERE reporter_id = $1 ORDER BY created_at"),
    disputes: await qa("SELECT d.booking_id, d.kind, d.reason, d.outcome, d.refund_halalas, d.created_at FROM disputes d JOIN bookings b ON b.id = d.booking_id WHERE b.payer_id = ANY($1::uuid[]) OR b.teacher_id = ANY($1::uuid[])"),
    strikes: await q("SELECT level, action, zero_tolerance, reason, created_at, voided_at FROM strikes WHERE user_id = $1 ORDER BY created_at"),
    appeals: await q("SELECT reason, status, decision_note, created_at, decided_at FROM appeals WHERE user_id = $1 ORDER BY created_at"),
    notifications: await q("SELECT kind, title, body, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at"),
    signIns: await q("SELECT created_at, ip, user_agent FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50"),
  };
  await audit(db, { actorId: userId, action: "account.exported", targetType: "user", targetId: userId, at: now });
  return data;
}

export async function deletionStatus(db: Db, userId: string) {
  const r = (await db.query<{ requested_at: Date; due_at: Date; blocked_reasons: string[] }>("SELECT requested_at, due_at, blocked_reasons FROM deletion_requests WHERE user_id = $1 AND status = 'requested'", [userId])).rows[0];
  return r ? { requested: true, requestedAt: r.requested_at, dueAt: r.due_at, blockedReasons: r.blocked_reasons } : { requested: false };
}

export async function requestDeletion(db: Db, now: Date, userId: string, role: string) {
  if (["vetting_officer", "safety_officer", "finance_officer", "super_admin"].includes(role)) throw new HttpError(403, "staff_cannot_self_delete");
  const blocked = await deletionBlockers(db, userId);
  if (blocked.length) throw new HttpError(409, "deletion_blocked", { reasons: blocked });
  const dueAt = new Date(now.getTime() + DELETION_COOLING_DAYS * DAY);
  await db.tx(async (tx) => {
    const ins = await tx.query("INSERT INTO deletion_requests (user_id, requested_at, due_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [userId, now, dueAt]);
    if (!ins.rowCount) throw new HttpError(409, "deletion_already_requested");
    await audit(tx, { actorId: userId, action: "account.deletion_requested", targetType: "user", targetId: userId, detail: { dueAt: dueAt.toISOString() } });
    await notify(tx, { userId, kind: "deletion_requested", vars: { when: riyadhWhen(dueAt) }, link: "/portal/account", dedupeKey: `deletion:${userId}:${now.getTime()}` }, now);
  });
  return { dueAt };
}

export async function cancelDeletion(db: Db, now: Date, userId: string) {
  await db.tx(async (tx) => {
    const r = await tx.query("UPDATE deletion_requests SET status = 'cancelled', cancelled_at = $2 WHERE user_id = $1 AND status = 'requested'", [userId, now]);
    if (!r.rowCount) throw new HttpError(404, "not_found");
    await audit(tx, { actorId: userId, action: "account.deletion_cancelled", targetType: "user", targetId: userId });
  });
}

/**
 * Erases personal data and keeps what must stay. Kept, anonymised: bookings, payments, payouts, disputes, strikes, appeals, reports,
 * the audit log (financial and safety records), flagged messages (evidence), star ratings. For banned people also the hashed national ID,
 * so a ban cannot be dodged by re-registering. Everything else personal is blanked or removed.
 */
export async function eraseUser(db: Db, now: Date, userId: string): Promise<void> {
  await db.tx(async (tx) => {
    const kids = (await tx.query<{ id: string }>("SELECT id FROM users WHERE guardian_id = $1", [userId])).rows.map((r) => r.id);
    const ids = [userId, ...kids];
    const banned = (await tx.query<{ status: string }>("SELECT status FROM users WHERE id = $1", [userId])).rows[0]?.status === "banned";

    await tx.query("UPDATE auth_sessions SET revoked_at = $2 WHERE user_id = ANY($1::uuid[]) AND revoked_at IS NULL", [ids, now]);
    await tx.query("DELETE FROM otp_codes WHERE phone = (SELECT mobile FROM users WHERE id = $1)", [userId]);
    await tx.query("DELETE FROM notifications WHERE user_id = ANY($1::uuid[])", [ids]);
    await tx.query("DELETE FROM nafath_requests WHERE user_id = ANY($1::uuid[])", [ids]);
    if (banned) {
      await tx.query("UPDATE identity_verifications SET full_name = $2, date_of_birth = DATE '1900-01-01', face_match_score = NULL WHERE user_id = $1", [userId, DELETED_NAME]);
    } else {
      await tx.query("DELETE FROM identity_verifications WHERE user_id = $1", [userId]);
    }
    // A teacher stops being listed and loses every personal and bank detail.
    await tx.query(
      `UPDATE teacher_profiles SET status = 'suspended', bio = NULL, intro_video_url = NULL, iban = NULL, iban_holder_name = NULL,
              freelance_document_no = NULL, employer_noc_url = NULL, languages = '{}' WHERE user_id = $1`,
      [userId],
    );
    await tx.query("DELETE FROM availability WHERE teacher_id = $1", [userId]);
    await tx.query("UPDATE credentials SET file_url = 'deleted' WHERE teacher_id = $1", [userId]);
    await tx.query("DELETE FROM guardian_teacher_approvals WHERE guardian_id = $1", [userId]);
    await tx.query("DELETE FROM staff_mfa WHERE user_id = $1", [userId]);
    // Words people wrote are removed unless a flag points at them (safety evidence).
    await tx.query(
      `UPDATE messages SET body = '[محذوفة]' WHERE sender_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM flags f WHERE f.target_type = 'message' AND f.target_id = messages.id)`,
      [ids],
    );
    await tx.query("UPDATE reviews SET comment = NULL WHERE booking_id IN (SELECT id FROM bookings WHERE payer_id = ANY($1::uuid[]))", [ids]);
    // The mobile column is unique and required for adults, so it gets an unreachable placeholder.
    await tx.query(
      `UPDATE users SET display_name = $2, email = NULL, birth_year = NULL, deleted_at = $3,
              mobile = CASE WHEN role = 'minor' THEN NULL ELSE 'deleted:' || id::text END
        WHERE id = ANY($1::uuid[])`,
      [ids, DELETED_NAME, now],
    );
    await tx.query("UPDATE deletion_requests SET status = 'completed', completed_at = $2, blocked_reasons = '{}' WHERE user_id = $1 AND status = 'requested'", [userId, now]);
    await audit(tx, {
      actorId: null,
      action: "account.erased",
      targetType: "user",
      targetId: userId,
      detail: { children: kids.length, keptNationalIdHash: banned, kept: ["bookings", "payments", "payouts", "disputes", "strikes", "appeals", "reports", "audit_log", "flagged_messages", "ratings"] },
    });
  });
}

/** Run every minute: erase accounts whose cooling-off ended, unless something is still open (then say why, retry later). */
export async function processDeletions(db: Db, now: Date): Promise<{ erased: number; postponed: number }> {
  const due = (await db.query<{ user_id: string }>("SELECT user_id FROM deletion_requests WHERE status = 'requested' AND due_at <= $1 ORDER BY due_at LIMIT 20", [now])).rows;
  let erased = 0;
  let postponed = 0;
  for (const { user_id } of due) {
    const blocked = await deletionBlockers(db, user_id);
    if (blocked.length) {
      await db.query("UPDATE deletion_requests SET blocked_reasons = $2 WHERE user_id = $1 AND status = 'requested'", [user_id, blocked]);
      postponed++;
    } else {
      await eraseUser(db, now, user_id);
      erased++;
    }
  }
  return { erased, postponed };
}
