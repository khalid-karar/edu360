import { beforeAll, describe, expect, it } from "vitest";
import { MIN_FAMILIES_FOR_STATS, SCHOOL_CODE_RE } from "../src/domain/schools.js";
import { makeHarness, nextPhone } from "./helpers/harness.js";
import { makeMarket } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeHarness>>["staff"]>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
  admin = await h.staff("super_admin");
});

const application = (mobile = nextPhone(), name = "مدارس النخبة الأهلية") => ({ name, city: "الرياض", contactName: "أحمد العتيبي", contactMobile: mobile, studentEstimate: 600 });
const apply = (body: object) => h.call("POST", "/api/schools/apply", { body });
// Staff sessions last 8 hours and some tests move the clock by days, so decisions sign in fresh.
const decide = async (id: string, body: object, token?: string) => h.call("POST", `/api/admin/schools/${id}/decision`, { token: token ?? (await admin.login()).token, body });

async function approvedSchool() {
  const app = application();
  const a = await apply(app);
  const d = await decide(a.body.id, { decision: "approve" });
  expect(d.status).toBe(200);
  return { ...app, id: a.body.id as string, code: d.body.inviteCode as string };
}

/** Registers a learner or guardian through the real sign-up, optionally with a school code. */
async function signupWith(role: "learner" | "guardian" | "teacher", schoolCode?: string) {
  const phone = nextPhone();
  h.clock.advance(11 * 60_000);
  const rq = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
  const body = { phone, code: rq.body.mock_code, role, displayName: "مستخدم", ...(schoolCode ? { schoolCode } : {}) };
  return { phone, code: rq.body.mock_code as string, res: await h.call("POST", "/api/auth/otp/verify", { body }) };
}

describe("applying", () => {
  it("takes a public application without an account and keeps it pending", async () => {
    const r = await apply(application());
    expect(r.status).toBe(201);
    const row = (await h.db.query("SELECT status, invite_code, owner_id FROM schools WHERE id = $1", [r.body.id])).rows[0];
    expect(row).toMatchObject({ status: "pending", invite_code: null, owner_id: null });
  });

  it("refuses incomplete or unexpected input and a second live application for the same mobile", async () => {
    expect((await apply({ ...application(), name: "ab" })).status).toBe(400);
    expect((await apply({ ...application(), contactMobile: "0555555555" })).status).toBe(400);
    expect((await apply({ ...application(), role: "super_admin" })).status).toBe(400);
    const app = application();
    expect((await apply(app)).status).toBe(201);
    const again = await apply(app);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("school_already_applied");
  });
});

describe("the staff decision", () => {
  it("is for the super admin only", async () => {
    const a = await apply(application());
    for (const role of ["vetting_officer", "safety_officer", "finance_officer"]) {
      const s = await h.staff(role);
      expect((await h.call("GET", "/api/admin/schools", { token: s.token })).status).toBe(403);
      expect((await decide(a.body.id, { decision: "approve" }, s.token)).status).toBe(403);
    }
    const l = await h.signup("learner");
    expect((await h.call("GET", "/api/admin/schools", { token: l.token })).status).toBe(403);
    expect((await h.call("GET", "/api/admin/schools")).status).toBe(401);
  });

  it("approves: creates the school's login on its mobile, issues a code, texts the contact and audits it", async () => {
    const app = application();
    const a = await apply(app);
    const d = await decide(a.body.id, { decision: "approve" });
    expect(d.body.inviteCode).toMatch(SCHOOL_CODE_RE);
    const u = (await h.db.query("SELECT role, status, display_name FROM users WHERE mobile = $1", [app.contactMobile])).rows[0];
    expect(u).toMatchObject({ role: "school", status: "active", display_name: app.name });
    expect(h.sms.outbox.some((s) => s.to === app.contactMobile && s.text.includes(d.body.inviteCode))).toBe(true);
    expect((await h.db.query("SELECT 1 FROM audit_log WHERE action = 'school.approved' AND target_id = $1", [a.body.id])).rowCount).toBe(1);
    const list = (await h.call("GET", "/api/admin/schools?status=approved", { token: (await admin.login()).token })).body.items;
    expect(list.find((s: { id: string }) => s.id === a.body.id)).toMatchObject({ status: "approved", inviteCode: d.body.inviteCode, families: 0 });
  });

  it("rejects only with a reason, decides once, and lets a rejected school apply again", async () => {
    const app = application();
    const a = await apply(app);
    expect((await decide(a.body.id, { decision: "reject" })).body.error).toBe("reason_required");
    expect((await decide(a.body.id, { decision: "reject", reason: "الترخيص غير ظاهر" })).status).toBe(200);
    expect((await decide(a.body.id, { decision: "approve" })).body.error).toBe("already_decided");
    expect((await h.db.query("SELECT 1 FROM users WHERE mobile = $1", [app.contactMobile])).rowCount).toBe(0);
    expect((await apply(app)).status).toBe(201);
  });

  it("will not create a login on a mobile that already belongs to someone", async () => {
    const l = await h.signup("learner");
    const a = await apply(application(l.phone));
    expect((await decide(a.body.id, { decision: "approve" })).body.error).toBe("mobile_in_use");
    expect((await h.db.query("SELECT status FROM schools WHERE id = $1", [a.body.id])).rows[0]!.status).toBe("pending");
  });

  it("issues a different code to each school", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) codes.add((await approvedSchool()).code);
    expect(codes.size).toBe(5);
  });
});

