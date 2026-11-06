import { beforeAll, describe, expect, it } from "vitest";
import { makeHarness, nextPhone } from "./helpers/harness.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
beforeAll(async () => {
  h = await makeHarness();
});

describe("database", () => {
  it("refuses to change or delete the audit log", async () => {
    await h.db.query("INSERT INTO audit_log (action, target_type, target_id) VALUES ('t','t','1')");
    await expect(h.db.query("UPDATE audit_log SET action = 'x'")).rejects.toThrow(/append-only/);
    await expect(h.db.query("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
  });
});

describe("one-time codes", () => {
  it("echoes the code in mock mode, stores only a hash, and sends the SMS", async () => {
    const phone = nextPhone();
    const r = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
    expect(r.status).toBe(200);
    expect(r.body.mock_code).toMatch(/^\d{6}$/);
    const row = await h.db.query<{ code_hash: string }>("SELECT code_hash FROM otp_codes WHERE phone = $1", [phone]);
    expect(row.rows[0]!.code_hash).not.toContain(r.body.mock_code);
    expect(h.sms.outbox.at(-1)?.to).toBe(phone);
  });

  it("rejects malformed phones and unknown fields", async () => {
    expect((await h.call("POST", "/api/auth/otp/request", { body: { phone: "0512345678" } })).status).toBe(400);
    expect((await h.call("POST", "/api/auth/otp/request", { body: { phone: nextPhone(), admin: true } })).status).toBe(400);
  });

  it("caps requests per phone", async () => {
    const phone = nextPhone();
    for (let i = 0; i < 3; i++) expect((await h.call("POST", "/api/auth/otp/request", { body: { phone } })).status).toBe(200);
    const r = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
    expect(r.status).toBe(429);
    h.clock.advance(11 * 60_000);
    expect((await h.call("POST", "/api/auth/otp/request", { body: { phone } })).status).toBe(200);
  });

  it("locks after 5 wrong guesses, even if the right code follows", async () => {
    const phone = nextPhone();
    const { body } = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
    const wrong = body.mock_code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: wrong, role: "learner", displayName: "اسم" } });
      expect(r.status).toBe(401);
    }
    const late = await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: body.mock_code, role: "learner", displayName: "اسم" } });
    expect(late.status).toBe(401);
  });

  it("expires after 5 minutes and cannot be used twice", async () => {
    const phone = nextPhone();
    const a = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
    h.clock.advance(5 * 60_000 + 1000);
    expect((await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: a.body.mock_code, role: "learner", displayName: "اسم" } })).status).toBe(401);

    const b = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
    const ok = await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: b.body.mock_code, role: "learner", displayName: "اسم" } });
    expect(ok.status).toBe(200);
    const again = await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: b.body.mock_code } });
    expect(again.status).toBe(401);
  });
});

describe("registration and sessions", () => {
  it("asks a new number for role and name without spending the code", async () => {
    const phone = nextPhone();
    const { body } = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
    const first = await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: body.mock_code } });
    expect(first.status).toBe(409);
    expect(first.body.error).toBe("registration_required");
    const second = await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: body.mock_code, role: "guardian", displayName: "ولي أمر" } });
    expect(second.status).toBe(200);
    expect(second.body.user).toMatchObject({ role: "guardian", status: "pending" });
    expect(second.body.next).toBe("identity");
  });

  it("does not reveal whether a number has an account without a valid code", async () => {
    const known = await h.signup("learner");
    const r = await h.call("POST", "/api/auth/otp/verify", { body: { phone: known.phone, code: "123456" } });
    const unknown = await h.call("POST", "/api/auth/otp/verify", { body: { phone: nextPhone(), code: "123456" } });
    expect(r.status).toBe(401);
    expect(unknown.status).toBe(401);
  });

  it("never lets anyone self-register as staff, minor or any unlisted role", async () => {
    for (const role of ["super_admin", "vetting_officer", "finance_officer", "safety_officer", "minor"]) {
      const phone = nextPhone();
      const { body } = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
      const r = await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: body.mock_code, role, displayName: "مهاجم" } });
      expect(r.status).toBe(400);
    }
  });

  it("starts adult learners active and teachers pending", async () => {
    const l = await h.signup("learner");
    const t = await h.signup("teacher");
    expect((await h.call("GET", "/api/auth/me", { token: l.token })).body.status).toBe("active");
    expect((await h.call("GET", "/api/auth/me", { token: t.token })).body.status).toBe("pending");
    const blocked = await h.call("GET", "/api/teacher/me", { token: t.token });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("identity_required");
  });

  it("stores only the hash of a session token and rejects bad or missing tokens", async () => {
    const u = await h.signup("learner");
    const rows = await h.db.query<{ token_hash: string }>("SELECT token_hash FROM auth_sessions WHERE user_id = $1", [u.id]);
    expect(rows.rows[0]!.token_hash).not.toBe(u.token);
    expect(rows.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await h.call("GET", "/api/auth/me")).status).toBe(401);
    expect((await h.call("GET", "/api/auth/me", { token: "x".repeat(43) })).status).toBe(401);
  });

  it("logout revokes the session and sessions expire", async () => {
    const u = await h.signup("learner");
    expect((await h.call("POST", "/api/auth/logout", { token: u.token })).status).toBe(200);
    expect((await h.call("GET", "/api/auth/me", { token: u.token })).status).toBe(401);

    const v = await h.signup("learner");
    h.clock.advance(31 * 24 * 3_600_000);
    expect((await h.call("GET", "/api/auth/me", { token: v.token })).status).toBe(401);
  });

  it("blocks banned users from logging in and cuts live sessions", async () => {
    const u = await h.signup("learner");
    await h.db.query("UPDATE users SET status = 'banned' WHERE id = $1", [u.id]);
    expect((await h.call("GET", "/api/auth/me", { token: u.token })).status).toBe(403);
    h.clock.advance(11 * 60_000);
    const rq = await h.call("POST", "/api/auth/otp/request", { body: { phone: u.phone } });
    const v = await h.call("POST", "/api/auth/otp/verify", { body: { phone: u.phone, code: rq.body.mock_code } });
    expect(v.status).toBe(403);
    expect(v.body.error).toBe("account_banned");
  });
});

