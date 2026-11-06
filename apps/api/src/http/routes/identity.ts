import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hmacHex } from "../../security/crypto.js";
import { audit } from "../../services/audit.js";
import type { Ctx } from "../context.js";
import { HttpError, isUniqueViolation, parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";
import { rateLimit } from "../rate-limit.js";

const StartBody = z.object({ nationalId: z.string().regex(/^[12]\d{9}$/, "national ID or iqama number") }).strict();
const MAX_STARTS_PER_HOUR = 5;
const MIN_AGE = 18;

function ageOn(dob: string, now: Date): number {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age--;
  return age;
}

export const identityRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const limit = rateLimit(ctx.limits.auth, { name: "identity", store: ctx.rateStore });
  // Learners may verify too (optional for them). Staff and minors never do.
  const pre = [limit, guard(ctx, { roles: ["learner", "guardian", "teacher"], allowPending: true })];
  const idHash = (nationalId: string) => hmacHex(ctx.config.idHashKey, nationalId);

  app.post("/identity/nafath/start", { preHandler: pre }, async (req) => {
    const u = me(req);
    const { nationalId } = parse(StartBody, req.body);
    if ((await ctx.db.query("SELECT 1 FROM identity_verifications WHERE user_id = $1", [u.id])).rowCount) {
      throw new HttpError(409, "already_verified");
    }
    const hash = idHash(nationalId);
    if ((await ctx.db.query("SELECT 1 FROM identity_verifications WHERE national_id_hash = $1", [hash])).rowCount) {
      throw new HttpError(409, "national_id_in_use"); // one account per person
    }
    const since = new Date(ctx.now().getTime() - 3_600_000);
    const recent = await ctx.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM nafath_requests WHERE user_id = $1 AND created_at > $2",
      [u.id, since],
    );
    if ((recent.rows[0]?.n ?? 0) >= MAX_STARTS_PER_HOUR) throw new HttpError(429, "too_many_requests");

    const started = await ctx.nafath.start(nationalId).catch(() => {
      throw new HttpError(400, "invalid_national_id");
    });
    const row = await ctx.db.query<{ id: string }>(
      `INSERT INTO nafath_requests (user_id, provider_request_id, national_id_hash, created_at)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [u.id, started.requestId, hash, ctx.now()],
    );
    // The user picks this number inside the Nafath app to approve.
    return { requestId: row.rows[0]!.id, number: started.number };
  });

  app.get("/identity/nafath/status/:id", { preHandler: pre }, async (req) => {
    const u = me(req);
    const id = uuidParam((req.params as { id?: string }).id);
    const r = (
      await ctx.db.query<{ provider_request_id: string; national_id_hash: string; status: string }>(
        "SELECT provider_request_id, national_id_hash, status FROM nafath_requests WHERE id = $1 AND user_id = $2",
        [id, u.id],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, "not_found");
    if (r.status !== "waiting") return { status: r.status };

    const res = await ctx.nafath.status(r.provider_request_id);
    if (res.status === "waiting") return { status: "waiting" };
    const finish = (status: string) =>
      ctx.db.query("UPDATE nafath_requests SET status = $2, completed_at = $3 WHERE id = $1", [id, status, ctx.now()]);
    if (res.status !== "approved") {
      await finish(res.status);
      return { status: res.status };
    }

    const who = res.identity;
    // The approved person must be the one whose number was submitted at the start.
    if (idHash(who.nationalId) !== r.national_id_hash) {
      await finish("failed");
      throw new HttpError(409, "identity_mismatch");
    }
    if (ageOn(who.dateOfBirth, ctx.now()) < MIN_AGE) {
      await finish("failed");
      throw new HttpError(403, "underage");
    }
    try {
      await ctx.db.tx(async (tx) => {
        await tx.query(
          `INSERT INTO identity_verifications (user_id, provider, national_id_hash, full_name, gender, date_of_birth, verified_at)
           VALUES ($1,'nafath',$2,$3,$4,$5,$6)`,
          [u.id, r.national_id_hash, who.fullName, who.gender, who.dateOfBirth, ctx.now()],
        );
        await tx.query("UPDATE users SET status = 'active' WHERE id = $1 AND status = 'pending'", [u.id]);
        await tx.query("UPDATE nafath_requests SET status = 'approved', completed_at = $2 WHERE id = $1", [id, ctx.now()]);
        await audit(tx, { actorId: u.id, action: "identity.verified", targetType: "user", targetId: u.id, detail: { provider: "nafath" } });
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        await finish("failed");
        throw new HttpError(409, "national_id_in_use");
      }
      throw e;
    }
    return { status: "approved" };
  });
};