describe("signing up with a school code", () => {
  it("attributes a new learner or guardian to the school, case-insensitively", async () => {
    const s = await approvedSchool();
    const a = await signupWith("learner", s.code.toLowerCase());
    expect(a.res.status).toBe(200);
    const b = await signupWith("guardian", ` ${s.code} `);
    expect(b.res.status).toBe(200);
    const n = (await h.db.query("SELECT count(*)::int AS n FROM users WHERE school_id = $1", [s.id])).rows[0]!.n;
    expect(n).toBe(2);
  });

  it("refuses an unknown, malformed or unapproved code, and keeps the one-time SMS code usable for a retry", async () => {
    const pending = await apply(application());
    const s = await approvedSchool();
    for (const bad of ["ABCDEFGH", "short", "ILLEGAL1", "x".repeat(15)]) {
      const r = await signupWith("learner", bad);
      expect(r.res.status).toBe(422);
      expect(r.res.body.error).toBe("invalid_school_code");
    }
    void pending;
    // The mistyped attempt did not spend the SMS code: the same code works once the school code is fixed.
    const phone = nextPhone();
    h.clock.advance(11 * 60_000);
    const rq = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
    const wrong = await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: rq.body.mock_code, role: "learner", displayName: "مستخدم", schoolCode: "ABCDEFGH" } });
    expect(wrong.status).toBe(422);
    const right = await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: rq.body.mock_code, role: "learner", displayName: "مستخدم", schoolCode: s.code } });
    expect(right.status).toBe(200);
  });

  it("is not available to teachers or for self-registering as a school, and does not re-attribute an existing account", async () => {
    const s = await approvedSchool();
    expect((await signupWith("teacher", s.code)).res.body.error).toBe("invalid_school_code");
    const phone = nextPhone();
    h.clock.advance(11 * 60_000);
    const rq = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
    expect((await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: rq.body.mock_code, role: "school", displayName: "مدرسة" } })).status).toBe(400);
    // An existing account signing in again with a code stays as it was.
    const existing = await h.signup("learner");
    h.clock.advance(11 * 60_000);
    const rq2 = await h.call("POST", "/api/auth/otp/request", { body: { phone: existing.phone } });
    const again = await h.call("POST", "/api/auth/otp/verify", { body: { phone: existing.phone, code: rq2.body.mock_code, schoolCode: s.code } });
    expect(again.status).toBe(200);
    expect((await h.db.query("SELECT school_id FROM users WHERE id = $1", [existing.id])).rows[0]!.school_id).toBeNull();
  });
});

