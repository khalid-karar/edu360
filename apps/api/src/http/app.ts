import Fastify, { type FastifyInstance } from "fastify";
import { ProviderError } from "../payments/provider.js";
import type { Ctx } from "./context.js";
import { HttpError } from "./errors.js";
import { rateLimit } from "./rate-limit.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { identityRoutes } from "./routes/identity.js";
import { miscRoutes } from "./routes/misc.js";
import { teacherRoutes } from "./routes/teacher.js";
import { vettingRoutes } from "./routes/vetting.js";

/** Builds the API without opening a port, so tests can call it with app.inject(). Every route is under /api. */
export function buildApp(ctx: Ctx): FastifyInstance {
  // Behind Caddy: the client address comes from X-Forwarded-For, and only the proxy can reach us (bound to 127.0.0.1).
  const app = Fastify({ trustProxy: true, bodyLimit: 16_384, logger: false });

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.addHook("onRequest", rateLimit(ctx.limits.global));
  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ ok: false, error: "not_found" }));
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ ok: false, error: err.message, ...(err.details !== undefined ? { details: err.details } : {}) });
    }
    if (err instanceof ProviderError) return reply.code(err.status).send({ ok: false, error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413) return reply.code(413).send({ ok: false, error: "too_large" });
    if (status && status >= 400 && status < 500) return reply.code(400).send({ ok: false, error: "bad_request" });
    console.error(err);
    return reply.code(500).send({ ok: false, error: "server_error" });
  });

  app.register(miscRoutes(ctx));
  app.register(authRoutes(ctx), { prefix: "/api" });
  app.register(identityRoutes(ctx), { prefix: "/api" });
  app.register(teacherRoutes(ctx), { prefix: "/api" });
  app.register(vettingRoutes(ctx), { prefix: "/api" });
  app.register(adminRoutes(ctx), { prefix: "/api" });
  return app;
}
