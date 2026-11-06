"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, getToken, setToken } from "./api";

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
  signIn: (token: string) => Promise<User | null>;
  signOut: () => Promise<void>;
}
const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return null;
    }
    try {
      const u = await api<User>("GET", "/auth/me");
      setUser(u);
      return u;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setToken(null);
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, [refresh]);

  const signIn = useCallback(
    async (token: string) => {
      setToken(token);
      return refresh();
    },
    [refresh],
  );
  const signOut = useCallback(async () => {
    await api("POST", "/auth/logout").catch(() => {});
    setToken(null);
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
