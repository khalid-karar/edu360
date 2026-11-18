import { beforeAll, describe, expect, it } from "vitest";
import { makeHarness, nextEmail } from "./helpers/harness.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
beforeAll(async () => {
  h = await makeHarness();
});

/** Signs in the way the browser app does: with the client header, expecting a cookie and no token in the body. */
async function webLogin() {
  const email = nextEmail();
  h.clock.advance(11 * 60_000);
  const rq = await h.call("POST", "/api/auth/otp/request", { body: { email } });
  const res = await h.app.inject({
    method: "POST",
    url: "/api/auth/otp/verify",
    headers: { "x-ilmak-client": "web" },
    payload: { email, code: rq.body.mock_code, role: "learner", displayName: "متعلم المتصفح" },
  });
  const set = String(res.headers["set-cookie"] ?? "");
  return { res, body: JSON.parse(res.body), set, cookie: set.split(";")[0]! };
}

const withCookie = (cookie: string, method: "GET" | "POST", url: string, extra: Record<string, string> = {}, payload?: object) =>
  h.app.inject({ method, url, headers: { cookie, ...extra }, ...(payload ? { payload } : {}) });

describe("browser sessions in an HttpOnly cookie", () => {
  it("issues the session as a cookie that scripts cannot read, and keeps the token out of the body", async () => {
    const { res, body, set } = await webLogin();
    expect(res.statusCode).toBe(200);
    expect(body.token).toBeUndefined();
    expect(body.user.role).toBe("learner");
    expect(set).toMatch(/^ilmak_session=[A-Za-z0-9_-]{20,}/);
    for (const flag of ["HttpOnly", "SameSite=Strict", "Path=/api", "Secure"]) expect(set).toContain(flag);
    expect(set).toMatch(/Max-Age=\d+/);
  });

  it("still hands the token to API clients that do not identify as the web app", async () => {
    const l = await h.signup("learner");
    expect(l.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("authenticates reads with the cookie alone", async () => {
    const { cookie } = await webLogin();
    const me = await withCookie(cookie, "GET", "/api/auth/me");
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body).displayName).toBe("متعلم المتصفح");
  });

  it("refuses a cookie-authenticated change that lacks the client header", async () => {
    const { cookie } = await webLogin();
    const r = await withCookie(cookie, "POST", "/api/auth/logout");
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error).toBe("csrf_required");
    // and the session survived the refused attempt
    expect((await withCookie(cookie, "GET", "/api/auth/me")).statusCode).toBe(200);
  });

  it("checks the Origin of a change: ours or a listed one passes, a foreign one does not", async () => {
    const attempt = async (origin: string | undefined, host = "api.ilmak.test") => {
      const { cookie } = await webLogin(); // a fresh session each time: a passing attempt signs it out
      const r = await withCookie(cookie, "POST", "/api/auth/logout", { "x-ilmak-client": "web", host, ...(origin ? { origin } : {}) });
      return { status: r.statusCode, error: JSON.parse(r.body).error as string | undefined };
    };
    expect(await attempt("https://evil.example")).toEqual({ status: 403, error: "bad_origin" });
    expect(await attempt("not a url")).toEqual({ status: 403, error: "bad_origin" });
    expect(await attempt("https://api.ilmak.test.evil.example")).toEqual({ status: 403, error: "bad_origin" });
    for (const ok of ["https://api.ilmak.test", "https://ilmak.test", undefined]) expect((await attempt(ok)).status).toBe(200);
    // A port is part of the origin: the dev server and the sandbox run on one.
    expect((await attempt("http://127.0.0.1:4000", "127.0.0.1:4000")).status).toBe(200);
    expect((await attempt("http://127.0.0.1:4001", "127.0.0.1:4000")).status).toBe(403);
  });

  it("does not need the header or origin for bearer callers, since a forged request cannot carry that header", async () => {
    const l = await h.signup("learner");
    const r = await h.app.inject({ method: "POST", url: "/api/auth/logout", headers: { authorization: `Bearer ${l.token}`, origin: "https://evil.example" } });
    expect(r.statusCode).toBe(200);
  });

  it("clears the cookie on logout and the old cookie stops working", async () => {
    const { cookie } = await webLogin();
    const out = await withCookie(cookie, "POST", "/api/auth/logout", { "x-ilmak-client": "web" });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/);
    expect((await withCookie(cookie, "GET", "/api/auth/me")).statusCode).toBe(401);
  });

  it("rejects a malformed or unknown cookie", async () => {
    expect((await withCookie("ilmak_session=short", "GET", "/api/auth/me")).statusCode).toBe(401);
    expect((await withCookie(`ilmak_session=${"a".repeat(43)}`, "GET", "/api/auth/me")).statusCode).toBe(401);
    expect((await h.app.inject({ method: "GET", url: "/api/auth/me" })).statusCode).toBe(401);
  });

  it("lets staff finish two-factor with the cookie session", async () => {
    const officer = await h.staff("vetting_officer");
    h.clock.advance(11 * 60_000);
    const rq = await h.call("POST", "/api/auth/otp/request", { body: { email: officer.email } });
    const v = await h.app.inject({ method: "POST", url: "/api/auth/otp/verify", headers: { "x-ilmak-client": "web" }, payload: { email: officer.email, code: rq.body.mock_code } });
    const cookie = String(v.headers["set-cookie"]).split(";")[0]!;
    expect(JSON.parse(v.body).next).toBe("mfa");
    // Before the code, the session opens nothing.
    expect((await withCookie(cookie, "GET", "/api/admin/vetting/queue")).statusCode).toBe(403);
    h.clock.advance(30_000);
    const m = await withCookie(cookie, "POST", "/api/auth/mfa/verify", { "x-ilmak-client": "web" }, { code: officer.code() });
    expect(m.statusCode).toBe(200);
    expect((await withCookie(cookie, "GET", "/api/admin/vetting/queue")).statusCode).toBe(200);
  });
});