describe("staff multi-factor", () => {
  it("gives staff a session that only works for MFA until the code is accepted", async () => {
    const s = await h.staff("vetting_officer");
    const half = await s.login(false);
    expect(half.res.body.next).toBe("mfa");
    const r = await h.call("GET", "/api/admin/vetting/queue", { token: half.token });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("mfa_required");
    expect((await h.call("GET", "/api/auth/me", { token: half.token })).body.mfaVerified).toBe(false);

    h.clock.advance(30_000);
    expect((await h.call("POST", "/api/auth/mfa/verify", { token: half.token, body: { code: s.code() } })).status).toBe(200);
    expect((await h.call("GET", "/api/admin/vetting/queue", { token: half.token })).status).toBe(200);
  });

  it("refuses a wrong code and a replayed code, and kills the session after 5 failures", async () => {
    const s = await h.staff("finance_officer");
    // Two sessions open at the same moment: the code works once, and the same code is a replay on the other.
    const a = await s.login(false);
    const b = await s.login(false, false);
    const code = s.code();
    expect((await h.call("POST", "/api/auth/mfa/verify", { token: a.token, body: { code } })).status).toBe(200);
    const second = b;
    expect((await h.call("POST", "/api/auth/mfa/verify", { token: second.token, body: { code } })).status).toBe(401);
    for (let i = 0; i < 3; i++) await h.call("POST", "/api/auth/mfa/verify", { token: second.token, body: { code: "000000" } });
    const last = await h.call("POST", "/api/auth/mfa/verify", { token: second.token, body: { code: "000000" } });
    expect(last.body.error).toBe("too_many_attempts");
    expect((await h.call("GET", "/api/auth/me", { token: second.token })).status).toBe(401);
  });

  it("will not let a staff member without an authenticator in at all", async () => {
    const phone = nextPhone();
    await h.db.query("INSERT INTO users (role, status, mobile, display_name) VALUES ('super_admin','active',$1,'x')", [phone]);
    const rq = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
    const v = await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: rq.body.mock_code } });
    expect(v.status).toBe(403);
    expect(v.body.error).toBe("mfa_not_enrolled");
  });

  it("records staff logins in the audit log", async () => {
    const s = await h.staff("safety_officer");
    const r = await h.db.query("SELECT 1 FROM audit_log WHERE action = 'staff.login' AND actor_id = $1", [s.id]);
    expect(r.rowCount).toBeGreaterThan(0);
  });
});

describe("rate limits", () => {
  it("limits one address", async () => {
    const { buildApp } = await import("../src/http/app.js");
    const { config } = await import("./helpers/harness.js");
    const { MockSmsProvider } = await import("../src/providers/sms.js");
    const { MockNafathProvider } = await import("../src/providers/nafath.js");
    const app = buildApp({ db: h.db, config, sms: new MockSmsProvider(), nafath: new MockNafathProvider(), now: () => new Date(), limits: { global: 5, auth: 3 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: nextPhone() } });
      codes.push(r.statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });
});
