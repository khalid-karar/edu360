"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { COOKIE_SESSION, ApiError, api, getToken, setToken } from "./api";

/**
 * With an HttpOnly cookie the page cannot tell whether anyone is signed in. This flag is only a hint so that signed-out visitors
 * do not trigger a pointless (and console-noisy) 401. It grants nothing: the server decides from the cookie.
 */
const HINT = "ilmak.signedin";
const hint = {
  get: () => { try { return localStorage.getItem(HINT) === "1"; } catch { return false; } },
  set: (on: boolean) => { try { if (on) localStorage.setItem(HINT, "1"); else localStorage.removeItem(HINT); } catch { /* private mode */ } },
};

export interface User {
  id: string;
  role: "learner" | "guardian" | "minor" | "teacher" | "vetting_officer" | "safety_officer" | "finance_officer" | "super_admin";
  status: "pending" | "active" | "suspended" | "banned";
  displayName: string;
  mfaVerified: boolean;
}
export const isStaffRole = (r: string) => r.endsWith("_officer") || r === "super_admin";

interface Ctx {
  user: User | null;
  ready: boolean;
  refresh: () => Promise<User | null>;
  signIn: (token?: string) => Promise<User | null>;
  signOut: () => Promise<void>;
}
const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    // With a cookie the token is invisible to us, so ask the server; with a bearer token, no token means nobody is signed in.
    if (COOKIE_SESSION ? !hint.get() : !getToken()) {
      setUser(null);
      return null;
    }
    try {
      const u = await api<User>("GET", "/auth/me");
      hint.set(true);
      setUser(u);
      return u;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setToken(null); hint.set(false); }
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, [refresh]);

  const signIn = useCallback(
    async (token?: string) => {
      if (token) setToken(token);
      hint.set(true);
      return refresh();
    },
    [refresh],
  );
  const signOut = useCallback(async () => {
    await api("POST", "/auth/logout").catch(() => {});
    setToken(null);
    hint.set(false);
    setUser(null);
  }, []);

  return <SessionCtx.Provider value={{ user, ready, refresh, signIn, signOut }}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}

/** Reads one query-string value on the client (the site is a static export, so there are no dynamic routes). */
export function useParam(name: string): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    setV(new URLSearchParams(window.location.search).get(name));
  }, [name]);
  return v;
}
