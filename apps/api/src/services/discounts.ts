import { z } from "zod";
import type { Db } from "../db/db.js";
import { HttpError, isUniqueViolation } from "../http/errors.js";
import { audit } from "./audit.js";

export const MIN_PAY_HALALAS = 100; // the card hold cannot be for less than 1 SAR

export const NewCode = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/),
    label: z.string().trim().min(2).max(80),
    kind: z.enum(["percent", "fixed"]),
    value: z.number().int().positive(),
    maxUses: z.number().int().positive().nullable().default(null),
    perUserLimit: z.number().int().positive().max(100).default(1),
    startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict()
  .refine((c) => c.kind !== "percent" || c.value <= 90, { message: "percent_too_high", path: ["value"] })
  .refine((c) => !c.startsAt || !c.endsAt || new Date(c.endsAt) > new Date(c.startsAt), { message: "bad_dates", path: ["endsAt"] });
export type NewCode = z.infer<typeof NewCode>;

interface CodeRow {
  id: string;
  code: string;
  label: string;
  kind: "percent" | "fixed";
  value: number;
  max_uses: number | null;
  per_user_limit: number;
  starts_at: Date | null;
  ends_at: Date | null;
  active: boolean;
  created_at: Date;
}

const LIVE_BOOKING = `(status IN ('requested','confirmed','completed','no_show_teacher','no_show_learner') OR (status = 'awaiting_payment' AND expires_at > $2))`;

export interface Applied {
  codeId: string;
  discountHalalas: number;
  payHalalas: number;
}

/**
 * Checks a code for this payer and works out the price. Throws one specific, plain error per reason.
 * The code row is locked so two bookings cannot both take the last use.
 */
export async function applyCode(tx: Db, rawCode: string, payerId: string, listHalalas: number, now: Date): Promise<Applied> {
  const code = rawCode.trim().toUpperCase();
  const c = (await tx.query<CodeRow>("SELECT * FROM discount_codes WHERE code = $1 FOR UPDATE", [code])).rows[0];
  if (!c || !c.active) throw new HttpError(422, "code_invalid");
  if (c.starts_at && now < c.starts_at) throw new HttpError(422, "code_not_started");
  if (c.ends_at && now >= c.ends_at) throw new HttpError(422, "code_expired");
  if (c.max_uses !== null) {
    const used = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings WHERE discount_code_id = $1 AND ${LIVE_BOOKING}`, [c.id, now])).rows[0]!.n;
    if (used >= c.max_uses) throw new HttpError(422, "code_exhausted");
  }
  const mine = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings WHERE discount_code_id = $1 AND payer_id = $3 AND ${LIVE_BOOKING}`, [c.id, now, payerId])).rows[0]!.n;
  if (mine >= c.per_user_limit) throw new HttpError(422, "code_already_used");

  const raw = c.kind === "percent" ? Math.floor((listHalalas * c.value) / 100) : c.value;
  const discount = Math.min(raw, Math.max(0, listHalalas - MIN_PAY_HALALAS));
  if (discount <= 0) throw new HttpError(422, "code_not_applicable");
  return { codeId: c.id, discountHalalas: discount, payHalalas: listHalalas - discount };
}

const view = (c: CodeRow, used: number) => ({
  id: c.id, code: c.code, label: c.label, kind: c.kind, value: c.value, maxUses: c.max_uses, perUserLimit: c.per_user_limit,
  startsAt: c.starts_at, endsAt: c.ends_at, active: c.active, used, createdAt: c.created_at,
});

export async function listCodes(db: Db, now: Date) {
  const r = await db.query<CodeRow & { used: number }>(
    `SELECT d.*, (SELECT count(*)::int FROM bookings WHERE discount_code_id = d.id AND ${LIVE_BOOKING}) AS used FROM discount_codes d ORDER BY d.created_at DESC`.replace("$2", "$1"),
    [now],
  );
  return r.rows.map((c) => view(c, c.used));
}

export async function createCode(db: Db, adminId: string, input: NewCode, now: Date) {
  try {
    return await db.tx(async (tx) => {
      const r = await tx.query<CodeRow>(
        `INSERT INTO discount_codes (code, label, kind, value, max_uses, per_user_limit, starts_at, ends_at, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [input.code, input.label, input.kind, input.value, input.maxUses, input.perUserLimit, input.startsAt, input.endsAt, adminId, now],
      );
      await audit(tx, { actorId: adminId, action: "discount.created", targetType: "discount_code", targetId: r.rows[0]!.id, detail: { code: input.code, kind: input.kind, value: input.value } });
      return view(r.rows[0]!, 0);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "code_taken");
    throw e;
  }
}

export async function setCodeActive(db: Db, adminId: string, id: string, active: boolean): Promise<void> {
  await db.tx(async (tx) => {
    const r = await tx.query("UPDATE discount_codes SET active = $2 WHERE id = $1", [id, active]);
    if (!r.rowCount) throw new HttpError(404, "not_found");
    await audit(tx, { actorId: adminId, action: active ? "discount.enabled" : "discount.disabled", targetType: "discount_code", targetId: id });
  });
}
