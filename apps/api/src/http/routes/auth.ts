import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { decrypt } from "../../security/crypto.js";
import { verifyTotp } from "../../security/totp.js";
import { audit } from "../../services/audit.js";
import { checkOtp, consumeOtp, PHONE_RE, requestOtp } from "../../services/otp.js";
import { createSession, revokeSession } from "../../services/sessions.js";
import type { Ctx } from "../context.js";
import { HttpError, parse } from "../errors.js";
import { guard, isStaff, me } from "../guard.js";
import { rateLimit } from "../rate-limit.js";

const phone = z.string().regex(PHONE_RE, "phone must look like +9665XXXXXXXX");
const RequestBody = z.object({ phone }).strict();
const VerifyBody = z
  .object({
    phone,
    code: z.string().regex(/^\d{6}$/),
    // Only these three can self-register. Staff accounts are created by a super admin, never here.
    role: z.enum(["learner", "guardian", "teacher"]).optional(),
    displayName: z.string().trim().min(2).max(60).optional(),
  })
  .strict();
const MfaBody = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

interface UserRow {
  id: string;
  role: string;
  status: string;
  display_name: string;
}

export const authRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const limit = rateLimit(ctx.limits.auth);
  const otpDeps = { db: ctx.db, sms: ctx.sms, key: ctx.config.otpKey, now: ctx.now };
  const mfaFailures = new Map<string, number>();

  app.post("/auth/otp/request", { preHandler: limit }, async (req) => {
    const { phone: p } = parse(RequestBody, req.body);
    const code = await requestOtp(otpDeps, p);
    // The answer is the same whether or not the number has an account.
    return ctx.config.echoOtp ? { ok: true, mock_code: code } : { ok: true };
  });

  app.post("/auth/otp/verify", { preHandler: limit }, async (req, reply) => {
    const b = parse(VerifyBody, req.body);
    const otpId = await checkOtp(otpDeps, b.phone, b.code);
    if (!otpId) throw new HttpError(401, "invalid_code");

    let user = (await ctx.db.query<UserRow>("SELECT id, role, status, display_name FROM users WHERE mobile = $1", [b.phone])).rows[0];
    if (!user && (!b.role || !b.displayName)) {
      // The code is still valid: the client asks for the missing fields and calls again.
      throw new HttpError(409, "registration_required", { needs: ["role", "displayName"] });
    }
    if (!(await consumeOtp(otpDeps, otpId))) throw new HttpError(401, "invalid_code");

    if (!user) {
      const role = b.role!;
      user = await ctx.db.tx(async (tx) => {
        const u = await tx.query<UserRow>(
          `INSERT INTO users (role, status, mobile, display_name) VALUES ($1,$2,$3,$4)
           RETURNING id, role, status, display_name`,
          // Adults who only learn can start straight away. Teachers and guardians must verify identity first.
          [role, role === "learner" ? "active" : "pending", b.phone, b.displayName],
        );
        if (role === "teacher") await tx.query("INSERT INTO teacher_profiles (user_id) VALUES ($1)", [u.rows[0]!.id]);
        return u.rows[0]!;
      });
    }
    if (user.status === "banned") throw new HttpError(403, "account_banned");

    const staff = isStaff(user.role);
    if (staff) {
      const enrolled = await ctx.db.query("SELECT 1 FROM staff_mfa WHERE user_id = $1", [user.id]);
      if (enrolled.rowCount === 0) throw new HttpError(403, "mfa_not_enrolled");
    }
    const session = await createSession(ctx.db, {
      userId: user.id,
      // Staff sessions start unverified: only the MFA route works until the TOTP code is accepted.
      // Everyone else has no second factor, so their session is complete as issued.
      mfaVerified: !staff,
      hours: staff ? ctx.config.staffSessionHours : ctx.config.sessionHours,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      now: ctx.now(),
    });
    reply.code(200);
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: { id: user.id, role: user.role, status: user.status, displayName: user.display_name },
      next: staff ? "mfa" : user.status === "pending" ? "identity" : null,
    };
  });

  app.post("/auth/mfa/verify", { preHandler: [limit, guard(ctx, { allowUnverifiedMfa: true })] }, async (req) => {
    const u = me(req);
    if (!isStaff(u.role)) throw new HttpError(403, "forbidden");
    if (u.mfaVerified) return { ok: true };
    const { code } = parse(MfaBody, req.body);
    const row = (
      await ctx.db.query<{ secret_enc: string; last_step: string }>(
        "SELECT secret_enc, last_step::text AS last_step FROM staff_mfa WHERE user_id = $1",
        [u.id],
      )
    ).rows[0];
    if (!row) throw new HttpError(403, "mfa_not_enrolled");
    const secret = Buffer.from(decrypt(ctx.config.mfaEncKey, row.secret_enc), "hex");
    const step = verifyTotp(secret, code, ctx.now().getTime(), Number(row.last_step));
    // The step update only succeeds if no one used this or a later step in the meantime (replay guard).
    const fresh =
      step !== null &&
      (await ctx.db.query("UPDATE staff_mfa SET last_step = $2 WHERE user_id = $1 AND last_step < $2", [u.id, step])).rowCount === 1;
    if (!fresh) {
      const n = (mfaFailures.get(u.sessionId) ?? 0) + 1;
      mfaFailures.set(u.sessionId, n);
      if (n >= 5) {
        await revokeSession(ctx.db, u.sessionId, ctx.now());
        mfaFailures.delete(u.sessionId);
        throw new HttpError(401, "too_many_attempts");
      }
      throw new HttpError(401, "invalid_code");
    }
    mfaFailures.delete(u.sessionId);
    await ctx.db.tx(async (tx) => {
      await tx.query("UPDATE auth_sessions SET mfa_verified = true WHERE id = $1", [u.sessionId]);
      await audit(tx, { actorId: u.id, action: "staff.login", targetType: "user", targetId: u.id, detail: { role: u.role } });
    });
    return { ok: true };
  });

  const loose = { allowUnverifiedMfa: true, anyStatus: true, allowPending: true } as const;
  app.get("/auth/me", { preHandler: guard(ctx, loose) }, async (req) => {
    const u = me(req);
    return { id: u.id, role: u.role, status: u.status, displayName: u.displayName, mfaVerified: u.mfaVerified };
  });

  app.post("/auth/logout", { preHandler: guard(ctx, loose) }, async (req) => {
    await revokeSession(ctx.db, me(req).sessionId, ctx.now());
    return { ok: true };
  });
};
