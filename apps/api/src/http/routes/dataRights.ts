import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { cancelDeletion, deletionStatus, exportAccount, requestDeletion } from "../../services/dataRights.js";
import type { Ctx } from "../context.js";
import { parse } from "../errors.js";
import { guard, me } from "../guard.js";

/** PDPL rights: a copy of one's data, and erasure. Open to everyone signed in, including suspended, banned and not-yet-verified people. */
export const dataRightsRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  const pre = guard(ctx, { allowPending: true, anyStatus: true, allowBanned: true });

  app.get("/account/export", { preHandler: pre }, async (req, reply) => {
    reply.header("Content-Disposition", 'attachment; filename="ilmak-my-data.json"');
    return exportAccount(db, me(req).id, ctx.now());
  });

  app.get("/account/deletion", { preHandler: pre }, async (req) => deletionStatus(db, me(req).id));

  app.post("/account/deletion", { preHandler: pre }, async (req, reply) => {
    const u = me(req);
    parse(z.object({ confirm: z.literal(true) }).strict(), req.body);
    const r = await requestDeletion(db, ctx.now(), u.id, u.role);
    reply.code(201);
    return r;
  });

  app.delete("/account/deletion", { preHandler: pre }, async (req) => {
    await cancelDeletion(db, ctx.now(), me(req).id);
    return { ok: true };
  });
};
