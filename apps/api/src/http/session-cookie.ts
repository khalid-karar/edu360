import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";
import type { Config } from "../config.js";

/** The browser app keeps its session here instead of in localStorage, so a script injected into a page cannot read it. */
export const SESSION_COOKIE = "ilmak_session";
/** Sent by the web app on every call. A cookie-authenticated change without it is refused (see requireCsrfProof). */
export const CLIENT_HEADER = "x-ilmak-client";

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * HttpOnly: invisible to scripts. SameSite=Strict: never sent on a cross-site request. Path=/api: the cookie only travels to the API,
 * not to the static pages. Secure everywhere except the local sandbox (plain http on localhost).
 */
export function setSessionCookie(reply: FastifyReply, cfg: Pick<Config, "cookieSecure">, token: string, maxAgeSeconds: number): void {
  reply.header("set-cookie", `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}${cfg.cookieSecure ? "; Secure" : ""}`);
}

export function clearSessionCookie(reply: FastifyReply, cfg: Pick<Config, "cookieSecure">): void {
  reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${cfg.cookieSecure ? "; Secure" : ""}`);
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Defence against cross-site request forgery for cookie sessions, on top of SameSite=Strict:
 *  1. a change needs the custom header, which a foreign page cannot add without a CORS preflight (this API never answers one);
 *  2. if the browser says where the request came from, that origin must be ours.
 * Bearer-token callers never reach this: an attacker cannot make a browser attach an Authorization header.
 */
export function requireCsrfProof(req: FastifyRequest, cfg: Pick<Config, "allowedOrigins">): void {
  if (SAFE.has(req.method)) return;
  if (!req.headers[CLIENT_HEADER]) throw new HttpError(403, "csrf_required");
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin, req.host, cfg.allowedOrigins)) throw new HttpError(403, "bad_origin");
}

/** Same host as the request, or one of the origins listed in ALLOWED_ORIGINS (needed when a proxy rewrites the Host header). */
export function originAllowed(origin: string, requestHost: string, allowed: readonly string[]): boolean {
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}
