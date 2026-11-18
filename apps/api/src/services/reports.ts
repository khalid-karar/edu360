import { riyals, toCsv } from "../domain/csv.js";
import type { Db } from "../db/db.js";
import { HttpError } from "../http/errors.js";

const HOUR = 3_600_000;
/** Saudi Arabia is UTC+3 all year. Months and days in reports are Riyadh months and days. */
const RIYADH = 3 * HOUR;

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const riyadhStart = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m - 1, d) - RIYADH);

export function monthRange(month: string): { from: Date; to: Date } {
  if (!MONTH_RE.test(month)) throw new HttpError(422, "invalid_month");
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { from: riyadhStart(y, m), to: riyadhStart(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1) };
}

/** An inclusive day range, Riyadh days. */
export function dayRange(from: string, to: string): { from: Date; to: Date } {
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) throw new HttpError(422, "invalid_range");
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t < f) throw new HttpError(422, "invalid_range");
  if ((t.getTime() - f.getTime()) / 86_400_000 > 366) throw new HttpError(422, "range_too_long");
  return { from: riyadhStart(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()), to: new Date(riyadhStart(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()).getTime() + 24 * HOUR) };
}

const NET = "(p.captured_halalas - p.refunded_halalas - p.commission_halalas + p.platform_credit_halalas)";
const COUNTED = "(p.status IN ('captured','partially_refunded') OR (p.status = 'refunded' AND p.platform_credit_halalas > 0))";
const day = (d: Date) => new Date(d.getTime() + RIYADH).toISOString().slice(0, 10);

interface Row { booking_id: string; captured_at: Date; starts_at: Date; category: string; duration_min: number; captured_halalas: number; refunded_halalas: number; commission_halalas: number; credit: number; net: number; payout_status: string | null }

/** A teacher's own statement for one month: each paid lesson with what the platform kept and what is theirs. No learner is named. */
export async function teacherStatement(db: Db, teacherId: string, month: string) {
  const { from, to } = monthRange(month);
  const r = await db.query<Row>(
    `SELECT b.id AS booking_id, p.captured_at, b.starts_at, c.name_ar AS category, b.duration_min,
            p.captured_halalas, p.refunded_halalas, p.commission_halalas, p.platform_credit_halalas AS credit,
            ${NET} AS net, o.status::text AS payout_status
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN categories c ON c.id = b.category_id LEFT JOIN payouts o ON o.id = p.payout_id
      WHERE b.teacher_id = $1 AND ${COUNTED} AND p.captured_at >= $2 AND p.captured_at < $3
      ORDER BY p.captured_at, b.id`,
    [teacherId, from, to],
  );
  const lessons = r.rows.map((x) => ({
    bookingId: x.booking_id,
    date: day(x.starts_at),
    category: x.category,
    minutes: x.duration_min,
    grossHalalas: x.captured_halalas,
    refundedHalalas: x.refunded_halalas,
    commissionHalalas: x.commission_halalas,
    platformCreditHalalas: x.credit,
    netHalalas: Number(x.net),
    payout: x.payout_status ?? "unpaid",
  }));
  const sum = (k: "grossHalalas" | "refundedHalalas" | "commissionHalalas" | "netHalalas") => lessons.reduce((a, l) => a + l[k], 0);
  return { month, currency: "SAR", lessons, totals: { lessons: lessons.length, grossHalalas: sum("grossHalalas"), refundedHalalas: sum("refundedHalalas"), commissionHalalas: sum("commissionHalalas"), netHalalas: sum("netHalalas") } };
}

export const statementCsv = (s: Awaited<ReturnType<typeof teacherStatement>>) =>
  toCsv(
    ["التاريخ", "المادة", "الدقائق", "المدفوع (ر.س)", "المسترد (ر.س)", "عمولة المنصة (ر.س)", "صافي لك (ر.س)", "حالة التحويل"],
    s.lessons.map((l) => [l.date, l.category, l.minutes, riyals(l.grossHalalas), riyals(l.refundedHalalas), riyals(l.commissionHalalas), riyals(l.netHalalas), l.payout]),
  );

export const MAX_EXPORT_ROWS = 20_000;

/** Every captured payment in a range, for the accountant. */
export async function financeExport(db: Db, from: Date, to: Date): Promise<string> {
  const r = await db.query<Row & { teacher_id: string; teacher_name: string; vat_halalas: number; payout_id: string | null }>(
    `SELECT b.id AS booking_id, p.captured_at, b.starts_at, c.name_ar AS category, b.duration_min, b.teacher_id, u.display_name AS teacher_name,
            p.captured_halalas, p.refunded_halalas, p.commission_halalas, p.vat_halalas, p.platform_credit_halalas AS credit,
            ${NET} AS net, p.payout_id, o.status::text AS payout_status
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN categories c ON c.id = b.category_id
       JOIN users u ON u.id = b.teacher_id LEFT JOIN payouts o ON o.id = p.payout_id
      WHERE ${COUNTED} AND p.captured_at >= $1 AND p.captured_at < $2
      ORDER BY p.captured_at, b.id LIMIT ${MAX_EXPORT_ROWS + 1}`,
    [from, to],
  );
  if (r.rows.length > MAX_EXPORT_ROWS) throw new HttpError(422, "range_too_long");
  return toCsv(
    ["تاريخ الدفع", "رقم الحجز", "رقم المعلّم", "اسم المعلّم", "المادة", "الدقائق", "المدفوع", "المسترد", "العمولة", "الضريبة", "صافي المعلّم", "رقم التحويل", "حالة التحويل"],
    r.rows.map((x) => [day(x.captured_at), x.booking_id, x.teacher_id, x.teacher_name, x.category, x.duration_min, riyals(x.captured_halalas), riyals(x.refunded_halalas), riyals(x.commission_halalas), riyals(x.vat_halalas), riyals(Number(x.net)), x.payout_id, x.payout_status ?? "unpaid"]),
  );
}
