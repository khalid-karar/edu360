import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EMAIL_RE, normalizeEmail } from "../../services/otp.js";
import { applyForSchool, decideSchool, listSchools, schoolOverview } from "../../services/schools.js";
import type { Ctx } from "../context.js";
import { parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";
import { rateLimit } from "../rate-limit.js";

const Apply = z
  .object({
    name: z.string().trim().min(3).max(120),
    city: z.string().trim().min(2).max(60),
    contactName: z.string().trim().min(3).max(80),
    contactEmail: z.string().max(254).transform(normalizeEmail).pipe(z.string().regex(EMAIL_RE)),
    contactMobile: z.string().trim().max(20).optional(),
    licenseNo: z.string().trim().max(40).optional(),
    studentEstimate: z.number().int().min(1).max(100_000).optional(),
  })
  .strict();
const Decision = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(300).optional() }).strict();

/** Schools channel: a public application, a staff decision, and the school's own aggregate-only dashboard. */
export const schoolRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  // Public and unauthenticated, so it gets the strict per-address limit used for sign-in.
  const limit = rateLimit(ctx.limits.auth, { name: "school-apply", store: ctx.rateStore });
  const superAdmin = guard(ctx, { roles: ["super_admin"] });
  const school = guard(ctx, { roles: ["school"] });

  app.post("/schools/apply", { preHandler: limit }, async (req, reply) => {
    const r = await applyForSchool(db, ctx.now(), parse(Apply, req.body));
    reply.code(201);
    return { ok: true, id: r.id };
  });

  app.get("/admin/schools", { preHandler: superAdmin }, async (req) => {
    const { status } = parse(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }), req.query);
    return { items: await listSchools(db, status) };
  });

  app.post("/admin/schools/:id/decision", { preHandler: superAdmin }, async (req) => {
    const b = parse(Decision, req.body);
    const r = await decideSchool(db, ctx.now(), me(req).id, uuidParam((req.params as { id?: string }).id), b.decision, b.reason);
    // Best effort: staff can also phone the school. The login is the contact email, with the usual one-time code.
    const text = r.status === "approved" ? `تم اعتماد ${r.name} في عِلمك. سجّل الدخول ببريدك الإلكتروني من الرابط: ${ctx.config.publicUrl ?? ""}/portal/login\nرمز المدرسة: ${r.code}` : `نعتذر، لم يُعتمد طلب ${r.name} حالياً.`;
    await ctx.mail.send(r.email, r.status === "approved" ? "تم اعتماد مدرستكم في عِلمك" : "بخصوص طلب مدرستكم في عِلمك", text).catch(() => {});
    return { ok: true, status: r.status, ...(r.status === "approved" ? { inviteCode: r.code } : {}) };
  });

  app.get("/school/overview", { preHandler: school }, async (req) => schoolOverview(db, ctx.now(), me(req).id));
};