describe("the school's dashboard", () => {
  async function login(mobile: string) {
    h.clock.advance(11 * 60_000);
    const rq = await h.call("POST", "/api/auth/otp/request", { body: { phone: mobile } });
    const v = await h.call("POST", "/api/auth/otp/verify", { body: { phone: mobile, code: rq.body.mock_code } });
    expect(v.status).toBe(200);
    return v;
  }

  it("lets the school sign in with its own mobile, and nobody else open the overview", async () => {
    const s = await approvedSchool();
    const v = await login(s.contactMobile);
    expect(v.body.user.role).toBe("school");
    expect(v.body.next).toBeNull();
    const o = await h.call("GET", "/api/school/overview", { token: v.body.token });
    expect(o.status).toBe(200);
    expect(o.body.school.inviteCode).toBe(s.code);
    for (const who of [await h.signup("learner"), await h.signup("teacher")]) expect((await h.call("GET", "/api/school/overview", { token: who.token })).status).toBe(403);
    expect((await h.call("GET", "/api/school/overview", { token: admin.token })).status).toBe(403);
    expect((await h.call("GET", "/api/school/overview")).status).toBe(401);
  });

  it("shows only the number of sign-ups until enough families have joined, so no household can be singled out", async () => {
    const s = await approvedSchool();
    const t = await m.teacher();
    const first = await signupWith("learner", s.code);
    await m.completedLesson({ token: first.res.body.token }, t, 9);
    for (let i = 1; i < MIN_FAMILIES_FOR_STATS - 1; i++) await signupWith("learner", s.code);
    const school = await login(s.contactMobile);
    const few = (await h.call("GET", "/api/school/overview", { token: school.body.token })).body;
    expect(few.families).toBe(MIN_FAMILIES_FOR_STATS - 1);
    expect(few.stats).toBeNull();
    expect(JSON.stringify(few)).not.toContain("completed");
  });

  it("with enough families shows totals, folds small subjects into 'other', and never names a family", async () => {
    const s = await approvedSchool();
    const t = await m.teacher();
    const fams: { token: string; phone: string }[] = [];
    for (let i = 0; i < MIN_FAMILIES_FOR_STATS; i++) fams.push({ phone: "", token: (await signupWith("learner", s.code)).res.body.token });
    await m.completedLesson(fams[0]!, t, 9);
    await m.completedLesson(fams[1]!, t, 12);
    const school = await login(s.contactMobile);
    const o = (await h.call("GET", "/api/school/overview", { token: school.body.token })).body;
    expect(o.families).toBe(MIN_FAMILIES_FOR_STATS);
    expect(o.stats.completedLessons).toBe(2);
    expect(o.stats.hours).toBe(2);
    // Two families took Quran, fewer than the minimum, so it is reported as "other" rather than by name.
    expect(o.stats.byCategory).toEqual([{ category: "مواد أخرى", lessons: 2 }]);
    expect(o.stats.activeFamilies30d).toBeNull(); // 2 is below the minimum too
    expect(o.stats.signupsByMonth.reduce((a: number, r: { signups: number }) => a + r.signups, 0)).toBe(MIN_FAMILIES_FOR_STATS);
    const text = JSON.stringify(o);
    for (const f of fams) expect(text).not.toContain(f.token);
    expect(text).not.toMatch(/mobile|phone|displayName|"id"/);
  });

  it("names a subject once enough different families have taken it", async () => {
    const s = await approvedSchool();
    const fams: { token: string }[] = [];
    for (let i = 0; i < MIN_FAMILIES_FOR_STATS; i++) fams.push({ token: (await signupWith("learner", s.code)).res.body.token });
    for (const [i, f] of fams.entries()) await m.completedLesson(f, await m.teacher(), 6 + i);
    const school = await login(s.contactMobile);
    const o = (await h.call("GET", "/api/school/overview", { token: school.body.token })).body;
    expect(o.stats.byCategory).toEqual([{ category: "القرآن", lessons: MIN_FAMILIES_FOR_STATS }]);
    expect(o.stats.activeFamilies30d).toBe(MIN_FAMILIES_FOR_STATS);
  });
});
