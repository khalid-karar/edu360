import type { FastifyRequest } from "fastify";
import { findSession } from "../services/sessions.js";
import { HttpError } from "./errors.js";
import { SESSION_COOKIE, TOKEN_RE, readCookie, requireCsrfProof } from "./session-cookie.js";
import type { Ctx } from "./context.js";

export const STAFF_ROLES = ["vetting_officer", "safety_officer", "finance_officer", "super_admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type UserRole = "learner" | "guardian" | "minor" | "teacher" | StaffRole;
export type UserStatus = "pending" | "active" | "suspended" | "banned";

export const isStaff = (role: string): role is StaffRole => (STAFF_ROLES as readonly string[]).includes(role);

export interface AuthUser {
  id: string;
  role: UserRole;
  status: UserStatus;
  displayName: string;
  sessionId: string;
  mfaVerified: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export interface GuardOpts {
  /** Roles allowed. Omit for any signed-in user. */
  roles?: readonly UserRole[];
  /** Let users who have not completed identity verification through. */
  allowPending?: boolean;
  /** Let staff through before they have entered their TOTP code. Only the MFA and session routes use this. */
  allowUnverifiedMfa?: boolean;
  /** Let suspended users through as well (read-only account pages). */
  anyStatus?: boolean;
  /** Let banned users through. Only the routes a banned person needs: who am I, my record, appeal, notifications, sign out. */
  allowBanned?: boolean;
}

/**
 * From a session token to a user, applying the same account and role rules to every entry point: HTTP routes and the WebSocket.
 * Throws the HttpError a route would answer with.
 */
export async function authenticateToken(ctx: Ctx, token: string, opts: GuardOpts = {}): Promise<AuthUser> {
  const s = await findSession(ctx.db, token, ctx.now());
  if (!s) throw new HttpError(401, "unauthenticated");
  if (s.status === "banned" && !opts.allowBanned) throw new HttpError(403, "account_banned");
  const user: AuthUser = {
    id: s.user_id,
    role: s.role as UserRole,
    status: s.status as UserStatus,
    displayName: s.display_name,
    sessionId: s.session_id,
    mfaVerified: s.mfa_verified,
  };
  if (isStaff(user.role) && !user.mfaVerified && !opts.allowUnverifiedMfa) throw new HttpError(403, "mfa_required");
  if (opts.roles && !opts.roles.includes(user.role)) throw new HttpError(403, "forbidden");
  if (!opts.anyStatus) {
    if (user.status === "suspended") throw new HttpError(403, "account_suspended");
    if (user.status === "pending" && !opts.allowPending) throw new HttpError(403, "identity_required");
  }
  return user;
}

/** Route pre-handler: who is calling, are they allowed, and have staff passed MFA. */
export function guard(ctx: Ctx, opts: GuardOpts = {}) {
  return async (req: FastifyRequest) => {
    // An Authorization header wins. Without one, the browser app's session cookie is used, and then the request must prove it is not forged.
    let token = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization ?? "")?.[1];
    if (!token) {
      const c = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (c && TOKEN_RE.test(c)) {
        requireCsrfProof(req, ctx.config);
        token = c;
      }
    }
    if (!token) throw new HttpError(401, "unauthenticated");
    req.user = await authenticateToken(ctx, token, opts);
  };
}

/** For handlers behind guard(): the caller, never undefined. */
export function me(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, "unauthenticated");
  return req.user;
}
