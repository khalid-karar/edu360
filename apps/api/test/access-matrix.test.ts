import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { makeHarness } from "./helpers/harness.js";
import { makeMarket } from "./helpers/market.js";

/**
 * Who can reach which route. Every registered route is called anonymously and as each kind of user; the table of
 * "who gets past the guard" is pinned below. A new route, or a changed guard, fails this test until the table is
 * updated on purpose, so access can never widen by accident. Garbage input must never produce a 500 either.
 */
let h: Awaited<ReturnType<typeof makeHarness>>;
const ID = "00000000-0000-4000-8000-000000000000";
const roles = ["learner", "guardian", "teacher", "vetting_officer", "safety_officer", "finance_officer", "super_admin"] as const;
const tokens = {} as Record<(typeof roles)[number] | "banned" | "suspended" | "pending", string>;

// Open on purpose: sign-in, public catalogue, health, payment-provider webhook (checks a signature), dev-only mock pages.
const PUBLIC = new Set(["GET /api/health", "POST /api/auth/otp/request", "POST /api/auth/otp/verify", "GET /api/categories", "POST /webhooks/moyasar", "POST /api/waitlist"]);
// Logout is skipped: calling it would end the very sessions the matrix is using.
const isPublic = (key: string) => PUBLIC.has(key) || key.includes("/mock-pay") || key === "POST /api/auth/logout";

beforeAll(async () => {
  h = await makeHarness();
  const m = await makeMarket(h);
  tokens.learner = (await m.verified("learner")).token;
  tokens.guardian = (await m.verified("guardian")).token;
  tokens.teacher = (await m.teacher()).token;
  for (const r of roles.slice(3)) tokens[r] = (await h.staff(r)).token;
  const banned = await m.verified("learner");
  await h.db.query("UPDATE users SET status = 'banned' WHERE id = $1", [banned.id]);
  tokens.banned = banned.token;
  const susp = await m.verified("learner");
  await h.db.query("UPDATE users SET status = 'suspended' WHERE id = $1", [susp.id]);
  tokens.suspended = susp.token;
  tokens.pending = (await h.signup("guardian")).token; // signed up, identity not verified
});

const routes = () => [...new Map(h.app.routeTable.map((r) => [`${r.method} ${r.url}`, r])).values()].sort((a, b) => `${a.url} ${a.method}`.localeCompare(`${b.url} ${b.method}`));
const path = (url: string) => url.replace(/:\w+/g, ID);
const send = (method: string, url: string, token?: string, body: unknown = {}) =>
  h.call(method as "GET", path(url), { ...(token ? { token } : {}), ...(method === "GET" || method === "DELETE" ? {} : { body }) });

describe("access matrix", () => {
  it("every route except the public ones refuses anonymous callers", async () => {
    const open: string[] = [];
    for (const r of routes()) {
      const key = `${r.method} ${r.url}`;
      if (isPublic(key)) continue;
      const res = await send(r.method, r.url);
      if (res.status !== 401) open.push(`${key} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it("matches the pinned table of who gets past each guard", async () => {
    const table: Record<string, string> = {};
    for (const r of routes()) {
      const key = `${r.method} ${r.url}`;
      if (isPublic(key)) continue;
      const pass: string[] = [];
      for (const k of Object.keys(tokens) as (keyof typeof tokens)[]) {
        const res = await send(r.method, r.url, tokens[k]);
        if (res.status !== 401 && res.status !== 403) pass.push(k);
      }
      table[key] = pass.join(",");
    }
    if (process.env["UPDATE_MATRIX"]) writeFileSync(new URL("./access-matrix.json", import.meta.url), JSON.stringify(table, null, 2) + "\n");
    const pinned = (await import("./access-matrix.json", { with: { type: "json" } })).default;
    expect(table).toEqual(pinned);
  });

  it("never answers 500 to empty, oversized or wrongly typed input, whoever asks", async () => {
    const bad: string[] = [];
    const bodies: unknown[] = [{}, { id: 1, reason: [], amount: "x", startsAt: {} }, "text", null, { reason: "x".repeat(20_000) }];
    for (const r of routes()) {
      const key = `${r.method} ${r.url}`;
      if (isPublic(key) || r.method === "GET") continue;
      for (const k of ["learner", "teacher", "safety_officer", "finance_officer", "super_admin", "vetting_officer", "guardian"] as const) {
        for (const body of bodies) {
          const res = await send(r.method, r.url, tokens[k], body);
          if (res.status >= 500) bad.push(`${key} as ${k} body=${JSON.stringify(body).slice(0, 30)} -> ${res.status}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);
});
