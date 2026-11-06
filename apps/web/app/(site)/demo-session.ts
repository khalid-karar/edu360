"use client";
import type { RoleKey } from "./demo-data";

const KEY = "ilmak_demo_session";
export type Session = { role: RoleKey; name: string; phone: string };

export function getSession(): Session | null {
  try { const s = localStorage.getItem(KEY); return s ? (JSON.parse(s) as Session) : null; } catch { return null; }
}
export function setSession(s: Session) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }
export function clearSession() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** Calls the mock API on the same origin; if it is not there (e.g. static preview), returns null so the UI can fall back. */
export async function api<T = unknown>(path: string, body?: unknown): Promise<T | null> {
  try {
    const r = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok && r.status >= 500) return null;
    return (await r.json()) as T;
  } catch { return null; }
}
