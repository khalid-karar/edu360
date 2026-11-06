import type { FastifyRequest } from "fastify";
import { findSession } from "../services/sessions.js";
import { HttpError } from "./errors.js";
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
}

/** Route pre-handler: who is calling, are they allowed, and have staff passed MFA. */
export function guard(ctx: Ctx, opts: GuardOpts = {}) {
  return async (req: FastifyRequest) => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization ?? "");
    if (!m) throw new HttpError(401, "unauthenticated");
    const s = await findSession(ctx.db, m[1]!, ctx.now());
    if (!s) throw new HttpError(401, "unauthenticated");
    if (s.status === "banned") throw new HttpError(403, "account_banned");
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
    req.user = user;
  };
}

/** For handlers behind guard(): the caller, never undefined. */
export function me(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, "unauthenticated");
  return req.user;
}
