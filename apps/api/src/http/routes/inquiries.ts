import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { askTeacher, inquiryMessages, listInquiries, replyInquiry } from "../../services/inquiries.js";
import type { Ctx } from "../context.js";
import { parse, uuidParam } from "../errors.js";
import { guard, me } from "../guard.js";

const Body = z.object({ body: z.string().trim().min(1).max(1000) }).strict();

/** Questions before booking: a learner or guardian asks, the teacher answers. Same filter as lesson chat. */
export const inquiryRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const payer = guard(ctx, { roles: ["learner", "guardian"] });
  const party = guard(ctx, { roles: ["learner", "guardian", "teacher"] });
  const idOf = (req: { params: unknown }) => uuidParam((req.params as { id?: string }).id);

  app.post("/teachers/:id/inquiry", { preHandler: payer }, async (req, reply) => {
    const r = await askTeacher(db, ctx.now(), me(req).id, idOf(req), parse(Body, req.body).body);
    reply.code(201);
    return r;
  });
  app.get("/inquiries", { preHandler: party }, async (req) => ({ items: await listInquiries(db, me(req).id) }));
  app.get("/inquiries/:id/messages", { preHandler: party }, async (req) => {
    const { after } = parse(z.object({ after: z.iso.datetime().optional() }), req.query);
    return inquiryMessages(db, ctx.now(), me(req).id, idOf(req), after ? new Date(after) : undefined);
  });
  app.post("/inquiries/:id/messages", { preHandler: party }, async (req, reply) => {
    const r = await replyInquiry(db, ctx.now(), me(req).id, idOf(req), parse(Body, req.body).body);
    reply.code(201);
    return r;
  });
};
